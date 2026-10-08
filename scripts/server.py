# -*- coding: utf-8 -*-
"""本地服务：前端直连引擎。基于标准库 http.server，无需第三方 Web 依赖。
端点:
  GET  /health            探活
  POST /api/recognize     上传需求 docx(base64) + 参数 → 候选功能点清单
  POST /api/generate      候选清单(JSON) + 参数 → 生成成品 xlsx，返回汇总+下载句柄
  GET  /api/download?s=xx 下载生成的成品 xlsx
"""
import base64, gc, io, json, os, re, shutil, sqlite3, subprocess, sys, threading, time, uuid, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# 同目录兄弟模块（engine.py 等）直接导入；frozen(exe) 时由 PyInstaller 一并收集
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docx import Document
from docx.table import Table
from docx.oxml.ns import qn
import engine
import generate_xlsx as g
from replay_recognize import guess_type
import pert

# 可写数据目录：frozen(exe) 用 %APPDATA%\WorkloadEval（升级/卸载不随安装目录删除，配置不丢），
# dev 用项目 data；可用环境变量 WE_DATA 覆盖
if getattr(sys, "frozen", False):
    _RES = Path(getattr(sys, "_MEIPASS", sys.executable)).resolve()   # 打包内只读资源
    _APP_ROOT = Path(sys.executable).resolve().parent                 # exe 所在目录
    _USER_DATA = Path(os.environ.get("APPDATA") or _APP_ROOT) / "WorkloadEval"
else:
    _RES = Path(__file__).resolve().parent.parent
    _APP_ROOT = _RES
    _USER_DATA = _APP_ROOT / "data"          # dev：保持项目 data/（勿指项目根，会与源码混放）
APP_DATA = Path(os.environ.get("WE_DATA") or _USER_DATA)

# ---------------- 常量（T01501 / python:S1192） ----------------
# 抽出的都是「同一语义在多处内联的字面量」：改一处须同步 N 处的年代，
# 漏改不会报错、只会静默产生行为分叉。
F_CONFIG = "config.json"            # 配置中心持久化
F_PERT_DB = "pert.db"               # PERT 库
F_TEMPLATE = "template.xlsx"        # 内置母版
UPLOAD_FALLBACK_NAME = "req.docx"    # 上传请求未带文件名时的占位名（原内联 3 处）
F_RECOGNITION_RULES = "recognition_rules.json"   # 识别规则表
F_RATES_VERSIONS = "rates_versions.json"         # 费率版本表
DIR_I18N = "i18n"                     # 界面文案字典目录（相对 APP_DATA）
I18N_DEFAULT_LANG = "zh-CN"           # 默认语言；未带 lang 或不支持时回落
I18N_SUPPORTED = ("zh-CN", "en-US")   # 支持的语言白名单（防目录穿越，见 /api/i18n）
F_SCHEMA_VER = "schema_ver"                      # schema 版本标记（由 datakeeper 读写）
DIR_TEMPLATES = "templates"         # 自定义母版目录（相对 APP_DATA）
CHAT_SUFFIX = "/chat/completions"   # OpenAI 兼容端点后缀
F_PACKAGE_JSON = "package.json"     # 前端工程清单（技术栈探测用）
SYS_TICKET = "票据业务系统"          # 项目主系统名（上下文推断的归并目标）
AUTH_BEARER = "Bearer "              # 鉴权头前缀
# 开发语言 → 母版语系标识的对照（Excel 公式按语系取值，见 _CTX_LANG_EXT）
EXT_JAVA = ".java"


def _migrate_legacy_data():
    """升级兼容：旧版把 config.json/pert.db/template.xlsx 存在 exe 旁 data/，
    重装/升级会随安装目录被删。首次以新数据目录启动时迁移存量文件。"""
    if not getattr(sys, "frozen", False):
        return
    legacy = _APP_ROOT / "data"
    if not legacy.is_dir():
        return
    APP_DATA.mkdir(parents=True, exist_ok=True)
    for name in (F_CONFIG, F_PERT_DB, F_TEMPLATE):
        src, dst = legacy / name, APP_DATA / name
        if src.is_file() and not dst.exists():
            try:
                shutil.copy2(src, dst)
                print(f"[migrate] {name}: {src} -> {dst}")
            except OSError as e:
                print(f"[migrate] {name} 失败: {e}")


_migrate_legacy_data()
UPLOAD = APP_DATA / "uploads"
OUTDIR = APP_DATA / "generated"
UPLOAD.mkdir(parents=True, exist_ok=True)
OUTDIR.mkdir(parents=True, exist_ok=True)

# ---------------- 生成进度上报（T00927） ----------------
# /api/generate 是同步接口且耗时集中在引擎填充 + Excel 公式重算，前端拿不到中间态。
# 做法：前端给每次生成带一个 job id，服务端按真实阶段写入内存进度表，
# 前端用 GET /api/generate/progress?job=xx 轮询（ThreadingHTTPServer，不阻塞主请求）。
GEN_PROGRESS = {}
GEN_PROGRESS_LOCK = threading.Lock()
GEN_PROGRESS_TTL = 900          # 秒；超时记录在下一次读写时惰性清理


def _gen_progress_set(job, pct, stage, done=False, error=None):
    """写入某次生成任务的阶段进度；job 为空时静默忽略（保持旧客户端兼容）。"""
    if not job:
        return
    with GEN_PROGRESS_LOCK:
        GEN_PROGRESS[job] = {"pct": max(0, min(100, int(pct))), "stage": stage,
                             "done": bool(done), "error": error, "ts": time.time()}


def _gen_progress_get(job):
    with GEN_PROGRESS_LOCK:
        now = time.time()
        for k in [k for k, v in GEN_PROGRESS.items() if now - v.get("ts", 0) > GEN_PROGRESS_TTL]:
            GEN_PROGRESS.pop(k, None)
        cur = GEN_PROGRESS.get(job)
        return dict(cur) if cur else None


def _gen_recalc_set(job, state):
    """记录某次生成的公式缓存补算终态（T00963）：written / skipped / failed。
    只补 recalc 字段，不覆盖主进度（生成已 100%，前端在结果页单独轮询该字段）。"""
    if not job or state not in ("written", "skipped", "failed"):
        return
    with GEN_PROGRESS_LOCK:
        cur = GEN_PROGRESS.get(job)
        if cur is None:
            cur = GEN_PROGRESS[job] = {"pct": 100, "stage": "生成完成", "done": True,
                                       "error": None, "ts": time.time()}
        cur["recalc"] = state
        cur["ts"] = time.time()

# 解析母版：环境 WE_TPL > 打包内置(tpl/template.xlsx) > 开发默认
def _resolve_template():
    env = os.environ.get("WE_TPL")
    if env and Path(env).exists():
        return Path(env)
    bundled = _RES / "tpl" / "template.xlsx"      # PyInstaller --add-data 时存放母版
    if bundled.exists():
        dst = APP_DATA / F_TEMPLATE
        if not dst.exists():
            shutil.copy2(bundled, dst)            # 首次运行将母版落到可写目录
        return dst
    dev = Path(r"C:\Users\hspcadmin\Desktop\工作量评估\副本造价评估-天津银行_票据新增五篇大文章标识功能项目（软件开发功能点评估）_KX_20251027_V1.0.xlsx")
    return dev if dev.exists() else bundled

g.TPL = str(_resolve_template())

# 识别规则表（M3/FR-2.9）：外置规则 + 驳回流沉淀；损坏自动回退内置链（对拍已验证零回归）
import replay_recognize as _rr
RULES = None
RATES = None
try:
    import recognition_rules as _rrules
    _rules_path = APP_DATA / F_RECOGNITION_RULES
    _rules_seed = _RES / "data" / "recognition_rules.json"
    if not _rules_path.exists() and _rules_seed.exists():
        import shutil
        shutil.copyfile(_rules_seed, _rules_path)   # 首启播种内置规则
    RULES = _rrules.RulesStore(_rules_path)
    _rr.set_rules_store(RULES)
except Exception as e:
    RULES = None
    print(f"[rules] 初始化失败，回退内置识别链: {type(e).__name__}: {e}", flush=True)

