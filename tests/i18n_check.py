# -*- coding: utf-8 -*-
"""FR-5.5 i18n 构建校验：两字典 key 双向对齐 + 无空译文 + 标注 key 均存在。

独立运行：python tests/i18n_check.py（不属 npm test 套件，与 a11y_contrast.py 同级）
退出码：0 = 全部通过；1 = 存在问题（列出具体 key）。

为什么必须独立成校验脚本而非运行时兜底：t() 缺译文会回退显示 key（中文原文），
界面「看起来正常」，漏译只会在切到英文时才暴露成key 裸露。构建期拦住比用户发现早得多。
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

print(f"==== i18n 校验汇总 ==== 失败 {len(fails)}")
sys.exit(1 if fails else 0)
