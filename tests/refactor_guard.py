# -*- coding: utf-8 -*-
"""T01501 重构守门：金标准行为快照。

重构（认知复杂度拆分 / 常量提取）**不应改变任何可观测行为**。本脚本在重构前后
各跑一次，对关键 API 响应做归一化快照并逐字节比对，作为比「测试全绿」更严格的
守门——测试可能覆盖不到的分支（错误路径、默认值、边界）在这里被钉住。

用法：python tests/refactor_guard.py <base.json> --save   # 打基线
      python tests/refactor_guard.py <base.json>           # 比对
退出码：0 = 行为一致；1 = 有差异（列出具体字段）。
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

PORT = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else "8092"
API = f"http://127.0.0.1:{PORT}"
BASE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "logs/_t1501_base.json"
SAVE = "--save" in sys.argv
# T01501（S1192）：口径名在下方多处出现，提取常量
METHOD = "估算功能点"
DOCX = "data/testdocs/t00928_req.docx"
CX_DEFAULT = "中"      # 补默认复杂度
EP_GENERATE = "/api/generate"   # T01501(S1192)：接口路径原内联 4 处


def call(path, payload=None, method=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return {"status": r.status, "body": json.loads(r.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        # 错误路径也是行为的一部分（状态码 + 错误文案），必须钉住
        return {"status": e.code, "body": json.loads(e.read().decode("utf-8") or "{}")}


def norm(d, drop_keys=("duration", "elapsed", "created_at", "updated_at", "ts", "timestamp",
                       # 以下三项每次调用必变，属运行期标识而非行为，纳入比对会淹没真实差异：
                       "history_id",   # uuid，历史记录主键
                       "sid",          # 输出文件名含时间戳
                       "recalc",       # async/busy/skip 取决于当次 Excel COM 是否占用
                       "file",         # 诊断包文件名含时间戳
                       )):
    """递归剔除时间戳/耗时/随机标识类易变字段，其余原样保留（顺序敏感的列表也不排序）。"""
    if isinstance(d, dict):
        return {k: norm(v) for k, v in sorted(d.items()) if k not in drop_keys}
    if isinstance(d, list):
        return [norm(x) for x in d]
    return d


snap = {}
# 0) 关键前提：显式关闭大模型辅助识别。
#    本机 config.json 里存着 LLM 凭据且 enabled=true，识别链路会调外部接口
#    （_llm_refine）。该接口的可用性/返回条数不受代码控制：同一份代码两次运行
#    可能一次 SSL 失败（+0 条）、一次成功（+1 条），进而改变 items 与 US 合计，
#    会被守门脚本误报成「重构改了行为」。故快照一律在 llm_enabled=false 下进行。
#    注：S1-S9 套件本身不受影响（S3 显式传 llm_enabled=false）。
LLM_OFF = {"llm_enabled": False}
_cfg = call("/api/config")
if _cfg.get("body", {}).get("ok"):
    _saved = _cfg["body"].get("config", {}).get("llm", {})
    if _saved.get("enabled"):
        print("[guard] 检测到已保存的 LLM 凭据且启用中；快照将显式以 llm_enabled=false 执行")

# 1) 金标准：health 的 US 口径
snap["health"] = norm(call("/health"))

# 2) 规则表（识别链路根基）
snap["rules"] = norm(call("/api/rules"))

# 3) 识别：功能点类型/复杂度/重用度全量
doc = base64.b64encode(open(DOCX, "rb").read()).decode()
rec = call("/api/recognize", {"name": os.path.basename(DOCX), "b64": doc, "job": "guard_rec", **LLM_OFF})
snap["recognize"] = norm(rec)

# 4) 生成：US 合计 / 工作量 / 费用（金标准 105.07 的来源）
if rec.get("body", {}).get("ok"):
    items = rec["body"]["items"]
    hist = [{**it, "cx": CX_DEFAULT, "ok": True} for it in items]
    snap["generate"] = norm(call(EP_GENERATE, {"items": items, "method": METHOD,
                                                    "title": "T01501-guard", "job": "guard_gen",
                                                    "hist_items": hist, **LLM_OFF}))

# 5) 错误路径：各类非法输入的拒绝行为
snap["err_empty_items"] = norm(call(EP_GENERATE, {"items": [], "job": "g1"}))
snap["err_bad_type"] = norm(call(EP_GENERATE, {"items": [{"type": "XX", "reuse": "中", "modify": "新增"}], "job": "g2"}))
snap["err_bad_brand"] = norm(call(EP_GENERATE, {"items": items, "method": METHOD,
                                                    "job": "g3", "brand_color": "nope"}))
snap["err_diff_noargs"] = norm(call("/api/history/diff"))
snap["err_diff_bogus"] = norm(call("/api/history/diff?a=ffffffffffffffffffffffffffffffff&b=ffffffffffffffffffffffffffffffff"))
snap["err_history_404"] = norm(call("/api/history/ffffffffffffffffffffffffffffffff"))
snap["err_rules_badre"] = norm(call("/api/rules/save", {"rules": [{"id": "X", "patterns": ["(["], "scope": "desc", "type": "EI", "priority": 1, "enabled": True}]}))

# 6) 静态资源与健康子路径
snap["static_echarts"] = {"status": (lambda r: r.status)(urllib.request.urlopen(API + "/static/echarts.min.js", timeout=30))}
snap["diag"] = norm(call("/api/diag"))

if SAVE:
    with open(BASE, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"基线已保存 → {BASE}（{len(snap)} 项快照）")
    sys.exit(0)

base = json.load(open(BASE, encoding="utf-8"))
diffs = []
for k in sorted(set(base) | set(snap)):
    b, s = base.get(k, "<缺失>"), snap.get(k, "<缺失>")
    if b != s:
        diffs.append((k, b, s))

if not diffs:
    print(f"行为一致：{len(snap)} 项快照与基线完全相符（{BASE}）")
    sys.exit(0)

print(f"⚠ 行为差异 {len(diffs)} 项：")
for k, b, s in diffs:
    print(f"\n--- {k} ---")
    if isinstance(b, dict) and isinstance(s, dict):
        bb, sb = b.get("body", b), s.get("body", s)
        if isinstance(bb, dict) and isinstance(sb, dict):
            for kk in sorted(set(bb) | set(sb)):
                if bb.get(kk) != sb.get(kk):
                    print(f"  .{kk}:\n    基线={json.dumps(bb.get(kk), ensure_ascii=False)[:200]}\n    现状={json.dumps(sb.get(kk), ensure_ascii=False)[:200]}")
        else:
            print(f"  status: {b.get('status')} → {s.get('status')}")
    else:
        print(f"  基线={json.dumps(b, ensure_ascii=False)[:300]}\n  现状={json.dumps(s, ensure_ascii=False)[:300]}")
sys.exit(1)