# 费率与基准版本表（M6/FR-2.3）：data/rates_versions.json 外置，不发版可更新
import gb_engine as _gb
from datetime import datetime as _dt
try:
    _rates_path = APP_DATA / F_RATES_VERSIONS
    _rates_seed = _RES / "data" / "rates_versions.json"
    if not _rates_path.exists() and _rates_seed.exists():
        import shutil
        shutil.copyfile(_rates_seed, _rates_path)

    class RatesStore:
        """费率与基准多版本存取（负数/超界拒绝，见 gb_engine.rates_ok）。"""
        def __init__(self, path):
            self.path = str(path)
            self.reload()
        def reload(self):
            with open(self.path, 'rb') as f:
                self.doc = json.loads(f.read().decode('utf-8-sig'))
        def list(self):
            return {"ok": True, "version": self.doc.get("version", 1),
                    "selected": self.doc.get("selected"), "versions": self.doc.get("versions") or {}}
        def get(self, name=None):
            name = name or self.doc.get("selected")
            v = (self.doc.get("versions") or {}).get(name)
            if v is None and self.doc.get("versions"):
                name, v = next(iter(self.doc["versions"].items()))
            return name, v
        def save(self, doc):
            for name, v in (doc.get("versions") or {}).items():
                if not _gb.rates_ok(v):
                    raise ValueError(f"版本 {name} 数值非法（负数/超界）")
            if doc.get("selected") not in (doc.get("versions") or {}):
                raise ValueError("selected 版本不存在")
            doc["version"] = int(self.doc.get("version", 1)) + 1
            doc["updated_at"] = _dt.now().isoformat(timespec='seconds')
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(doc, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
            self.reload()
            return {"version": self.doc["version"], "updated_at": self.doc["updated_at"]}

    RATES = RatesStore(_rates_path)
except Exception as e:
    RATES = None
    print(f"[rates] 初始化失败: {type(e).__name__}: {e}", flush=True)

# 界面文案字典（FR-5.5）：data/i18n/{lang}.json 外置，不发版可补翻译。
# 为什么不走 /static/：该路由白名单只放行 .js/.css 且显式禁子路径（防目录穿越），
# 放行 .json 会扩大攻击面，故单独走 /api/i18n 的 _json() 通道。
def _i18n_lang(lang):
    """把外部传入的 lang 收敛为白名单内的值。

    双重用途：既决定读哪个字典，也作为响应里回显的 lang——
    不可直接把原始入参回显（`?lang=../../config` 会原样出现在响应中，
    虽读不到文件但属反射型瑕疵，也会让前端误判当前语言）。
    """
    return lang if lang in I18N_SUPPORTED else I18N_DEFAULT_LANG


def _i18n_path(lang):
    """返回字典路径；lang 已在 _i18n_lang 收敛为白名单值，此处只做路径二次确认。"""
    p = (APP_DATA / DIR_I18N / f"{_i18n_lang(lang)}.json").resolve()
    # 双保险：白名单已挡 lang，但再确认一次路径确实位于 i18n 目录内
    root = (APP_DATA / DIR_I18N).resolve()
    if root not in p.parents:
        return None
    return p


def _i18n_seed():
    """首启播种内置字典：data/i18n/ 不存在时从只读资源目录拷一份。

    与识别规则表/费率版本表同一套播种惯例（见 RULES/RATES 初始化）。

    候选源依次尝试 _RES（打包内只读资源）与 _APP_ROOT（exe 同级）——
    spec 的 datas 历史上只收了 frontend/tpl，若只查_RES 则冻结态下会静默落空，
    表现为「开发模式正常、安装版翻译全失效」。多试一个来源即覆盖两种形态。
    用户后续自行编辑的字典不会被覆盖（仅在目标文件缺失时拷贝）。
    """
    dst_dir = APP_DATA / DIR_I18N
    try:
        if not dst_dir.exists():
            dst_dir.mkdir(parents=True, exist_ok=True)
        for lang in I18N_SUPPORTED:
            dst = dst_dir / f"{lang}.json"
            if dst.exists():
                continue
            for base in (_RES, _APP_ROOT):
                src = base / "data" / DIR_I18N / f"{lang}.json"
                if src.exists():
                    import shutil
                    shutil.copyfile(src, dst)
                    break
            else:
                print(f"[i18n] 内置字典缺失（{lang}），该语言将回退显示 key", flush=True)
    except Exception as e:
        print(f"[i18n] 字典播种失败（不影响启动）: {type(e).__name__}: {e}", flush=True)


def load_i18n(lang):
    """读界面文案字典。字典缺失返回空字典而非抛错——i18n 是增强项，
    缺翻译时前端 t() 会回退显示 key（中文原文），不应让整个接口 500。"""
    p = _i18n_path(lang)
    if not p or not p.exists():
        return {}
    try:
        with open(p, "rb") as f:
            doc = json.loads(f.read().decode("utf-8-sig"))
        return doc.get("strings") if isinstance(doc, dict) and isinstance(doc.get("strings"), dict) else {}
    except Exception as e:
        print(f"[i18n] 字典读取失败（{lang}）: {type(e).__name__}: {e}", flush=True)
        return {}


_i18n_seed()   # 启动即播种，使全新安装的实例也能取到字典

# M8/FR-5.3、5.4、5.6：统一校验层 + 结构化日志 + 备份迁移
import validators as V
import slog as _slogmod
import datakeeper as _dk
SLOG = _slogmod.Slog(APP_DATA / "logs" / "server.jsonl")
SCHEMA_VER = _dk.SCHEMA_VER

# PERT 库初始化（data/pert.db）
_PERT_DB = pert.db_for(APP_DATA)
pert.PertDB(_PERT_DB)


def _pert_connect():
    """T01481（P1-1）：统一 PERT 库连接——busy timeout + WAL，消除并发写
    "database is locked"（T01369 稳定性实测 recognize 并发下 120 个 500）。"""
    con = sqlite3.connect(_PERT_DB, timeout=15)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


# T01481（P0-2）：同名产物串行锁——title → Lock。
# 同一标题的「写成品表 + Excel COM 重算写回」整段必须串行，否则并发请求的
# 原子替换会与 COM 持有的文件句柄互踩（实测 500：目标被占用 / not a zip）；
# 不同标题互不影响，仍然并行。
_GEN_TITLE_LOCKS = {}
_GEN_TITLE_LOCKS_GUARD = threading.Lock()


def _title_lock(title):
    with _GEN_TITLE_LOCKS_GUARD:
        lk = _GEN_TITLE_LOCKS.get(title)
        if lk is None:
            lk = _GEN_TITLE_LOCKS[title] = threading.Lock()
        return lk

# 估算历史存储（M1/FR-1.1、1.8、2.5）：独立 estimation.db；初始化失败降级禁用历史功能
HIST = None
try:
    import history as _hist
    HIST = _hist.HistStore(APP_DATA / "estimation.db")
except Exception as e:
    print(f"[history] 初始化失败，历史功能禁用: {type(e).__name__}: {e}", flush=True)

# M8/FR-5.6：备份与 schema 迁移放在各存储初始化之后（保证 pert.db/estimation.db 已就绪）
try:
    _bk = _dk.backup_on_start(APP_DATA)
    if _bk:
        SLOG.info("datakeeper", "backup_done", dst=str(_bk))
    _cur, _applied = _dk._migrate(APP_DATA)
    SCHEMA_VER = _cur
    SLOG.info("datakeeper", "schema_ready", ver=_cur, applied=_applied)
except Exception as e:
    SCHEMA_VER = _dk.SCHEMA_VER
    SLOG.error("datakeeper", "backup_migrate_failed", err=str(e))


# ---------------- 配置中心（持久化到 data/config.json） ----------------
CONF_FILE = APP_DATA / "config.json"
# 默认大模型配置：模型预设切换基于这些条目；provider_console 为厂商控制台链接
DEFAULT_CONFIG = {
    "llm": {"enabled": False, "api": "https://api.openai.com/v1",
            "model": "gpt-4o-mini", "key": ""},
    "provider": "openai",
    "context_dir": "",   # 项目上下文目录：AI 估算时注入该目录扫描出的项目级上下文
    "update_url": "",    # 更新源 URL：指向返回 {version,url,notes} 的 JSON；空=不做版本检测
    "recalc": {"mode": "async", "timeout": 120},   # 成品表公式缓存重算策略（T00962）
}
PROVIDERS = {
    "openai":     {"label": "OpenAI",       "console": "https://platform.openai.com/api-keys",
                   "api": "https://api.openai.com/v1", "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]},
    "anthropic":  {"label": "Claude",        "console": "https://console.anthropic.com/settings/keys",
                   "api": "https://api.anthropic.com/v1", "models": ["claude-3-7-sonnet", "claude-3-5-haiku"]},
    "qwen":       {"label": "通义千问",       "console": "https://dashscope.console.aliyun.com/apiKey_mgmt",
                   "api": "https://dashscope.aliyuncs.com/compatible-mode/v1", "models": ["qwen-plus", "qwen-max"]},
    "bytedance":  {"label": "火山方舟",       "console": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
                   "api": "https://ark.cn-beijing.volces.com/api/v3", "models": ["doubao-1-5-pro-32k"]},
    "agnes":      {"label": "Agnes AI",      "console": "https://agnes-ai.com/console",
                   "api": "https://apihub.agnes-ai.com/v1", "models": ["agnes-2.5-flash", "agnes-2.0-flash"]},
    "custom":     {"label": "自定义(OpenAI兼容)", "console": "", "api": "", "models": []},
}


def load_config():
    """读配置；不存在或损坏时返回默认值。"""
    if CONF_FILE.exists():
        try:
            # utf-8-sig：兼容带 BOM 的配置文件（被外部编辑器改动过），
            # 否则 json.loads 失败会静默回退默认配置，表现为"配置丢失"
            cfg = json.loads(CONF_FILE.read_text(encoding="utf-8-sig"))
            # 合并默认，确保字段齐全
            merged = {"provider": cfg.get("provider", DEFAULT_CONFIG["provider"]),
                      "llm": {**DEFAULT_CONFIG["llm"], **(cfg.get("llm") or {})},
                      "context_dir": cfg.get("context_dir", DEFAULT_CONFIG["context_dir"]),
                      "update_url": cfg.get("update_url", DEFAULT_CONFIG["update_url"]),
                      "recalc": {**DEFAULT_CONFIG["recalc"], **(cfg.get("recalc") or {})}}
            return merged
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT_CONFIG))


def save_config(payload):
    """写入配置到磁盘；payload 中 llm 仅接受合法键。"""
    cfg = load_config()
    if payload.get("provider") in PROVIDERS:
        cfg["provider"] = payload["provider"]
    llm = payload.get("llm") or {}
    for k in ("enabled", "api", "model", "key"):
        if k in llm:
            cfg["llm"][k] = llm[k]
    if "context_dir" in payload:
        cfg["context_dir"] = str(payload["context_dir"] or "").strip()
    if "update_url" in payload:
        cfg["update_url"] = str(payload["update_url"] or "").strip()
    rc = payload.get("recalc") or {}
    if "mode" in rc:      # T00962：只接受合法值，非法一律回退默认
        m = str(rc["mode"] or "").strip().lower()
        cfg["recalc"]["mode"] = m if m in ("async", "sync", "off") else "async"
    if "timeout" in rc:
        try:
            cfg["recalc"]["timeout"] = max(5, min(1800, float(rc["timeout"])))
        except (TypeError, ValueError):
            pass
    CONF_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


# T01481：上传落盘统一走唯一名。原实现用「秒级时间戳 + 原文件名」，
# 同秒并发必然撞同一路径——一个请求正写到一半，另一个就去读它，
# 直接抛 "File is not a zip file" / "Truncated central directory" /
# "Package not found"（实测 recognize 5 并发 60s：610/1122 = 54% 500）。
def _upload_path(name):
    safe = os.path.basename(str(name or UPLOAD_FALLBACK_NAME))
    return UPLOAD / f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}_{safe}"


def _recalc_settings():
    """成品表公式缓存重算策略，优先级：配置中心 > 环境变量 > 内置默认（T00962）。

    注意要读 config.json 原文判断「用户是否真的配置过」：load_config() 会并入默认值，
    若直接用它，环境变量将永远被缺省值挡住，失去部署期覆盖能力。
    """
    try:
        raw = (json.loads(CONF_FILE.read_text(encoding="utf-8-sig")) if CONF_FILE.exists() else {}).get("recalc") or {}
    except Exception:
        raw = {}
    mode = str(raw.get("mode") or "").strip().lower()
    if mode not in ("async", "sync", "off"):
        mode = (os.environ.get("WE_RECALC_MODE") or "async").strip().lower()
        if mode not in ("async", "sync", "off"):
            mode = "async"
    try:
        timeout = float(raw.get("timeout") or 0)
    except (TypeError, ValueError):
        timeout = 0.0
    if timeout <= 0:
        try:
            timeout = float(os.environ.get("WE_RECALC_TIMEOUT") or 120)
        except ValueError:
            timeout = 120.0
    return mode, timeout


def chat_completions_url(api):
    """拼 chat/completions 端点，兼容前端可能已带完整路径。"""
    api = (api or "").rstrip("/")
    return api + CHAT_SUFFIX if not api.endswith(CHAT_SUFFIX) else api


# ---------------- 版本检测与一键更新 ----------------
# 当前版本：Electron 壳 spawn 时注入 WE_APP_VERSION（app.getVersion()）；
# dev 直跑时回退读根 package.json；frozen 且无注入时为 dev
def _detect_app_version():
    env = os.environ.get("WE_APP_VERSION")
    if env:
        return env
    for base in (_RES, _APP_ROOT):
        pj = base / F_PACKAGE_JSON
        if pj.exists():
            try:
                return json.loads(pj.read_text(encoding="utf-8-sig")).get("version") or "dev"
            except Exception:
                pass
    return "dev"


APP_VERSION = _detect_app_version()

_UPDATE_STATE = {"state": "idle", "received": 0, "total": 0, "error": ""}
UPDATE_FILE = APP_DATA / "downloads" / "update-setup.exe"


def _ver_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def check_update():
    """请求更新源 JSON({version,url,notes})，与当前版本比较。由后端代理规避浏览器 CORS。"""
    url = (load_config().get("update_url") or "").strip()
    if not url:
        return {"ok": False, "msg": "未配置更新源", "current": APP_VERSION}
    try:
        req = Request(url, method="GET", headers={"User-Agent": "WorkloadEval/" + APP_VERSION})
        with urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8-sig"))
        latest, pkg = str(data.get("version") or ""), str(data.get("url") or "")
        if not latest or not pkg:
            return {"ok": False, "msg": "更新源数据不完整（需 version 与 url 字段）", "current": APP_VERSION}
        return {"ok": True, "current": APP_VERSION, "latest": latest,
                "hasUpdate": _ver_tuple(latest) > _ver_tuple(APP_VERSION),
                "url": pkg, "notes": str(data.get("notes") or "")}
    except Exception as e:
        return {"ok": False, "msg": f"更新源访问失败：{e}", "current": APP_VERSION}


def _stream_update_to(tmp, req):
    """把响应体按 64KB 分块写入 tmp，同时累计已收字节到进度表。返回 Content-Length。"""
    with urlopen(req, timeout=30) as r, open(tmp, "wb") as f:
        _UPDATE_STATE["total"] = int(r.headers.get("Content-Length") or 0)
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            _UPDATE_STATE["received"] += len(chunk)
    return _UPDATE_STATE["total"]


