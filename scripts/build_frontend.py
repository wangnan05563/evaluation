#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""M9/FR-5.1（ENG01）：frontend/src/ 多模块 → 构建回单文件 frontend/index.html。
零依赖；保持 exe 自包含与现有加载方式。AC：构建产物与现状等价（M4 套件守门）、一键构建。"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'frontend', 'src')
OUT = os.path.join(ROOT, 'frontend', 'index.html')


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def build():
    tpl = read(os.path.join(SRC, 'index.src.html'))

    # VENDOR：lucide UMD
    vendor = read(os.path.join(SRC, 'js', '00_vendor_lucide.js'))
    tpl = tpl.replace('<!--BUILD:VENDOR_LUCIDE-->', '<script>\n' + vendor + '\n</script>', 1)

    # CSS：文件名字典序拼接（10_main → 20_print，保持等价顺序）
    css_dir = os.path.join(SRC, 'css')
    css = '\n'.join(read(os.path.join(css_dir, f)) for f in sorted(os.listdir(css_dir)) if f.endswith('.css'))
    tpl = tpl.replace('<!--BUILD:CSS-->', '<style>\n' + css + '\n</style>', 1)

    # JS：除 vendor 外按文件名字典序拼接（模块编号即原顺序）
    js_dir = os.path.join(SRC, 'js')
    js = '\n'.join(read(os.path.join(js_dir, f)) for f in sorted(os.listdir(js_dir))
                   if f.endswith('.js') and not f.startswith('00_'))
    tpl = tpl.replace('<!--BUILD:JS-->', '<script>\n' + js + '\n</script>', 1)

    assert '<!--BUILD:' not in tpl, '存在未替换的构建标记'
    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(tpl)
    n_css = len([f for f in sorted(os.listdir(css_dir)) if f.endswith('.css')])
    n_js = len([f for f in sorted(os.listdir(js_dir)) if f.endswith('.js') and not f.startswith('00_')])
    print(f"build_frontend ok: css {n_css} 个 + js {n_js} 个模块 → frontend/index.html（{os.path.getsize(OUT)} 字节）")


if __name__ == '__main__':
    build()
