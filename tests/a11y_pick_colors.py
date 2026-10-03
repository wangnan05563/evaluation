# -*- coding: utf-8 -*-
"""为 a11y_contrast 报告的未达标项求解合规色值。

策略：保持原色相，单独调整亮度直到满足阈值；输出可直接落 CSS 的 hex。
用法：python tests/a11y_pick_colors.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
from a11y_contrast import srgb_lum, ratio  # noqa: E402

M = 1 << 16


def hexc(n):
    return "#%06X" % (n & 0xFFFFFF)


def rgb(h):
    n = int(h[1:], 16)
    return (n >> 16 & 255, n >> 8 & 255, n & 255)


def hx(r, g, b):
    return hexc((r << 16) | (g << 8) | b)


def fix(fg, bg, need):
    """保持色相，调暗 fg（bg 亮时）或调亮 fg（bg 暗时）直到达标。"""
    f = rgb(fg)
    b = rgb(bg)
    bl = srgb_lum(bg)
    direction = -1 if bl > 0.18 else 1   # 亮底调暗、暗底调亮
    best = None
    for step in range(0, 256):
        k = step * direction
        cand = hx(*[max(0, min(255, c + k)) for c in f])
        if ratio(cand, bg) >= need:
            best = cand
            break
    return best


def fix_bg(fg, bg, need):
    """前景不动，调背景（用于浅色徽标底这类：把底压暗/提亮更易达标）。"""
    b = rgb(bg)
    f = rgb(fg)
    fl = srgb_lum(fg)
    direction = -1 if fl > 0.18 else 1
    for step in range(0, 256):
        k = step * direction
        cand = hx(*[max(0, min(255, c + k)) for c in b])
        if ratio(fg, cand) >= need:
            return cand
    return None


JOBS = [
    # (主题, 令牌, 前景, 背景, 阈值, 调谁)
    ("light", "--muted", "#6B7280", "#F4F6FA", 4.5, "fg"),
    ("light", "--danger", "#DC2626", "#F4F6FA", 4.5, "fg"),
    ("light", "--ok", "#16A34A", "#FFFFFF", 4.5, "fg"),
    ("light", "--warn", "#D97706", "#FFFFFF", 4.5, "fg"),
    ("light", "--cat-eo-ink", "#D97706", "#FFF3E0", 4.5, "fg"),
    ("light", "--cat-eq-ink", "#0284C7", "#E0F2FE", 4.5, "fg"),
    ("light", "--line", "#E5E7EB", "#FFFFFF", 3.0, "bg"),
    ("light", "--drop-line", "#CBD5E1", "#FFFFFF", 3.0, "fg"),
    ("dark", "--ink-2", "#475569", "#1E293B", 4.5, "fg"),
    ("dark", "--ink-2", "#475569", "#0F172A", 4.5, "fg"),
    ("dark", "--brand", "#2563EB", "#0F172A", 4.5, "fg"),
    ("dark", "--brand", "#2563EB", "#1E293B", 4.5, "fg"),
    ("dark", "--brand-ink", "#1D4ED8", "#0F172A", 4.5, "fg"),
    ("dark", "--cat-eif-ink", "#475569", "#273449", 4.5, "fg"),
    ("dark", "--line", "#334155", "#1E293B", 3.0, "fg"),
    ("dark", "--drop-line", "#475569", "#1E293B", 3.0, "fg"),
    ("contrast", "--danger-ink", "#B91C1C", "#1A0000", 4.5, "fg"),
    ("contrast", "--cat-eo-ink", "#D97706", "#FFF3E0", 4.5, "fg"),
    ("contrast", "--cat-eq-ink", "#0284C7", "#E0F2FE", 4.5, "fg"),
]


def main():
    print("=== 合规色值求解（保持色相，仅调亮度）===")
    seen = {}
    for theme, token, fg, bg, need, which in JOBS:
        val = fix(fg, bg, need) if which == "fg" else fix_bg(fg, bg, need)
        if val is None:
            print(f"  {theme:9s} {token:16s} {fg} on {bg}  需 ≥{need}  → 无解")
            continue
        key = (theme, token)
        if key in seen:
            continue
        seen[key] = (val, fg, bg, need)
        print(f"  {theme:9s} {token:16s} {fg} on {bg}  需 ≥{need}  → {val}  ({ratio(val, bg) if which=='fg' else ratio(fg, val)}:1)")


if __name__ == "__main__":
    main()