def _download_update(url):
    try:
        _UPDATE_STATE.update(state="downloading", received=0, total=0, error="")
        UPDATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = UPDATE_FILE.with_suffix(".part")
        req = Request(url, headers={"User-Agent": "WorkloadEval/" + APP_VERSION})
        _stream_update_to(tmp, req)
        os.replace(tmp, UPDATE_FILE)   # 下载完整才替换，中断残留 .part 不影响重下
        _UPDATE_STATE["state"] = "done"
    except Exception as e:
        _UPDATE_STATE["state"] = "error"
        _UPDATE_STATE["error"] = str(e)


def start_update_download(url):
    url = str(url or "").strip()
    if not url:
        return {"ok": False, "msg": "缺少更新包地址"}
    if _UPDATE_STATE["state"] == "downloading":
        return {"ok": True, "msg": "已在下载中"}
    threading.Thread(target=_download_update, args=(url,), daemon=True).start()
    return {"ok": True, "msg": "开始下载"}


def install_update():
    if not UPDATE_FILE.exists():
        return {"ok": False, "msg": "更新包不存在，请先下载"}
    # NSIS 安装器 customInit 会先 taskkill 本应用（壳+sidecar）再覆盖安装，
    # 存量配置由 installer.nsh 抢救逻辑与 _migrate_legacy_data 保证不丢
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen([str(UPDATE_FILE)], cwd=str(UPDATE_FILE.parent), close_fds=True, creationflags=flags)
    return {"ok": True, "msg": "安装器已启动，应用将关闭并开始更新"}


# ---------------- 文档解析 / 识别 ----------------
def _ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()


def _sty(p):
    p_pr = p.find(qn("w:pPr"))
    if p_pr is not None:
        ps = p_pr.find(qn("w:pStyle"))
        if ps is not None:
            return (ps.get(qn("w:val")) or "").strip()
    return ""


def _find_feature_table(doc):
    """定位功能点清单表；返回(表, 列索引字典) 或 (None,None)。"""
    colidx = {"name": None, "type": None, "sys": None, "desc": None}
    for tb in doc.tables:
        head = [c.text.strip() for c in tb.rows[0].cells]
        joined = " ".join(head)
        if not any(k in joined for k in ("功能点", "子功能", "模块", "功能")):
            continue
        for i, h in enumerate(head):
            if colidx["name"] is None and ("名称" in h or "功能" in h): colidx["name"] = i
            if colidx["desc"] is None and "描述" in h: colidx["desc"] = i
            if colidx["type"] is None and "类型" in h: colidx["type"] = i
            if colidx["sys"] is None and "系统" in h: colidx["sys"] = i
        if colidx["name"] is not None:
            return tb, colidx
    return None, None


def _body_subitems(doc):
    """从正文提取可拆分的功能子项（反洗钱类：校验阶段/数据接入/查询导出/参数）。"""
    subs = []
    # 校验阶段表（表头含"校验位置说明"）
    for tb in doc.tables:
        head = " ".join(c.text for c in tb.rows[0].cells)
        if "校验位置" in head:
            for r in tb.rows[1:]:
                cells = [c.text.strip() for c in r.cells]
                if cells and (cells[0] or cells[1]):
                    subs.append((cells[0] or cells[1], " / ".join(x for x in cells[1:3] if x)))
    # 全文特征句
    full = "\n".join(_ptext(p) for p in doc.element.body.iterchildren()
                     if p.tag.rsplit("}", 1)[-1] == "p")
    if re.search(r"查询.{0,3}[和与].{0,3}导出|查询和导出", full):
        subs.append(("中互金关注名单数据查询导出", "对名单数据进行查询和导出"))
    if re.search(r"首次全量.{0,4}增量|全量.{0,2}增量|名单数据.{0,6}(抽取|接入|同步)", full):
        subs.append(("中互金关注名单数据接入同步", "对接数据平台抽取ECIF名单，全量+增量入库"))
    m = re.search(r"新增参数控制.{0,20}校验开关|设置参数控制.{0,20}校验开关|参数控制.{0,15}(校验|名单)", full)
    if m:
        subs.append(("中互金名单校验开关参数", "参数控制校验开关，默认开启"))
    return subs


# 标题层级固定子节名：功能模块标题下挂的说明性小节，不是独立功能点
_HEADING_SUBSECTIONS = {"功能描述", "业务规则", "操作界面", "界面说明", "打印输出", "会计核算",
                        "回单要求", "处理逻辑", "接口说明", "权限控制", "涉及菜单", "前置条件",
                        "后置条件", "功能说明", "业务流程", "界面原型"}


def _outline_level(p):
    """段落标题级别（0=一级标题）。优先取段落级 w:outlineLvl，缺失时回退样式名
    （Heading N / 标题 N → N-1；许多模板把大纲级别定义在样式而非段落上）。无则 None。"""
    p_pr = p._p.find(qn("w:pPr"))
    if p_pr is not None:
        lvl = p_pr.find(qn("w:outlineLvl"))
        if lvl is not None:
            try:
                return int(lvl.get(qn("w:val")))
            except (TypeError, ValueError):
                pass
    name = (p.style.name or "") if p.style else ""
    m = re.match(r"^(?:Heading|标题)\s*(\d+)$", name.strip(), re.I)
    return int(m.group(1)) - 1 if m else None


_REQ_SECTION_KEYWORDS = ("功能需求", "差异需求", "新增需求", "调整需求", "需求")


def _is_req_section(t):
    """一级标题是否需求正文章节。T00851：放宽为识别「差异需求/新增需求/调整需求」等
    需求组织形态，而非只认「功能需求」——银行需求说明书常以「差异需求」作为正文章节名，
    此前只认「功能需求」导致该类文档标题识别零命中、落入占位「待人工识别」。"""
    return any(k in t for k in _REQ_SECTION_KEYWORDS)


_NARRATIVE_HEADING_WORDS = ("背景及目标", "背景", "目标", "总体说明", "参与方及职责",
                            "渠道范围", "涉及的应用系统", "其他说明", "编写目的",
                            "流程图", "流程说明")


def _is_narrative_heading(t):
    """需求章节内的描述性上下文标题（背景/目标/概述/职责/范围等），非独立功能点，
    应从功能候选中剔除，避免识别列表被上下文小节污染（T00851 综合服务回归验证）。"""
    return any(w in t for w in _NARRATIVE_HEADING_WORDS)


def _heading_features(doc):
    """从标题层级提取功能模块标题，章节判定与功能层级均取通用形态。

    兼容三类组织（T00605 / T00851 / T00846）：
    - 章节名：功能需求 / 差异需求 / 新增需求 / 调整需求 等「需求」章节，而非只认功能需求；
    - 功能层级：不锁死某个固定级别，改用「容器排除」——章节内最深一级且有实际描述的非
      说明性标题作为功能候选，其下的说明书子节（功能描述/业务规则/业务要素等）被剔除，
      更深的纯容器标题（如「接口规则」下有接口子标题）不产生功能，避免父容器被计入。
    """
    raw = []  # (lvl, text)
    in_req = False
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if not t:
            continue
        lvl = _outline_level(p)
        if lvl == 0:  # Heading 1：章节边界
            in_req = _is_req_section(t)
            continue
        if not in_req:
            continue
        if t in _HEADING_SUBSECTIONS or _is_narrative_heading(t):
            continue
        if lvl is None:  # 无大纲/样式级别的正文段不是功能标题，跳过避免把层级算乱
            continue
        raw.append((lvl, t))

    # 容器排除：功能标题通常是一组「不同标题」集中在某个层级（如各接口/功能名），
    # 而说明子节（功能描述/业务规则/业务要素等）在不同接口下大量重复出现但种类极少。
    # 取「不同标题种类数量最多的层级」作为功能层保留其全部标题，避免把重复的说明子节
    # 或父容器（线上审批/接口规则等上层分组）当功能，也不会因逐条不同而漏掉功能标题。
    from collections import Counter
    uniq = Counter()
    for l, t in raw:
        uniq[l] += 1
    if not raw:
        return []
    func_lvl = max(uniq, key=uniq.get)  # 不同种类标题数最多的层级
    titles = [t for l, t in raw if l == func_lvl]
    return titles


_SYS_KW = (SYS_TICKET, "票据交易平台", "业务系统", "财务系统", "铁建财务",
           "互联平台", "消息平台", "移动端", "核心系统", "网银", "信贷", "影像")


_SYS_TAIL = (SYS_TICKET, "票据交易系统", "票据交易管理系统", "票据交易平台", "业务系统",
             "财务系统", "综合服务平台", "互联平台", "消息平台")


def _cover_candidates(t, tails):
    """在一行文本里找出所有以系统后缀词结尾的完整词块候选。

    T01501（S3776）：原为 _cover_system_name 内的「后缀词循环 + while 向左延伸」
    双层嵌套，叠加外层段循环后复杂度超阈值。抽离后取候选与挑最长各归一处。
    延伸规则不变：从后缀词起点向左吃掉连续中英文，直到遇非中英文字符。
    """
    cands = []
    for suf in tails:
        idx = t.find(suf)
        while idx >= 0:
            start = idx
            while start > 0 and (t[start - 1].isalpha() or '一' <= t[start - 1] <= '鿿'):
                start -= 1
            cands.append(t[start:idx + len(suf)])
            idx = t.find(suf, idx + 1)
    return cands


def _cover_system_name(doc):
    """从封面标题区（前 20 段）提取完整系统名；未命中返回 None。

    截断口径不变：跳过空行与超 24 字的行，取候选中最长者。
    """
    for p in doc.paragraphs[:20]:
        t = (p.text or "").strip()
        if not t or len(t) > 24:
            continue
        cands = _cover_candidates(t, _SYS_TAIL)
        if cands:
            return max(cands, key=len).strip()
    return None


def _doc_full_text(doc):
    """拼接文档正文所有段落文本（按 body 下的 p 元素顺序）。"""
    return "\n".join(_ptext(p) for p in doc.element.body.iterchildren()
                     if p.tag.rsplit("}", 1)[-1] == "p")


def _extract_doc_system(doc):
    """从文档提取主涉及系统名。

    T00851：system 字段此前硬编码「综合平台」，且不区分文档实际涉及的与票据业务对接的
    系统（铁建财务/移动端/核心/消息平台等）。此函数从文档封面标题与全文统计中识别主系统名，
    替代默认值；未识别到任何系统时才回退「综合平台」，**绝不默认填「票据系统」**
    （约束：系统名称必须从文档内容精准提取，禁止用票据系统兜底）。
    返回单个字符串主系统名（用于 Excel 系统分组，避免多值分组爆炸）。
    """
    # 1) 文档封面标题区：完整系统名通常独占一行且较短
    cover = _cover_system_name(doc)
    if cover:
        return cover
    # 2) 全文按系统关键词出现频次取主系统名。票据类文档正文中「票据」语境高密度出现
    #    （票据/票据业务系统等），优先归并为「票据业务系统」，避免「信贷」等弱词因计数拔高而误判。
    full = _doc_full_text(doc)
    if full.count("票据") >= 10:
        if SYS_TICKET in full or "票据交易" in full or "票据系统" in full:
            return SYS_TICKET
    hits = {}
    for kw in _SYS_KW:
        c = full.count(kw)
        if c:
            hits[kw] = c
    if not hits:
        return "综合平台"  # 文档确实未提及任何系统，才允许通用兜底
    return max(hits, key=hits.get)


def _norm_key(s):
    return re.sub(r"\s+", "", s or "")


def _merge_items(primary, extras):
    """primary 为主来源保序；extras 中与 primary 不重复（规范化后互不包含）的项并入。"""
    seen = {_norm_key(it.get("m1", "")) for it in primary if it.get("m1")}
    out = []
    for it in extras:
        k = _norm_key(it.get("m1", ""))
        if k and not any(k in s or s in k for s in seen):
            seen.add(k)
            out.append(it)
    return out + primary


