# -*- coding: utf-8 -*-
"""FR-5.5 i18n 构建校验：两字典 key 双向对齐 + 无空译文 + 标注 key 均存在。

独立运行：python tests/i18n_check.py（不属 npm test 套件，与 a11y_contrast.py 同级）
退出码：0 = 全部通过；1 = 存在问题（列出具体 key）。

为什么必须独立成校验脚本而非运行时兜底：t() 缺译文会回退显示 key（中文原文），
界面「看起来正常」，漏译只会在切到英文时才暴露成key 裸露。构建期拦住比用户发现早得多。

边界（T01669 产品裁决，详见 docs/设计-多语言边界-交付物恒为中文.md）：
**交付物文案恒为中文，不参与 i18n**——IFPUG/PERT 成品表（generate_xlsx.py）、
版本对比 CSV/MD（08_*.js）、结果摘要 MD（03_*.js）的模板不得加 data-i18n 标注
或 t()/tf() 调用；数据域枚举值（低/中/高、新增/修改/删除等）是业务数据口径，
同样不进字典。本脚本与 S12 扫描只覆盖界面文案，导出模板不在校验范围（设计使然）。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "data" / "i18n"
HTML = ROOT / "frontend" / "src" / "index.src.html"
SUPPORTED = ("zh-CN", "en-US")
fails = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")
    if not ok:
        fails.append(name)


def load(lang):
    p = I18N_DIR / f"{lang}.json"
    if not p.exists():
        return None
    doc = json.loads(p.read_text(encoding="utf-8-sig"))
    return doc.get("strings") if isinstance(doc, dict) else None


# 1) 字典文件存在且结构合法
dicts = {}
for lang in SUPPORTED:
    s = load(lang)
    check(f"{lang}.json 存在且含 strings 对象", isinstance(s, dict),
          "" if s is None else f"{len(s)} 键")
    dicts[lang] = s or {}

zh, en = dicts["zh-CN"], dicts["en-US"]

# 2) key 命名规范：只允许小写字母/数字/下划线/点，且不用驼峰。
#    混用大小写会让「按前缀批量查某一模块」失效（本项目已踩过一次：
#    review.side.ufpUnadj 与 review.side.ufp_unadj 并存）。
if zh:
    bad_case = sorted(k for k in zh if re.search(r'[A-Z]', k))
    check("key 统一小写（无驼峰）", not bad_case, ", ".join(bad_case[:6]))
    bad_chr = sorted(k for k in zh if not re.match(r'^[a-z0-9_]+(\.[a-z0-9_]+)*$', k))
    check("key 字符集合法（小写字母/数字/下划线/点）", not bad_chr, ", ".join(bad_chr[:6]))

# 2) 双向 key 对齐（防漏译 / 防误删）
if zh and en:
    only_zh = sorted(set(zh) - set(en))
    only_en = sorted(set(en) - set(zh))
    check("两字典 key 集合一致（zh 独有为空）", not only_zh, ", ".join(only_zh[:6]))
    check("两字典 key 集合一致（en 独有为空）", not only_en, ", ".join(only_en[:6]))
    empty_en = sorted(k for k, v in en.items() if not str(v).strip())
    empty_zh = sorted(k for k, v in zh.items() if not str(v).strip())
    check("无空译文（en）", not empty_en, ", ".join(empty_en[:6]))
    check("无空值（zh）", not empty_zh, ", ".join(empty_zh[:6]))
    # 值不应与key 相同：t() 的回退值就是 key，译文等于 key 等于没翻
    same = sorted(k for k, v in en.items() if str(v).strip() == k)
    check("en 译文未与 key 原样相同（防「假翻译」静默通过）", not same, ", ".join(same[:6]))

# 3) 源码标注的 key 必须都在字典里（防新增 data-i18n 忘了补字典）
if HTML.exists():
    src = HTML.read_text(encoding="utf-8")
    used = set()
    for m in re.finditer(r'data-i18n(?:-ph)?="([^"]+)"', src):
        # 形式："text" / "text=key" / "title=key|text=key"
        for part in m.group(1).split("|"):
            key = part.split("=")[-1].strip()
            if key:
                used.add(key)
    missing = sorted(k for k in used if zh and k not in zh)
    check("HTML 中所有 data-i18n 标注的 key 均存在于 zh-CN 字典", not missing,
          f"已用 {len(used)} 个 key" + ("；缺失: " + ", ".join(missing[:6]) if missing else ""))

    # 4) 危险形态：节点含子元素却用裸 key（applyI18n 只能按textContent 写文本，
    #    会摧毁图标与嵌套 span）。这类 bug 表现为「切换语言后图标消失」，
    #    不做静态校验只能靠肉眼发现。
    risky = []
    for m in re.finditer(r'<(\w+)([^>]*\bdata-i18n="([^"]*)"[^>]*)>(.*?)</\1>', src, re.S):
        _tag, _attrs, spec, inner = m.groups()
        if "<" not in inner:
            continue
        for part in spec.split("|"):
            if "=" in part:
                continue          # 显式 attr= 形态，安全
            risky.append(f"{_tag}<{part}>")
    check("无「含子元素却用裸 key」的危险标注", not risky,
          "；".join(risky[:5]) + "（应改为 attr=key 形态）" if risky else "")

    # 5) 反向：字典里未被使用的 key（可能是遗留/拼错，不阻断但提示）
    if zh:
        unused = sorted(k for k in zh if k not in used)
        print(f"  INFO  字典中未被 data-i18n 使用的 key：{len(unused)} 个"
              + (f"（如 {', '.join(unused[:5])}）" if unused else ""))

# 6) 术语跨字典一致（T01528，术语表见 docs/i18n_glossary.md）：
#    zh 文案出现的固定术语，对应 en 必须使用术语表英文——同一术语在结果页、
#    复核表、帮助页会各出现一次，各处独立机翻必然漂移，这里用断言兜住。
#    豁免：短标签有意省略术语（如步骤条「复核功能点」→ "Review"）。
GLOSSARY_TERMS = {
    "功能点": ["function point", "fp"], "工作量": ["effort", "workload"],
    "复杂度": ["complexity"], "重用": ["reuse"], "人天": ["person-day"],
    "人月": ["person-month"], "生产率": ["productivity"], "配置中心": ["settings"],
    "调整因子": ["adjustment factor"], "调节系数": ["adjustment coefficient"],
    "乐观": ["optimistic"], "最可能": ["most likely"], "悲观": ["pessimistic"],
    "基准数据": ["benchmark"], "规模变更": ["size changing"],
    "未调整": ["unadjusted"], "调整后": ["adjusted"],
}
GLOSSARY_EXEMPT = {("steps.review", "功能点")}
if zh and en:
    drift = []
    for k, v in zh.items():
        for term, alts in GLOSSARY_TERMS.items():
            if term in str(v) and (k, term) not in GLOSSARY_EXEMPT:
                if not any(a in str(en.get(k, "")).lower() for a in alts):
                    drift.append(f"{k}「{term}」")
    check("术语表术语跨字典一致（en 固定译法无漂移）", not drift, ", ".join(drift[:6]))

# 7) 服务端 msgKey 守卫（T01668，FR-ENG05）：扫描 scripts/server.py 的 _m("srv.*"/…)
#    与 scripts/validators.py 的 key="srv.v.*" 字面量，要求两语字典均有译文。
#    背景：服务端消息已 msgKey 化（前端 lm() 优先查字典渲染），后端新增消息若字典漏译，
#    英文态会直接露出 key——这条守卫把「后端消息键 ↔ 字典」的对齐固化进构建期。
if zh and en:
    srv_keys = set()
    srv_src = (ROOT / "scripts" / "server.py").read_text(encoding="utf-8")
    srv_keys.update(re.findall(r'_m\(\s*"([^"]+)"', srv_src))
    srv_keys.update(re.findall(r'"msgKey":\s*"([^"]+)"', srv_src))
    val_src = (ROOT / "scripts" / "validators.py").read_text(encoding="utf-8")
    srv_keys.update(re.findall(r'key="((?:srv|help|history|rules|rates|config|eco|work|pert|gen)\.[^"]+)"', val_src))
    miss_zh = sorted(k for k in srv_keys if k not in zh)
    miss_en = sorted(k for k in srv_keys if k not in en)
    check("服务端 msgKey 在 zh-CN 字典全部有译文", not miss_zh,
          f"共 {len(srv_keys)} 键，缺失: {', '.join(miss_zh[:6])}")
    check("服务端 msgKey 在 en-US 字典全部有译文", not miss_en,
          f"共 {len(srv_keys)} 键，缺失: {', '.join(miss_en[:6])}")

print(f"==== i18n 校验汇总 ==== 失败 {len(fails)}")
sys.exit(1 if fails else 0)
