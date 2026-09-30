# -*- coding: utf-8 -*-
"""转储指定段落区间的段落文本+表格内容（完整），供语义识别。"""
from docx import Document
from docx.table import Table
from docx.oxml.ns import qn

SRC = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
OUT = r"d:\code\otherProjects\27_Evaluation\data\zone_feature.txt"
doc = Document(SRC)

def style_of(p):
    p_pr = p.find(qn("w:pPr"))
    if p_pr is not None:
        ps = p_pr.find(qn("w:pStyle"))
        if ps is not None:
            return (ps.get(qn("w:val")) or "").strip()
    return ""

def ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()

lo, hi = 96, 220
pi = 0
out = []
for blk in doc.element.body.iterchildren():
    tag = blk.tag.rsplit("}", 1)[-1]
    if tag == "p":
        if lo <= pi < hi:
            txt = ptext(blk)
            st = style_of(blk)
            if txt or st:
                out.append(f"P{pi}[{st}] {txt[:120]}")
        pi += 1
    elif tag == "tbl" and lo <= pi < hi:
        t = Table(blk, doc)
        out.append(f"## 表格({len(t.rows)}行)")
        for r in t.rows[:220]:
            cells = " | ".join((c.text or "").strip().replace("\n", " ") for c in r.cells)
            if cells.strip(" |"):
                out.append("   " + cells)

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("转储", len(out), "行 ->", OUT)
print("\n".join(out[:60]))