def recognize_doc(path, llm=None):
    """解析需求文档 → 候选功能点清单（type 复用 guess_type，modify 以清单类型为准）。
    llm: dict(enabled, api, model, key) 或 None；启用时调用大模型对候选做复核/补全。
    """
    doc = Document(str(path))
    items = []
    base_mod = "新增"
    # T00851：system 从文档提取主涉及系统名，替代硬编码「综合平台」，禁止默认「票据系统」
    sys_name = _extract_doc_system(doc)

    tb, colidx = _find_feature_table(doc)
    table_items = []
    if tb is not None:
        for r in tb.rows[1:]:
            c = [x.text.strip() for x in r.cells]
            def ci(k):
                i = colidx.get(k)
                return c[i] if (i is not None and i < len(c)) else ""
            name = ci("name") or ci("desc") or (c[0] if c else "")
            if not name or name.isdigit():
                continue  # 空壳行（仅编号，名称/描述全空）不产生候选
            mt = (ci("type") or "").strip()
            if mt in engine.MODIFY:
                base_mod = mt
            sysv = ci("sys") or sys_name
            table_items.append({
                "system": sysv, "m1": name, "m2": "",
                "desc": f"{name}（来自功能点清单）", "count_item": name,
                "type": guess_type(name, name), "reuse": "中", "modify": base_mod,
                "basis": f"识别自功能点清单，官方类型={mt or '未填'}；AI判{guess_type(name, name)}。",
            })

    # 来源一：功能点清单表格；来源二：正文特征句（反洗钱类）；来源三：文档标题层级
    body = _body_subitems(doc)
    body_items = [{
        "system": table_items[0]["system"] if table_items else sys_name,
        "m1": "业务功能点：反洗钱业务功能优化" if "洗钱" in str(path) else (table_items[0]["m1"] if table_items else ""),
        "m2": "", "desc": d or n, "count_item": n,
        "type": guess_type(d, n), "reuse": "中", "modify": base_mod,
        "basis": f"正文语义识别为{guess_type(d, n)}；官方类型={base_mod}。",
    } for n, d in body] if len(body) >= 2 else []

    head_titles = _heading_features(doc)
    head_items = [{
        "system": sys_name, "m1": t, "m2": "",
        "desc": f"{t}（识别自文档标题）", "count_item": t,
        "type": guess_type(t, t), "reuse": "中", "modify": base_mod,
        "basis": f"识别自文档标题层级（需求章节模块标题）；AI判{guess_type(t, t)}。",
    } for t in head_titles]

    # 主来源选择：标题维度覆盖最全时以标题为主（T00605：标题组织的文档表格/正则只捞到零头），
    # 表格行与正文特征句中未被标题覆盖的项并入；标题不足时维持原有行为。
    if len(head_items) >= max(len(table_items), len(body_items), 2):
        items = _merge_items(head_items, table_items + body_items)
    else:
        items = table_items
        if len(body_items) >= 2:
            items = body_items

    if not items:
        items = [{"system": sys_name, "m1": "待人工识别", "m2": "", "desc": "",
                  "count_item": "待人工识别", "type": "EI", "reuse": "中", "modify": base_mod,
                  "basis": "未在文档中定位到可识别清单，请人工补充。"}]

    # ---------------- LLM 增强（可选；失败不阻断） ----------------
    llm_meta = None
    if llm and llm.get("enabled") and llm.get("api") and llm.get("model") and llm.get("key"):
        try:
            extra, llm_meta = _llm_refine(str(path), items, llm)
            if extra:
                # LLM 补全的项追加到尾部，basis 标记来源
                for x in extra:
                    x["basis"] = (x.get("basis") or "") + " [LLM补全]"
                items.extend(extra)
                llm_meta["added"] = len(extra)
            else:
                llm_meta["added"] = 0
        except Exception as e:
            llm_meta = {"enabled": True, "error": f"{type(e).__name__}: {e}", "added": 0}

    for i, it in enumerate(items, 1):
        it["seq"] = i
    # T01481 P0-3 防御性释放：识别结果已是纯 dict，doc 的 lxml/libxml2 解析树
    # 不再被引用；显式 del + 强制 GC，避免大文档并发下工作集漂移（原生内存 tracemalloc 不可见）
    del doc
    gc.collect()
    return items, llm_meta


def _doc_text_excerpt(path, max_chars=6000):
    """抽取文档前若干段文本作为 LLM 上下文，避免一次性塞全文档。"""
    try:
        doc = Document(path)
        chunks = []
        for p in doc.paragraphs:
            t = p.text.strip()
            if t:
                chunks.append(t)
            if sum(len(c) for c in chunks) > max_chars:
                break
        for tb in doc.tables:
            for row in tb.rows:
                line = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
                if line:
                    chunks.append(line)
                if sum(len(c) for c in chunks) > max_chars:
                    return "\n".join(chunks)
        del doc
        return "\n".join(chunks)[:max_chars]
    except Exception:
        return ""


def _pdf_to_excerpt(path, max_chars):
    """PDF 文本抽取；pypdf 不可用或解析异常时返回空串（调用方据此回退提示）。

    T01501（S3776）：原与 docx 分支交织在 _file_to_excerpt 里，双层 try + 逐页累计
    长度判断使认知复杂度超阈值。拆出后各自只剩一条线性流程。
    截断口径不变：逐页累积超过 max_chars 即停止，最后再按 max_chars 硬截。
    """
    try:
        from pypdf import PdfReader
    except Exception:
        return ""
    try:
        parts, total = [], 0
        for page in PdfReader(str(path)).pages:
            t = (page.extract_text() or "").strip()
            if t:
                parts.append(t)
                total += len(t)
            if total > max_chars:
                break
        return "\n".join(parts)[:max_chars]
    except Exception:
        return ""


def _file_to_excerpt(path, max_chars=6000):
    """按扩展名提取需求文本（docx 用 python-docx，pdf 用 pypdf），供 AI 拆分/识别使用。"""
    ext = os.path.splitext(str(path))[-1].lower()
    if ext == ".pdf":
        return _pdf_to_excerpt(path, max_chars)
    return _doc_text_excerpt(path, max_chars)


# ---------------- 项目上下文目录（AI 估算时注入项目级上下文） ----------------
_CTX_SKIP_DIRS = {"node_modules", "venv", ".venv", ".git", "dist", "release", "build",
                  "__pycache__", ".idea", ".vscode", "target", "out", "logs"}
_CTX_LANG_EXT = {".java", ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".c",
                 ".cpp", ".cs", ".php", ".rb", ".swift", ".kt", ".vue", ".sql"}


def _detect_stack_from_manifest(root):
    """根据工程清单文件推断技术栈，返回 (stack 集合, 命中清单相对路径)。"""
    stack, hits = set(), {}
    for mf in (F_PACKAGE_JSON, "pom.xml", "build.gradle", "requirements.txt",
               "pyproject.toml", "go.mod", "Cargo.toml"):
        f = root / mf
        if f.is_file():
            hits[mf] = str(f)
            if mf == F_PACKAGE_JSON:
                stack.add("Node.js / JS/TS")
            elif mf in ("pom.xml", "build.gradle"):
                stack.add("Java")
            elif mf in ("requirements.txt", "pyproject.toml"):
                stack.add("Python")
            elif mf == "go.mod":
                stack.add("Go")
            elif mf == "Cargo.toml":
                stack.add("Rust")
    if not stack:
        found = set()
        for p in list(root.rglob("*"))[:20000]:
            if p.suffix in _CTX_LANG_EXT:
                found.add(p.suffix)
        # T01501（S1192）：.java/.py 原在此内联 3 次（判断 + 差集 + 差集），
        # 改判定语言须同步 3 处，漏改会静默产生「Java 既不入栈又混进杂项列表」的分叉。
        for ext, label in ((EXT_JAVA, "Java"), (".py", "Python")):
            if ext in found:
                stack.add(label)
        others = found - {EXT_JAVA, ".py"}
        if others:
            stack.add(",".join(sorted(others)))
    return stack, hits


_CTX_MAX_FILES = 20000          # 遍历文件数上限，避免大仓库拖垮
_CTX_MAX_LINES_PER_FILE = 2000  # 单文件行数计入上限，二进制/超大文件不撑爆统计
_CTX_MAX_TOP = 30               # 一级目录/文件各取前 N 个


def _count_code_lines(p):
    """统计单个文件的代码行数（单文件封顶 _CTX_MAX_LINES_PER_FILE）；读失败按 0 计。"""
    try:
        with p.open(encoding="utf-8", errors="ignore") as fh:
            return min(sum(1 for _ in fh), _CTX_MAX_LINES_PER_FILE)
    except Exception:
        return 0


def _walk_project_stats(root):
    """遍历项目统计 (total_files, total_lines, ext_count)。

    T01501（S3776）：原三重判据（上限 / 跳过目录 / 是文件）内嵌在循环里，再套
    try/except 读行，认知复杂度超阈值。拆出后主循环只做「跳过判定 + 累加」。
    遍历口径不变：总数达上限即停；路径含任一跳过目录段即略过；无扩展名文件不计入分布。
    """
    total_files = total_lines = 0
    ext_count = {}
    for p in root.rglob("*"):
        if total_files >= _CTX_MAX_FILES:
            break
        if any(seg in _CTX_SKIP_DIRS for seg in p.parts):
            continue
        if not p.is_file():
            continue
        total_files += 1
        ext = p.suffix.lower()
        if ext:
            ext_count[ext] = ext_count.get(ext, 0) + 1
        if ext in _CTX_LANG_EXT:
            total_lines += _count_code_lines(p)
    return total_files, total_lines, ext_count


def _read_manifest_head(root, manifests):
    """取前 2 个工程清单文件的前 14 行有效内容，拼成 prompt 友好的依赖片段。"""
    dep_lines = []
    for mf, rel in list(manifests.items())[:2]:
        try:
            src = Path(root, rel).read_text(encoding="utf-8", errors="ignore")
            lines = [l.strip() for l in src.splitlines() if l.strip()][:14]
            dep_lines.append(f"[{rel}]\n  " + "\n  ".join(lines))
        except Exception:
            pass
    return dep_lines


def _scan_project_context(root):
    """扫描上下文目录，抽取项目级认知（技术栈/结构/依赖/规模）。"""
    root = Path(root)
    if not root.is_dir():
        return {"ok": False, "error": f"目录不存在: {root}"}
    # 一级子目录与根文件（跳过构建/依赖目录）
    top_dirs = sorted(d.name for d in root.iterdir()
                      if d.is_dir() and d.name not in _CTX_SKIP_DIRS)[:_CTX_MAX_TOP]
    top_files = sorted(f.name for f in root.iterdir() if f.is_file())[:_CTX_MAX_TOP]
    total_files, total_lines, ext_count = _walk_project_stats(root)
    stack, manifests = _detect_stack_from_manifest(root)
    dep_lines = _read_manifest_head(root, manifests)
    return {
        "ok": True, "root": str(root),
        "tech_stack": sorted(stack) or ["未知"],
        "top_dirs": top_dirs, "top_files": top_files,
        "file_stats": sorted(ext_count.items(), key=lambda x: -x[1])[:15],
        "total_files": total_files, "total_lines": total_lines,
        "dep_lines": dep_lines,
    }


def _render_context_text(ctx):
    """把项目上下文对象渲染为 LLM 友好的纯文本（作为 prompt 的「项目级上下文」章节）。"""
    if not ctx.get("ok"):
        return ""
    out = [f"项目根目录: {ctx['root']}",
           "技术栈: " + ", ".join(ctx["tech_stack"]),
           f"规模: 约 {ctx['total_lines']} 行代码 / {ctx['total_files']} 个文件"]
    if ctx["top_dirs"]:
        out.append("一级子目录: " + ", ".join(ctx["top_dirs"]))
    if ctx["top_files"]:
        out.append("根目录关键文件: " + ", ".join(ctx["top_files"]))
    if ctx["file_stats"]:
        out.append("文件类型分布: " + ", ".join(f"{e}:{n}" for e, n in ctx["file_stats"]))
    if ctx["dep_lines"]:
        out.append("关键清单/依赖:")
        out.extend(ctx["dep_lines"])
    return "\n".join(out)


