# -*- coding: utf-8 -*-
"""生成 exe 图标：扁平商务蓝底 + 上升折线（象征工作量评估），输出多尺寸 .ico。
产物：assets/we_icon.ico （供 PyInstaller spec 图标使用）
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
r = 112

# 背景：圆角方块，品牌蓝主色 + 顶部高光（扁平、轻微层次）
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=(37, 99, 235, 255))
hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
hi_d = ImageDraw.Draw(hi)
hi_d.rounded_rectangle([0, 0, S - 1, int(S * 0.52)], radius=r, fill=(96, 165, 250, 60))
img = Image.alpha_composite(img, hi)
d = ImageDraw.Draw(img)   # 合成产生新 Image，必须重建绘制上下文，否则画到被丢弃的旧图上

white = (255, 255, 255, 255)
# 单一粗大的白色上升折线 + 终点大圆点：缩到小尺寸依然醒目，避免细线被重采样吞掉
d.line([(104, 372), (250, 248), (384, 120)], fill=white, width=64, joint="curve")
d.ellipse([344, 78, 424, 158], fill=white)

out = ASSETS / "we_icon.ico"
img.save(out, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                                   (64, 64), (128, 128), (256, 256)])
# 导出 256px 预览（贴浅底）便于人工确认与审计
prev = Image.alpha_composite(
    Image.new("RGBA", (256, 256), (245, 247, 250, 255)),
    img.resize((256, 256), Image.LANCZOS))
prev.save(ASSETS / "we_icon_preview.png")
print("已生成图标:", out.resolve(), out.stat().st_size, "字节")