# -*- coding: utf-8 -*-
"""T00859 单元测试：引导系统静态一致性（不依赖浏览器/DOM）。"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
gs = open(os.path.join(ROOT, "frontend", "guide.js"), encoding="utf-8").read()
ih = open(os.path.join(ROOT, "frontend", "index.html"), encoding="utf-8").read()
fail = []
def ck(c, m):
    if not c: fail.append(m)

ids = re.findall(r"id:\s*'([^']+)'", gs)
menus = re.findall(r"menuId:\s*'([^']+)'", gs)
titles = re.findall(r"title:\s*'([^']+)'", gs)
targets = re.findall(r"target:\s*'([^']+)'", gs)
ck(len(ids) >= 8, f"步骤数应>=8, 实际{len(ids)}")
ck(len(ids) == len(set(ids)), "步骤 id 重复")
ck(len(ids) == len(menus) == len(titles) == len(targets), "字段数量不一致")
ck(all(m in {"work","pert","config","help"} for m in menus), f"非法 menuId: {sorted(set(menus)-{'work','pert','config','help'})}")
for t in targets:
    ck(t.lstrip("#.") in ih, f"目标选择器 {t} 不存在于 index.html")
for fn in ("start","stop","step","render","guideMaybe","autoTimer","menuOfPage","markDone","isDone"):
    ck(re.search(r"function\s+"+fn+r"\s*\(", gs), f"缺函数 {fn}")
ck("origGoPage" in gs and "origGoStep" in gs and "origPertStep" in gs, "导航函数包装缺失")
ck("/static/guide.js" in gs or "/static/guide.js" in ih, "static 引用缺失")
ck("wl_guide_done_pages_v1" in gs, "存储键缺失")
print(f"单测: 通过 {sum(1 for _ in [0]) if not fail else 0 if fail else 1} 项可见, 失败 {len(fail)}")
for m in fail: print("  [FAIL]", m)
if fail: sys.exit(1)
print("全部通过 OK")