_CONTEXT_CACHE = {}


def _load_project_context(dir_path=None, force=False):
    """返回已配置目录的项目上下文文本（带基于 mtime 的缓存）；未配置或不可用返回空串。"""
    cfg = load_config()
    target = dir_path or cfg.get("context_dir", "")
    if not target:
        return ""
    target = os.path.expandvars(os.path.expanduser(target))
    if not os.path.isdir(target):
        return ""
    key = os.path.abspath(target)
    try:
        mt = os.path.getmtime(key)
    except Exception:
        mt = 0
    if not force and key in _CONTEXT_CACHE and _CONTEXT_CACHE[key][0] == mt:
        return _CONTEXT_CACHE[key][1]
    ctx = _scan_project_context(key)
    text = _render_context_text(ctx) if ctx.get("ok") else ""
    if ctx.get("ok"):
        _CONTEXT_CACHE[key] = (mt, text)
    return text


def _project_prompt_prefix():
    """供 AI 提示词拼接的「项目级上下文」前缀；未配置目录时返回空，不影响主流程。"""
    text = _load_project_context()
    if not text:
        return ""
    return "【项目级上下文】\n" + text + "\n\n"


_LLM_VALID_TYPES = ("ILF", "EIF", "EI", "EO", "EQ")


def _normalize_extras(arr, local_items):
    """把模型返回的数组规整为功能点候选；类型非法的条目直接丢弃。

    T01501（S3776）：原「遍历 → 类型判合法 → 拼字段（含 system 回退三级嵌套）」整段
    内联在 _llm_refine 尾部，与请求/解析逻辑交织。拆出后主函数只剩「调接口 → 解析 → 规整」。
    system 回退口径不变：模型未给则沿用首个本地功能点的系统名，都沒有则「综合平台」。
    """
    fallback_system = (local_items[0]["system"] if local_items else "综合平台")
    extras = []
    if not isinstance(arr, list):
        return extras
    for x in arr:
        if not isinstance(x, dict):
            continue
        t = (x.get("type") or "").strip().upper()
        if t not in _LLM_VALID_TYPES:
            continue
        extras.append({
            "system": x.get("system") or fallback_system,
            "m1": x.get("count_item", ""), "m2": "", "desc": x.get("desc", ""),
            "count_item": x.get("count_item", ""), "type": t,
            "reuse": "中", "modify": "新增",
        })
    return extras


def _llm_refine(path, local_items, llm):
    """调用 OpenAI 兼容接口（Agnes /v1/chat/completions）让模型复核/补全功能点。
    返回 (extra_items, meta)。"""
    url = chat_completions_url(llm["api"])
    excerpt = _doc_text_excerpt(path)
    local_brief = [{"desc": it.get("desc", ""), "count_item": it.get("count_item", ""),
                    "type": it.get("type"), "system": it.get("system")} for it in local_items]
    system = (
        "你是 IFPUG 功能点识别助手。基于需求文档片段和本地初识结果，"
        "指出本地漏检的功能点（最多补充 5 条），每条只输出 JSON 对象，不要任何解释。"
        "字段：count_item(计数项名称), desc(一句话说明), type(ILF/EIF/EI/EO/EQ 之一), system(子系统名)。"
    )
    user = (
        _project_prompt_prefix() +
        "【本地初识】\n" + json.dumps(local_brief, ensure_ascii=False) +
        "\n\n【文档片段】\n" + excerpt +
        "\n\n【输出】仅返回一个 JSON 数组，元素形如 {count_item, desc, type, system}；无补充则返回 []。"
    )
    body = json.dumps({
        "model": llm["model"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.1,
    }, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": AUTH_BEARER + llm["key"],
    })
    t0 = time.time()
    with urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode("utf-8"))
    dt = round(time.time() - t0, 2)
    content = resp["choices"][0]["message"]["content"].strip()
    extras = _normalize_extras(_extract_json_array(content), local_items)
    meta = {"enabled": True, "url": url, "model": llm["model"], "elapsed_s": dt, "added": len(extras)}
    return extras, meta


def _extract_json_array(content):
    """从模型输出中提取 JSON 数组，容忍 ```json 包裹与前后杂讯。"""
    m = re.search(r"\[\s*[\s\S]*?\]\s*$", content)
    arr_text = m.group(0) if m else content
    try:
        return json.loads(arr_text)
    except Exception:
        arr_text = re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", content, flags=re.M), flags=re.M).strip()
        return json.loads(arr_text)


