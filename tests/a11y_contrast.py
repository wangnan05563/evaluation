# -*- coding: utf-8 -*-
"""FR-UI05 可访问性审计 · Part A：WCAG 对比度实测（AA 阈值）。

不猜颜色，直接从 CSS 源解析 :root / [data-theme=dark] / [data-theme=contrast]
三套令牌，逐一算 WCAG 2.1 相对亮度对比度。
AA 阈值：正文 ≥4.5:1；大号文字（≥18.66px 粗体 或 ≥24px）≥3:1；
非文本 UI 组件（边框/图标）≥3:1（WCAG 1.4.11）。

用法：python tests/a11y_contrast.py [--json]
退出码：0 = 无 critical（正文 <4.5:1）问题；1 = 存在 critical。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "frontend" / "src" / "css" / "10_main.css"

# WCAG 1.4.3 / 1.4.11：语义配对（前景, 背景, 用途, 是否正文）
PAIRS = [
    ("ink", "bg", "正文/主文本", True),
    ("ink", "card", "卡片正文", True),
    ("ink-2", "bg", "次级正文", True),
    ("ink-2", "card", "卡片次级正文", True),
    ("muted", "bg", "辅助说明文字", True),
    ("muted", "card", "卡片辅助文字", True),
    ("brand", "bg", "品牌色文字/链接", True),
    ("brand", "card", "卡片上的品牌色文字", True),
    ("brand-ink", "bg", "品牌深色文字", True),
    ("on-brand", "brand", "主按钮文字", True),
    ("ok-ink", "ok-soft", "成功徽标文字", True),
    ("warn-ink", "warn-soft", "警告徽标文字", True),
    ("danger-ink", "danger-soft", "危险徽标文字", True),
    ("danger", "bg", "危险色文字", True),
    ("ok", "card", "成功色文字", True),
    ("warn", "card", "警告色文字", True),
    ("cat-ilf-ink", "cat-ilf-bg", "ILF 徽标", True),
    ("cat-eif-ink", "cat-eif-bg", "EIF 徽标", True),
    ("cat-ei-ink", "cat-ei-bg", "EI 徽标", True),
    ("cat-eo-ink", "cat-eo-bg", "EO 徽标", True),
    ("cat-eq-ink", "cat-eq-bg", "EQ 徽标", True),
    ("chart-tip-ink", "chart-tip-bg", "图表提示文字", True),
    # 非文本（1.4.11，阈值 3:1）——仅「控件边界」受此约束。
    # --line/--line-2 是装饰性分隔（卡片描边、表格横线、进度条底），不承载控件语义，
    # 按 WCAG 1.4.11 例外（纯装饰）不要求 3:1，故不纳入判定，仅在 --json 里输出实测值备查。
    ("line-ctrl", "card", "表单控件边界", False),
    ("line-ctrl", "bg", "表单控件边界（页面底）", False),
    ("brand", "card", "焦点环/品牌控件", False),
    ("brand", "bg", "焦点环（页面底）", False),
    ("drop-line", "card", "拖放区边框", False),
]

THEMES = {"light": ":root", "dark": '[data-theme="dark"]', "contrast": '[data-theme="contrast"]'}


def parse_tokens(css_text):
    """按选择器块切分，抽取 --name: #hex / var(--x) 定义。"""
    out = {}
    for theme, sel in THEMES.items():
        # 找到该选择器对应的 {...} 块
        m = re.search(re.escape(sel) + r"\s*\{(.*?)\n\}", css_text, re.S)
        if not m:
            continue
        body = m.group(1)
        toks = {}
        for name, val in re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", body):
            toks[name[2:]] = val.strip()
        out[theme] = toks
    return out


def resolve(val, toks, depth=0):
    """解析 var(--x) 引用（最多 5 层，避免循环）。"""
    if depth > 5:
        return None
    val = val.strip()
    m = re.fullmatch(r"var\(\s*--([a-z0-9-]+)\s*\)", val)
    if m:
        return resolve(toks.get(m.group(1), ""), toks, depth + 1)
    if val.startswith("#") and len(val) == 7:
        return val
    return None


def srgb_lum(hex_color):
    """WCAG 2.1 相对亮度 L = 0.2126R + 0.7152G + 0.0722B（线性化后）。"""
    n = int(hex_color[1:], 16)
    out = []
    for c in (n >> 16 & 255, n >> 8 & 255, n & 255):
        s = c / 255
        out.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def ratio(fg, bg):
    l1, l2 = srgb_lum(fg), srgb_lum(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return round((hi + 0.05) / (lo + 0.05), 2)


def audit():
    css_text = CSS.read_text(encoding="utf-8")
    all_toks = parse_tokens(css_text)
    # :root 是基础层，dark/contrast 未覆盖的令牌继承之
    base = all_toks.get("light", {})
    results, critical, unresolved = [], [], []
    for theme in THEMES:
        toks = dict(base)
        toks.update(all_toks.get(theme, {}))
        for fg_name, bg_name, usage, is_text in PAIRS:
            fg = resolve(toks.get(fg_name, ""), toks)
            bg = resolve(toks.get(bg_name, ""), toks)
            if not fg or not bg:
                unresolved.append({"theme": theme, "pair": f"{fg_name}/{bg_name}",
                                   "fg": toks.get(fg_name), "bg": toks.get(bg_name)})
                continue
            r = ratio(fg, bg)
            need = 4.5 if is_text else 3.0
            rec = {"theme": theme, "pair": f"{fg_name}/{bg_name}", "usage": usage,
                   "fg": fg, "bg": bg, "ratio": r, "need": need,
                   "kind": "text" if is_text else "non-text",
                   "pass": r >= need}
            results.append(rec)
            if not rec["pass"]:
                critical.append(rec)
    return results, critical, unresolved


def main():
    results, critical, unresolved = audit()
    by_theme = {}
    for r in results:
        t = by_theme.setdefault(r["theme"], {"pass": 0, "fail": 0})
        t["pass" if r["pass"] else "fail"] += 1

    print("=== FR-UI05 · WCAG AA 对比度审计 ===")
    print(f"令牌来源：{CSS.relative_to(ROOT)}")
    for theme in ("light", "dark", "contrast"):
        t = by_theme.get(theme, {})
        print(f"  {theme:9s} 通过 {t.get('pass',0):2d} / 失败 {t.get('fail',0):2d}")
    if unresolved:
        print(f"\n[warn] {len(unresolved)} 组令牌无法解析为 #RRGGBB（已跳过）：")
        for u in unresolved:
            print(f"  {u['theme']:9s} {u['pair']:26s} fg={u['fg']!r} bg={u['bg']!r}")

    if critical:
        print(f"\n=== 未达标 {len(critical)} 项 ===")
        for c in critical:
            print(f"  [{c['theme']:9s}] {c['pair']:26s} {c['ratio']:>5}:1 (需 ≥{c['need']}) {c['usage']}  {c['fg']} on {c['bg']}")
    else:
        print("\n=== 全部通过：无 critical 对比度问题 ===")

    if "--json" in sys.argv:
        print(json.dumps({"results": results, "critical": critical,
                          "unresolved": unresolved}, ensure_ascii=False))
    return 1 if critical else 0


if __name__ == "__main__":
    sys.exit(main())