def _llm_pert_split(api, model, key, excerpt):
    """借助大模型把需求文本拆成可独立估算的功能项，并给出 PERT 三值(人天)。
    excerpt 为需求文本；字段满足 phase∈PHASES、0 ≤ optimistic ≤ most_likely ≤ pessimistic。
    """
    url = chat_completions_url(api)
    system = (
        "你是 PERT 三点工作量估算助手。把需求文档拆分为若干个可独立估算的功能/工作项，"
        "并用专家经验给出每项的乐观(O)、最可能(M)、悲观(P)工作量（单位：人天），"
        "必须满足 0 ≤ O ≤ M ≤ P。只输出 JSON 数组，不要任何解释。"
    )
    user = (
        _project_prompt_prefix() +
        "【需求文档片段】\n" + excerpt +
        "\n\n【输出】仅返回一个 JSON 数组，元素形如 "
        "{desc(功能描述), phase(阶段，取其一：需求分析/系统设计/开发/实施/公共及远程/现场维护), "
        "system(所属子系统), optimistic(数字), most_likely(数字), pessimistic(数字)}。"
    )
    body = json.dumps({"model": model,
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": user}],
                       "temperature": 0.1}, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": AUTH_BEARER + key})
    with urlopen(req, timeout=120) as r:
        resp = json.loads(r.read().decode("utf-8"))
    content = resp["choices"][0]["message"]["content"].strip()
    raw = _extract_json_array(content)
    out = []
    if isinstance(raw, list):
        for x in raw:
            if not isinstance(x, dict):
                continue
            desc = (x.get("desc") or "").strip()
            if not desc:
                continue
            phase = x.get("phase") or "开发"
            if phase not in pert.PHASES:
                phase = "开发"
            # 三值归一：非法则置空，由用户补填
            try:
                o, m, p = float(x.get("optimistic")), float(x.get("most_likely")), float(x.get("pessimistic"))
            except (TypeError, ValueError):
                o = m = p = None
            if not (o is not None and 0 <= o <= m <= p):
                o = m = p = None
            out.append({"desc": desc, "phase": phase, "system": (x.get("system") or "").strip(),
                        "optimistic": o, "most_likely": m, "pessimistic": p})
    return out


# ---------------- 诊断包 / 母版目录（T01501：从 do_GET 抽出） ----------------
# 抽出原因：do_GET 是 179 行的路由分发函数，内嵌 zip 打包与目录遍历两个独立职责，
# 使其认知复杂度远超阈值（python:S3776）。抽出后 do_GET 只做「匹配路径 → 调处理器」。

def _build_diag_zip():
    """M8/FR-5.4：打包诊断包（日志 + 脱敏配置 + 版本信息），返回 zip 路径。

    注：T01481 评估过加 TTL 缓存（P1-3），但诊断包按需即时生成是产品语义
    （用户点一次就应拿到当下快照），不为此做语义妥协。
    """
    import zipfile
    os.makedirs(APP_DATA / "diag", exist_ok=True)
    zp = APP_DATA / "diag" / f"diag_{time.strftime('%Y%m%d-%H%M%S')}.zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        lj = APP_DATA / "logs" / "server.jsonl"
        if lj.exists():
            z.write(lj, "logs/server.jsonl")
        for n in (F_RECOGNITION_RULES, F_RATES_VERSIONS, F_SCHEMA_VER):
            f = APP_DATA / n
            if not f.exists():
                continue
            try:
                z.writestr(f"config/{n}", f.read_text(encoding="utf-8"))   # 无密钥字段，原样归档
            except Exception:
                pass
        z.writestr("version.json", json.dumps({
            "app": "workload-estimate", "schema_ver": SCHEMA_VER,
            "python": sys.version.split()[0],
            "routes": ["/api/health", "/api/recognize", "/api/generate", "/api/history",
                       "/api/rules", "/api/rates", "/api/config", "/api/diag",
                       "/api/data/export"]}, ensure_ascii=False, indent=1))
    SLOG.info("diag", "export", size=zp.stat().st_size)
    return zp


def _template_entry(f):
    """母版目录项：同名 .meta.json 提供口径说明；解析失败按空说明处理。"""
    meta = f.with_suffix(".meta.json")
    try:
        m = json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {}
    except Exception:
        m = {}
    return {"name": f.stem, "file": str(f), "note": m.get("note", ""),
            "mapping": m.get("mapping", {})}


def _list_templates():
    """M9/FR-2.8：母版目录（xlsx + meta.json 口径说明），内置母版固定排在首位。"""
    tdir = APP_DATA / DIR_TEMPLATES
    os.makedirs(tdir, exist_ok=True)
    out = [_template_entry(f) for f in sorted(tdir.glob("*.xlsx"))]
    out.insert(0, {"name": "默认母版", "file": str(g.TPL), "note": "内置母版（原始布局）", "mapping": {}})
    return out


# ---------------- HTTP 服务 ----------------
class Handler(BaseHTTPRequestHandler):
    # T01481（P0-1）：HTTP/1.1 长连接复用，消除每请求 TCP 重建
    # （T01369 实测：HTTP/1.0 下持续 20 并发 60s 连接拒绝率 99.49%；
    #   所有响应路径均已带 Content-Length，满足 1.1 分帧要求）
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # 暴露 Content-Disposition，让前端 fetch 也能拿到建议文件名
        self.send_header("Access-Control-Expose-Headers", "Content-Disposition")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_frontend(self):
        # 优先打包资源，其次应用目录；返回 index.html
        p = _RES / "frontend" / "index.html"
        if not p.exists():
            p = _APP_ROOT / "frontend" / "index.html"
        if not p.exists():
            return self._json(404, {"ok": False, "msg": "未找到前端页面"})
        data = p.read_bytes()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        # 前端随版本演进频繁更新：禁缓存，避免浏览器启发式缓存拿到旧页面（改了没生效类问题）
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            # 由引擎 serve 前端（exe 自包含场景）；开发态同样可用
            return self._serve_frontend()
        if u.path == "/health":
            return self._json(200, {"ok": True, "engine": "ready", "us": "105.07 口径"})
        if u.path == "/api/generate/progress":
            # T00927：生成进度轮询（无该 job 记录时返回 progress=null，前端自行降级）
            job = (parse_qs(u.query).get("job") or [""])[0]
            return self._json(200, {"ok": True, "progress": _gen_progress_get(job)})
        if u.path == "/api/rules":
            # M3/FR-2.9：识别规则表读取
            if RULES is None:
                return self._json(503, {"ok": False, "msg": "规则表不可用（已回退内置识别链）"})
            return self._json(200, RULES.list_rules())
        if u.path == "/api/templates":
            # M9/FR-2.8：母版目录（xlsx + meta.json 口径说明）
            return self._json(200, {"ok": True, "templates": _list_templates()})
        if u.path == "/api/i18n":
            # FR-5.5：界面文案字典。lang 收敛为白名单值，不接受任意文件名，
            # 响应中的 lang 也用收敛后的值（不回显原始入参）。
            # 字典缺失仍返 200 + 空 strings：前端 t() 回退显示 key（中文原文），
            # 属可降级增强项，不该让页面因缺翻译而报错。
            q = parse_qs(u.query)
            lang = _i18n_lang((q.get("lang") or [I18N_DEFAULT_LANG])[0])
            return self._json(200, {"ok": True, "lang": lang, "strings": load_i18n(lang)})
        if u.path == "/api/diag":
            # M8/FR-5.4：一键诊断包（日志近7天 + 脱敏配置 + 版本信息；不含 uploads/generated）
            # 注：T01481 评估过加 TTL 缓存（P1-3），但诊断包按需即时生成是产品语义
            # （用户点一次就应拿到当下快照），不为此做语义妥协。
            return self._json(200, {"ok": True, "file": str(_build_diag_zip())})
        if u.path == "/api/data/export":
            # M8/FR-5.6：导出全部数据（pert.db + json + schema_ver）
            import zipfile
            os.makedirs(APP_DATA / "exports", exist_ok=True)
            zp = APP_DATA / "exports" / f"data_{time.strftime('%Y%m%d-%H%M%S')}.zip"
            names = _dk.export_zip(APP_DATA, zp)
            SLOG.info("datakeeper", "data_export", files=len(names))
            return self._json(200, {"ok": True, "file": str(zp), "files": names})
        if u.path == "/api/rates":
            # M6/FR-2.3：费率与基准版本读取
            if RATES is None:
                return self._json(503, {"ok": False, "msg": "费率版本表不可用"})
            return self._json(200, RATES.list())
        # ---------------- M1 估算历史（FR-1.1/1.8/2.5） ----------------
        if u.path == "/api/history":
            if HIST is None:
                return self._json(200, {"ok": False, "msg": "历史功能不可用（存储初始化失败）", "total": 0, "rows": []})
            q = parse_qs(u.query)
            return self._json(200, HIST.list(
                query=(q.get("query") or [""])[0],
                limit=(q.get("limit") or [50])[0],
                offset=(q.get("offset") or [0])[0]))
        m_hist = re.match(r"^/api/history/([0-9a-f]{32})$", u.path)
        if m_hist:
            if HIST is None:
                return self._json(503, {"ok": False, "msg": "历史功能不可用（存储初始化失败）"})
            hid = m_hist.group(1)
            row = HIST.get(hid)
            if not row:
                return self._json(404, {"ok": False, "msg": "历史记录不存在或已被清理"})
            return self._json(200, {"ok": True, "row": row})
        m_grp = re.match(r"^/api/history/([0-9a-f]{32})/group$", u.path)
        if m_grp:
            if HIST is None:
                return self._json(503, {"ok": False, "msg": "历史功能不可用（存储初始化失败）"})
            return self._json(200, HIST.group(m_grp.group(1)))
        # ---------------- M1/FR-FE05：版本间 diff ----------------
        if u.path == "/api/history/diff":
            if HIST is None:
                return self._json(503, {"ok": False, "msg": "历史功能不可用（存储初始化失败）"})
            q = parse_qs(u.query)
            aid = (q.get("a") or [None])[0]
            bid = (q.get("b") or [None])[0]
            if not aid or not bid:
                return self._json(400, {"ok": False,
                    "msg": "需提供 a 与 b 两个版本 id（/api/history/diff?a=<id>&b=<id>）"})
            try:
                d = HIST.diff(aid, bid)
            except Exception as e:
                return self._json(500, {"ok": False, "msg": "diff 计算失败：" + str(e)})
            if not d.get("ok"):
                code = 404 if d.get("which") else 400
                return self._json(code, d)
            return self._json(200, d)
        if u.path == "/api/config":
            # 配置中心：返回持久化配置 + 预设元数据（模型开发商/控制台链接）
            cfg = load_config()
            return self._json(200, {"ok": True, "config": cfg, "providers": PROVIDERS})
        if u.path == "/api/config/models":
            # 获取可用模型列表：优先用已存 key 调 /models；失败回退预设清单
            cfg = load_config()
            lst = PROVIDERS.get(cfg["provider"], {}).get("models", [])
            api = cfg["llm"].get("api") or ""
            key = cfg["llm"].get("key") or ""
            try:
                if api and key:
                    url = chat_completions_url(api).replace(CHAT_SUFFIX, "/models")
                    req = Request(url, method="GET", headers={"Authorization": AUTH_BEARER + key})
                    with urlopen(req, timeout=15) as r:
                        data = json.loads(r.read().decode("utf-8"))
                    ids = [m.get("id") for m in data.get("data", []) if m.get("id")]
                    if ids:
                        lst = ids
            except Exception:
                pass  # 拉取失败时静默回退预设清单，避免连接测试/模型获取因网络而 500
            return self._json(200, {"ok": True, "models": lst, "provider": cfg["provider"]})
        if u.path == "/api/app-info":
            return self._json(200, {"ok": True, "version": APP_VERSION})
        if u.path == "/api/update/check":
            return self._json(200, check_update())
        if u.path == "/api/update/progress":
            return self._json(200, {"ok": True, **_UPDATE_STATE, "file": UPDATE_FILE.exists()})
        if u.path == "/api/context":
            # 返回已配置的项目上下文目录与当前渲染摘要，供配置中心回显
            cfg = load_config()
            return self._json(200, {"ok": True, "context_dir": cfg.get("context_dir", ""),
                                    "rendered": _load_project_context()})
        if u.path == "/api/download":
            q = parse_qs(u.query)
            s = (q.get("s") or [""])[0]
            f = OUTDIR / s
            if f.exists():
                data = f.read_bytes()
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(s)}")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self._json(404, {"ok": False, "msg": "文件不存在"})
        elif u.path.startswith("/static/"):
            # 前端静态资源（引导脚本等）：仅允许 frontend 根下的 .js/.css，防目录穿越
            name = u.path[len("/static/"):]
            fext = os.path.splitext(name)[1].lower()
            if fext not in (".js", ".css") or "/" in name or "\\" in name or ".." in name:
                return self._json(404, {"ok": False, "msg": "静态资源不存在"})
            p = _RES / "frontend" / name
            if not p.exists():
                p = _APP_ROOT / "frontend" / name
            if not p.exists():
                return self._json(404, {"ok": False, "msg": "静态资源不存在"})
            data = p.read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type",
                             "application/javascript" if fext == ".js" else "text/css; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._json(404, {"ok": False})

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            if u.path == "/api/recognize":
                payload = json.loads(raw.decode("utf-8"))
                try:
                    V.check_recognize(payload)
                except V.VErr as e:
                    SLOG.warn("api", "validate_fail", path=u.path, field=e.field)
                    return self._json(400, {"ok": False, "msg": e.msg, "field": e.field})
                name = payload.get("name", UPLOAD_FALLBACK_NAME)
                b64 = payload.get("b64", "")
                src = _upload_path(name)
                src.write_bytes(base64.b64decode(b64))
                params = payload.get("params", {}) or {}
                # 大模型配置优先级：请求内传入 > 配置中心已保存值 > 默认(关闭)
                saved = load_config()["llm"]
                llm = {
                    "enabled": bool(params.get("llm_enabled", saved.get("enabled", False))),
                    "api": (params.get("llm_api") or saved.get("api") or "").strip(),
                    "model": (params.get("llm_model") or saved.get("model") or "").strip(),
                    "key": (params.get("llm_key") or saved.get("key") or "").strip(),
                }
                items, llm_meta = recognize_doc(src, llm if llm["enabled"] else None)
                summary = engine.summary([{"type": i["type"], "reuse": i["reuse"], "modify": i["modify"]} for i in items])
                # 前端在配置中心勾选后，识别请求不再携带 params，此时回退已保存配置；meta 里标记来源
                source = "request" if ("llm_enabled" in params or params.get("enabled")) else "saved"
                return self._json(200, {"ok": True, "items": items, "summary": summary,
                                        "meta": {"params_received": params, "llm": llm_meta, "llm_source": source,
                                                 "llm_enabled_effective": llm["enabled"],
                                                 "rules": (RULES.version() if RULES else {"rules_version": 0})}})

            if u.path == "/api/config":
                # 保存配置中心（大模型）配置
                payload = json.loads(raw.decode("utf-8"))
                cfg = save_config(payload)
                return self._json(200, {"ok": True, "config": cfg})

            if u.path.startswith("/api/history/"):
                # M1：删除历史记录（不删成品文件）
                m_del = re.match(r"^/api/history/([0-9a-f]{32})$", u.path)
                if m_del:
                    if HIST is None:
                        return self._json(503, {"ok": False, "msg": "历史功能不可用（存储初始化失败）"})
                    return self._json(200, {"ok": HIST.delete(m_del.group(1))})

            if u.path == "/api/story/push":
                # M9/FR-2.6：用户故事推送（GitHub Issues 适配器；token 用户自配；失败返回明确错误供重试）
                pl = json.loads(raw.decode("utf-8"))
                token, repo, stories = pl.get("token") or "", pl.get("repo") or "", pl.get("stories") or []
                if not (token and repo and isinstance(stories, list) and stories):
                    return self._json(400, {"ok": False, "msg": "需要 token/repo/stories", "field": "token|repo|stories"})
                ok_n, errs = 0, []
                for st in stories[:50]:
                    try:
                        rq = urllib.request.Request(
                            f"https://api.github.com/repos/{repo}/issues",
                            data=json.dumps({"title": st.get("title", "用户故事"),
                                             "body": st.get("body", "")}).encode(),
                            headers={"Content-Type": "application/json",
                                     "Authorization": f"Bearer {token}",
                                     "Accept": "application/vnd.github+json"}, method="POST")
                        with urllib.request.urlopen(rq, timeout=20) as resp:
                            ok_n += 1
                    except Exception as e:
                        errs.append(f"{st.get('title','?')}: {e}")
                if errs and ok_n == 0:
                    SLOG.warn("story", "push_fail", errs=errs[:3])
                    return self._json(502, {"ok": False, "msg": "；".join(errs[:3]), "retry": True})
                SLOG.info("story", "push", ok=ok_n, fail=len(errs))
                return self._json(200, {"ok": True, "pushed": ok_n, "errors": errs})
            if u.path == "/api/templates/save":
                # M9/FR-2.8：上传新母版 + 口径说明（列映射由向导记录进 meta）
                pl = json.loads(raw.decode("utf-8"))
                name, b64, note, mapping = pl.get("name"), pl.get("b64"), pl.get("note", ""), pl.get("mapping", {})
                if not name or not re.fullmatch(r"[\w一-鿿-]{1,40}", name):
                    return self._json(400, {"ok": False, "msg": "母版名称非法", "field": "name"})
                tdir = APP_DATA / DIR_TEMPLATES
                os.makedirs(tdir, exist_ok=True)
                (tdir / f"{name}.xlsx").write_bytes(base64.b64decode(b64))
                (tdir / f"{name}.meta.json").write_text(
                    json.dumps({"note": note, "mapping": mapping}, ensure_ascii=False, indent=1), encoding="utf-8")
                SLOG.info("templates", "saved", name=name)
                return self._json(200, {"ok": True})
            if u.path == "/api/data/import":
                # M8/FR-5.6：导入全部数据（校验 schema；导入前自动备份）
                import tempfile
                tmp = APP_DATA / "imports"
                os.makedirs(tmp, exist_ok=True)
                fp = tmp / f"import_{int(time.time())}.zip"
                fp.write_bytes(raw)
                try:
                    names = _dk.import_zip(fp, APP_DATA)
                except _dk.VImportErr as e:
                    SLOG.warn("datakeeper", "data_import_fail", err=str(e))
                    return self._json(400, {"ok": False, "msg": str(e)})
                try:
                    if RULES is not None:
                        RULES.reload()
                    if RATES is not None:
                        RATES.reload()
                except Exception as _e:
                    SLOG.warn("datakeeper", "reload_after_import_fail", err=str(_e))
                SLOG.info("datakeeper", "data_import", files=len(names))
                return self._json(200, {"ok": True, "files": names})
            if u.path == "/api/rates/save":
                # M6/FR-2.3：费率与基准整表保存（负数/超界 400）
                if RATES is None:
                    return self._json(503, {"ok": False, "msg": "费率版本表不可用"})
                doc = json.loads(raw.decode("utf-8"))
                try:
                    v = RATES.save(doc)
                except Exception as e:
                    return self._json(400, {"ok": False, "msg": f"费率数据非法：{e}"})
                return self._json(200, {"ok": True, "version": v})
            if u.path == "/api/rules/save":
                # M3/FR-2.9：整表保存（配置中心编辑 / 驳回流沉淀），坏正则返回 400
                if RULES is None:
                    return self._json(503, {"ok": False, "msg": "规则表不可用（已回退内置识别链）"})
                payload = json.loads(raw.decode("utf-8"))
                rules = payload.get("rules")
                if not isinstance(rules, list):
                    return self._json(400, {"ok": False, "msg": "rules 必须为数组"})
                try:
                    v = RULES.save(rules)
                except Exception as e:
                    return self._json(400, {"ok": False, "msg": f"规则校验失败：{e}"})
                return self._json(200, {"ok": True, "version": v})

            if u.path == "/api/context/config":
                # 保存项目上下文目录配置
                payload = json.loads(raw.decode("utf-8"))
                cfg = save_config({"context_dir": payload.get("context_dir", "")})
                return self._json(200, {"ok": True, "context_dir": cfg.get("context_dir", "")})

            if u.path == "/api/update/config":
                # 保存更新源 URL 配置
                payload = json.loads(raw.decode("utf-8"))
                cfg = save_config({"update_url": payload.get("update_url", "")})
                return self._json(200, {"ok": True, "update_url": cfg.get("update_url", "")})

            if u.path == "/api/update/download":
                payload = json.loads(raw.decode("utf-8"))
                return self._json(200, start_update_download(payload.get("url")))

            if u.path == "/api/update/install":
                return self._json(200, install_update())

            if u.path == "/api/context/analyze":
                # 手动触发扫描/重算项目上下文；入参可选覆盖目录（不落盘）
                payload = json.loads(raw.decode("utf-8"))
                target = (payload.get("context_dir") or "").strip() or None
                text = _load_project_context(target, force=True)
                if not text:
                    return self._json(400, {"ok": False, "msg": "目录未配置或不可用"})
                return self._json(200, {"ok": True, "rendered": text})

            if u.path == "/api/pickdir":
                # 弹出本机原生目录选择对话框，返回绝对路径供前端自动填入输入框。
                # Windows 走 PowerShell + WinForms FolderBrowserDialog（exe 自包含必可用，
                # 不依赖 tkinter —— 本机/打包环境可能缺 tkinter 纯 Python 包）；其他平台回退 tkinter。
                picked = ""
                try:
                    if os.name == "nt":
                        import subprocess
                        ps = ("Add-Type -AssemblyName System.Windows.Forms; "
                              "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                              "$f.Description = '选择项目上下文目录'; "
                              "if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)"
                              "{[Console]::Out.Write($f.SelectedPath)}")
                        proc = subprocess.run(
                            ["powershell", "-STA", "-NoProfile", "-NonInteractive", "-Command", ps],
                            capture_output=True, text=True, timeout=300,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                        picked = (proc.stdout or "").strip()
                    else:
                        import tkinter as tk
                        from tkinter import filedialog
                        tk_root = tk.Tk()
                        tk_root.withdraw()
                        tk_root.attributes("-topmost", True)
                        picked = filedialog.askdirectory(title="选择项目上下文目录") or ""
                        tk_root.destroy()
                except Exception as e:
                    return self._json(500, {"ok": False, "msg": f"打开目录选择失败: {type(e).__name__}: {e}"})
                picked = picked.strip()
                if not picked:
                    return self._json(200, {"ok": False, "canceled": True, "msg": "未选择目录"})
                return self._json(200, {"ok": True, "path": os.path.normpath(picked)})

            if u.path == "/api/config/test":
                # 连接测试：用请求内（未落盘）或已存配置对 chat/completions 发一条最小请求
                payload = json.loads(raw.decode("utf-8"))
                llm_in = payload.get("llm") or {}
                saved = load_config()["llm"]
                api = (llm_in.get("api") or saved.get("api") or "").strip()
                model = (llm_in.get("model") or saved.get("model") or "").strip()
                key = (llm_in.get("key") or saved.get("key") or "").strip()
                if not (api and key):
                    return self._json(400, {"ok": False, "msg": "请先填写 API 地址与 Key"})
                url = chat_completions_url(api)
                body = json.dumps({
                    "model": model or "gpt-4o-mini",
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                }, ensure_ascii=False).encode("utf-8")
                t0 = time.time()
                try:
                    req = Request(url, data=body, method="POST", headers={
                        "Content-Type": "application/json", "Authorization": AUTH_BEARER + key})
                    with urlopen(req, timeout=20) as r:
                        resp = json.loads(r.read().decode("utf-8"))
                    dt = round(time.time() - t0, 2)
                    choice = (resp.get("choices") or [{}])[0]
                    snippet = (choice.get("message") or {}).get("content") or ""
                    return self._json(200, {"ok": True, "elapsed_s": dt, "model": model,
                                            "reply": snippet.strip()[:100]})
                except HTTPError as e:
                    return self._json(502, {"ok": False, "msg": f"HTTP {e.code}: {e.read().decode('utf-8', errors='ignore')[:200]}"})
                except Exception as e:
                    return self._json(502, {"ok": False, "msg": f"{type(e).__name__}: {e}"})

            if u.path == "/api/generate":
                payload = json.loads(raw.decode("utf-8"))
                job = str(payload.get("job") or "")
                _gen_progress_set(job, 5, "正在校验并整理候选清单…")
                its = payload.get("items", [])
                # 母版明细区已支持动态扩容（T00606）；此处仅保留防呆上限，拦截明显异常的超大批量
                if len(its) > 2000:
                    _gen_progress_set(job, 100, "生成失败", done=True,
                                      error=f"确认功能点 {len(its)} 条超出合理范围（>2000）")
                    return self._json(400, {"ok": False, "msg":
                        f"确认功能点 {len(its)} 条超出合理范围（>2000），请核对后再生成。"})
                items = []
                for i, it in enumerate(its, 1):
                    r = dict(it); r["seq"] = i
                    r.setdefault("m1", ""); r.setdefault("m2", ""); r.setdefault("m3", ""); r.setdefault("m4", "")
                    r.setdefault("reuse", "中"); r.setdefault("modify", "新增")
                    items.append(r)
                method = payload.get("method", "估算功能点")
                # T00866：生成文件名 = 需求标题 + "-工作量评估.xlsx"。需求标题取前端上传文档
                # 文件名基名（title），无则回退时间戳。净化 Windows 非法字符，保留原意不截断。
                req_title = (payload.get("title") or "").strip()
                if req_title:
                    # 剥离需求文档扩展名（前端已处理，这里兜底），再净化 Windows 非法字符
                    req_title = re.sub(r"\.(docx|doc|pdf|xlsx|xls)\s*$", "", req_title, flags=re.I).strip()
                    sid = re.sub(r'[\\/:*?"<>|]', "", req_title) + "-工作量评估.xlsx"
                else:
                    sid = f"output_{int(time.time())}.xlsx"
                out = OUTDIR / sid
                _gen_progress_set(job, 15, "正在生成成品表（填充母版明细）…")
                recalc_info = {}      # T00931：由 run_from_json 回填公式缓存重算的调度结果
                recalc_mode, recalc_timeout = _recalc_settings()   # T00962：配置中心 > 环境变量 > 默认
                try:
                    try:
                        V.check_generate(payload)
                    except V.VErr as e:
                        SLOG.warn("api", "validate_fail", path=u.path, field=e.field)
                        return self._json(400, {"ok": False, "msg": e.msg, "field": e.field})
                    _tpl = payload.get("template") or None
                    if _tpl:
                        _tp = Path(_tpl)
                        _tpl = str(_tp) if _tp.exists() and str(_tp.resolve()).startswith(str(APP_DATA.resolve()) + os.sep + "templates") and _tp.suffix == ".xlsx" else None
                    _gb_state = payload.get("gb_state") if isinstance(payload.get("gb_state"), dict) else None
                    _brand = (payload.get("brand_color") or "").strip()
                    _brand = _brand if re.fullmatch(r"#[0-9a-fA-F]{6}", _brand) else None   # FR-4.2：非法色值后端拒绝（回退母版默认）
                    with _title_lock(str(out)):
                        g.run_from_json(items, str(out), method=method,
                                        brand_color=_brand, gb_state=_gb_state, template=_tpl,
                                        on_progress=lambda p, s: _gen_progress_set(job, p, s),
                                        recalc_info=recalc_info,
                                        recalc_mode=recalc_mode, recalc_timeout=recalc_timeout,
                                        on_recalc_state=lambda st: _gen_recalc_set(job, st))
                    _gen_progress_set(job, 96, "正在汇总评估结果…")
                    summary = engine.summary([{"type": i["type"], "reuse": i["reuse"], "modify": i["modify"]} for i in items], method=method)
                except Exception as e:
                    # 失败也落到进度表：前端据此把进度条转红并给出错误文案
                    _gen_progress_set(job, 100, "生成失败", done=True, error=str(e))
                    raise
                recalc_mode = recalc_info.get("mode", "off")
                _gen_progress_set(job, 100, "生成完成（公式缓存后台补算中）" if recalc_mode == "async" else "生成完成",
                                  done=True)
                # M1/FR-1.1：估算历史落库（失败仅记日志，不影响生成响应）
                # T01497：engine.summary 只产出 ufp/us，历史列表的「功能点 / US 合计」
                # 两列与 FR-FE05 diff 的 ΔUS 都读 summary.count / summary.us_total，
                # 缺失会让这两处恒显「—」。此处按落库明细补齐两个派生字段（不改引擎口径）。
                history_id = None
                if HIST is not None:
                    try:
                        hist_items = (payload.get("hist_items") or items)
                        hist_summary = dict(summary or {})
                        hist_summary.setdefault("count", len(hist_items))
                        if "us_total" not in hist_summary:
                            # total_us 对非法 type/reuse/modify 会抛错，脏明细不应连带历史落库失败
                            try:
                                hist_summary["us_total"] = engine.total_us(hist_items, method)
                            except Exception:
                                hist_summary["us_total"] = summary.get("us") if isinstance(summary, dict) else None
                        hist = HIST.insert(
                            title=req_title or sid, source_name=payload.get("source_name") or None,
                            method=method,
                            params={"llm_enabled": payload.get("llm_enabled"),
                                    "fee_version": payload.get("fee_version"),
                                    "recalc_mode": recalc_mode},
                            items=hist_items,
                            summary=hist_summary, sid=sid, reopen_group=payload.get("reopen_group") or None)
                        history_id = hist["id"]
                    except Exception as e:
                        print(f"[history] 落库失败（不影响生成）: {type(e).__name__}: {e}", flush=True)
                return self._json(200, {"ok": True, "sid": sid, "items": items, "summary": summary,
                                        "recalc": recalc_mode, "history_id": history_id})

            # ---------------- PERT 三点估算 ----------------
            if u.path == "/api/pert/project":
                payload = json.loads(raw.decode("utf-8"))
                name = (payload.get("name") or "").strip()
                if not name:
                    return self._json(400, {"ok": False, "msg": "项目名称不能为空"})
                con = _pert_connect()
                # 重名拦截：同名人天估算项目不应重复创建，避免前端选择歧义
                dup = con.execute("SELECT id FROM projects WHERE name=? LIMIT 1", (name,)).fetchone()
                if dup:
                    con.close()
                    return self._json(409, {"ok": False, "msg": "项目名已存在", "project_id": dup[0]})
                cur = con.execute("INSERT INTO projects(name,estimator) VALUES(?,?)",
                                  (name, (payload.get("estimator") or "").strip()))
                pid = cur.lastrowid
                con.commit(); con.close()
                return self._json(200, {"ok": True, "project_id": pid})

            if u.path == "/api/pert/projects":
                # 列出所有项目（按创建时间倒序），供前端下拉选择
                con = _pert_connect()
                rows = con.execute(
                    "SELECT id,name,estimator,created_at FROM projects ORDER BY id DESC").fetchall()
                con.close()
                return self._json(200, {"ok": True, "projects": [
                    {"id": r[0], "name": r[1], "estimator": r[2], "created_at": r[3]} for r in rows]})

            if u.path == "/api/pert/list":
                payload = json.loads(raw.decode("utf-8"))
                pid = payload.get("project_id")
                con = _pert_connect()
                p = con.execute("SELECT id,name,estimator FROM projects WHERE id=?", (pid,)).fetchone()
                if not p:
                    con.close()
                    return self._json(404, {"ok": False, "msg": "项目不存在"})
                items = con.execute(
                    "SELECT id,phase,system,module,desc,optimistic,most_likely,pessimistic "
                    "FROM pert_items WHERE project_id=? ORDER BY id", (pid,)).fetchall()
                summary = pert.summarize(con, pid)
                con.close()
                return self._json(200, {
                    "ok": True, "project": {"id": p[0], "name": p[1], "estimator": p[2]},
                    "items": [{"id": i[0], "phase": i[1], "system": i[2], "module": i[3],
                               "desc": i[4], "optimistic": i[5], "most_likely": i[6],
                               "pessimistic": i[7]} for i in items],
                    "summary": summary})

            if u.path == "/api/pert/item":
                payload = json.loads(raw.decode("utf-8"))
                pid = payload.get("project_id")
                it_id = payload.get("id")
                # 三值非负且（全部填齐时）满足 乐观 ≤ 最可能 ≤ 悲观；允许留空逐步补填
                def _num(v):
                    if v is None or isinstance(v, str) and not v.strip():
                        return None
                    return float(v)
                o, m, p = _num(payload.get("optimistic")), _num(payload.get("most_likely")), _num(payload.get("pessimistic"))
                try:
                    if (o is not None and o < 0) or (m is not None and m < 0) or (p is not None and p < 0):
                        return self._json(400, {"ok": False, "msg": "估算值不能为负"})
                    if o is not None and m is not None and p is not None and not (o <= m <= p):
                        return self._json(400, {"ok": False, "msg": "需满足 乐观 ≤ 最可能 ≤ 悲观"})
                except (TypeError, ValueError):
                    return self._json(400, {"ok": False, "msg": "乐观/最可能/悲观必须为数字"})
                phase = payload.get("phase") or "开发"
                if phase not in pert.PHASES:
                    return self._json(400, {"ok": False, "msg": f"阶段须为: {','.join(pert.PHASES)}"})
                desc = (payload.get("desc") or "").strip()
                if not desc:
                    return self._json(400, {"ok": False, "msg": "功能描述不能为空"})
                fields = (pid, phase, payload.get("system", ""),
                          payload.get("module", ""), desc, o, m, p)
                con = _pert_connect()
                if it_id:
                    con.execute("UPDATE pert_items SET phase=?,system=?,module=?,desc=?,"
                                "optimistic=?,most_likely=?,pessimistic=? WHERE id=?",
                                fields[1:] + (it_id,))
                    con.commit(); con.close()
                    return self._json(200, {"ok": True, "id": it_id})
                cur = con.execute("INSERT INTO pert_items(project_id,phase,system,module,desc,"
                                  "optimistic,most_likely,pessimistic) VALUES(?,?,?,?,?,?,?,?)", fields)
                new_id = cur.lastrowid
                con.commit(); con.close()
                return self._json(200, {"ok": True, "id": new_id})

            if u.path == "/api/pert/delete":
                payload = json.loads(raw.decode("utf-8"))
                con = _pert_connect()
                con.execute("DELETE FROM pert_items WHERE id=? AND project_id=?",
                            (payload.get("id"), payload.get("project_id")))
                con.commit(); con.close()
                return self._json(200, {"ok": True})

            if u.path == "/api/pert/import":
                # 需求输入 → PERT 候选估算项：支持 docx/pdf/自由文本(text)。
                # LLM 拆分+评估三值；docx 可回退本地识别(仅描述)，pdf/自由文本需大模型。
                payload = json.loads(raw.decode("utf-8"))
                pid = payload.get("project_id")
                if not pid:
                    return self._json(400, {"ok": False, "msg": "请先新建或选择项目"})
                b64 = payload.get("b64")
                text = (payload.get("text") or "").strip()
                saved = load_config()["llm"]
                # T00928：前端可携带配置中心「启用大模型辅助识别」开关的当前状态；
                # 未携带（null/缺省）时回退已保存配置，保持原有行为不变。
                llm_flag = payload.get("llm_enabled")
                llm_on = bool(saved.get("enabled")) if llm_flag is None else bool(llm_flag)
                llm_ready = bool(llm_on and saved.get("api") and saved.get("key"))
                excerpt = None
                src_path = None
                fname = payload.get("name", UPLOAD_FALLBACK_NAME)
                if text:
                    excerpt = text  # 自由文本直取
                elif b64:
                    src_path = _upload_path(fname)
                    src_path.write_bytes(base64.b64decode(b64))
                else:
                    return self._json(400, {"ok": False, "msg": "请提供需求文本或上传 Word/PDF"})
                is_docx = bool(src_path) and os.path.splitext(str(src_path))[-1].lower() == ".docx"
                source = "local"
                candidates = []
                if llm_ready:
                    if excerpt is None:
                        excerpt = _file_to_excerpt(src_path, max_chars=6000)
                    try:
                        candidates = _llm_pert_split(saved["api"], saved["model"], saved["key"], excerpt or "")
                        source = "llm" if candidates else "local"
                    except Exception as e:
                        candidates = []
                        print(f"[pert/import] LLM 拆分失败，回退本地: {type(e).__name__}: {e}")
                # 仅 docx 可在无大模型时走本地识别；pdf/自由文本无大模型则无法拆分
                if not candidates and is_docx:
                    items, _ = recognize_doc(src_path, None)
                    candidates = [{"desc": (it.get("desc") or it.get("count_item") or "").strip(),
                                   "phase": "开发", "system": it.get("system", ""),
                                   "optimistic": None, "most_likely": None, "pessimistic": None}
                                  for it in items if (it.get("desc") or it.get("count_item") or "").strip()]
                if not candidates:
                    if llm_on and not (saved.get("api") and saved.get("key")):
                        msg = "配置中心已启用大模型辅助识别，但 API 地址 / Key 未填全，无法进行 AI 拆分；docx 已回退本地识别。"
                    else:
                        msg = "未能拆分出候选功能点。若为自由文本/PDF，请先在配置中心启用大模型；docx 已回退本地识别。"
                    return self._json(400, {"ok": False, "msg": msg})
                # T01573：由文档导入成功时，记住需求文档基名（去扩展名），供成品表命名
                if src_path:
                    _c = _pert_connect()
                    pert.set_doc_name(_c, pid, os.path.splitext(os.path.basename(str(fname)))[0])
                    _c.close()
                return self._json(200, {"ok": True, "candidates": candidates, "source": source,
                                        "llm_enabled_effective": llm_on})

            if u.path == "/api/pert/import/confirm":
                # 把前端勾选确认的候选批量写入估算项，三值可空由用户后续补。
                # 启用大模型（replace=true）时先清空该项目既有明细，避免 AI 拆分与人工录入并存造成重复。
                payload = json.loads(raw.decode("utf-8"))
                pid = payload.get("project_id")
                con = _pert_connect()
                if not con.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
                    con.close()
                    return self._json(404, {"ok": False, "msg": "项目不存在"})
                if payload.get("replace"):
                    con.execute("DELETE FROM pert_items WHERE project_id=?", (pid,))
                added = 0; seen = set()
                for it in payload.get("items", []) or []:
                    desc = (it.get("desc") or "").strip()
                    if not desc or desc in seen:
                        continue
                    seen.add(desc)
                    if con.execute("SELECT 1 FROM pert_items WHERE project_id=? AND desc=?",
                                   (pid, desc)).fetchone():
                        continue
                    phase = it.get("phase") or "开发"
                    if phase not in pert.PHASES:
                        phase = "开发"
                    try:
                        o, m, p = float(it.get("optimistic")), float(it.get("most_likely")), float(it.get("pessimistic"))
                    except (TypeError, ValueError):
                        o = m = p = None
                    if not (o is not None and 0 <= o <= m <= p):
                        o = m = p = None
                    con.execute("INSERT INTO pert_items(project_id,phase,system,module,desc,optimistic,most_likely,pessimistic) "
                                "VALUES(?,?,?,?,?,?,?,?)",
                                (pid, phase, it.get("system", ""), it.get("module", ""), desc, o, m, p))
                    added += 1
                con.commit(); con.close()
                return self._json(200, {"ok": True, "added": added})

            if u.path == "/api/pert/generate":
                payload = json.loads(raw.decode("utf-8"))
                pid = payload.get("project_id")
                con = _pert_connect()
                name, estimator, rows = pert.rows_for_generate(con, pid)
                if not rows:
                    con.close()
                    return self._json(400, {"ok": False, "msg": "无估算项，请先录入"})
                # 生成前校验三值完整性：任一为空则 H 列公式会 #DIV/0!，先提示补全
                missing = [r.get("desc") or "未命名项" for r in rows
                           if r.get("optimistic") is None or r.get("most_likely") is None or r.get("pessimistic") is None]
                if missing:
                    con.close()
                    shown = "、".join(missing[:3])
                    return self._json(400, {"ok": False,
                                            "msg": f"存在 {len(missing)} 项未填三值，请先补全：{shown}{'…' if len(missing) > 3 else ''}"})
                # T01573：成品表文件名 = 需求文档基名（缺则项目名）+ "-PERT估算-V{自增版本}.xlsx"
                _dn = con.execute("SELECT doc_name FROM projects WHERE id=?", (pid,)).fetchone()
                base = (_dn[0] if _dn and _dn[0] else "") or name
                base = re.sub(r"\.(docx|doc|pdf|xlsx|xls)\s*$", "", str(base).strip(), flags=re.I)
                base_clean = re.sub(r'[\\/:*?"<>|]', "", base)      # 净化 Windows 非法字符（与 IFPUG 同口径）
                ver_no = pert.next_gen_version(con, pid)            # 自增并落库：V1、V2…
                sid = f"{base_clean}-PERT估算-V{ver_no}.xlsx"
                out = OUTDIR / sid
                pert.generate(name, rows, str(out),
                              est_date=payload.get("est_date"), estimator=estimator,
                              tpl=payload.get("tpl"))
                summary = pert.summarize(con, pid)
                con.close()
                return self._json(200, {"ok": True, "sid": sid, "summary": summary})

            if u.path == "/api/pert/savecfg":
                payload = json.loads(raw.decode("utf-8"))
                con = _pert_connect()
                pert.save_cfg(con, payload.get("project_id"), payload.get("cfg", {}))
                con.close()
                return self._json(200, {"ok": True, "cfg": pert.load_cfg(sqlite3.connect(_PERT_DB), payload.get("project_id"))})
        except Exception as e:
            return self._json(500, {"ok": False, "msg": str(e)})
        self._json(404, {"ok": False})

    def log_message(self, *a):
        pass  # 静默：BaseHTTPRequestHandler 每请求默认打一行日志，会刷屏


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    port = int(args[0]) if args else 8020
    if "--serve-frontend" in sys.argv or getattr(sys, "frozen", False):
        print(f"前端由本服务提供: http://127.0.0.1:{port}")
    print(f"本地服务已启动: http://127.0.0.1:{port}  (Ctrl+C 退出)")
    # frozen(exe) 默认自动打开浏览器；传 --no-open 可关闭
    if "--open" in sys.argv or (getattr(sys, "frozen", False) and "--no-open" not in sys.argv):
        webbrowser.open(f"http://127.0.0.1:{port}")
    # T01481（P0-1）：默认 request_queue_size=5，瞬时并发直接 backlog 溢出拒绝连接
    # （T01369 实测：ramp 后第 1 秒 631 个 HttpHostConnectException）；daemon 线程保证退出不等请求
    class QuietServer(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 128

    QuietServer(("127.0.0.1", port), Handler).serve_forever()