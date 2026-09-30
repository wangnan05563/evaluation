# -*- coding: utf-8 -*-
"""按文档顺序转储段落(带标题层级)+表格全文。用法: python dump_all.py <src> <out>"""
import sys
from docx import Document
from docx.table import Table
from docx.oxml.ns import qn

src = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\hspcadmin\Desktop\工作量评估\HNNS-EB-STD-REQ-002-票据业务系统反洗钱工作对接-日常优化类(公司金融部)(20260831).docx"
out = sys.argv[2] if len(sys.argv) > 2 else r"d:\code\otherProjects\27_Evaluation\data\aml_doc.txt"
doc = Document(src)

def style_of(p):
    p_pr = p.find(qn("w:pPr"))
    if p_pr is not None:
        ps = p_pr.find(qn("w:pStyle"))
        if ps is not None:
            return (ps.get(qn("w:val")) or "").strip()
    return ""

def ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()

idx = 0
lines = []
hdr = {"1": "#", "2": "##", "3": "###", "4": "####", "5": "#####", "10": ""}
for blk in doc.element.body.iterchildren():
    tag = blk.tag.rsplit("}", 1)[-1]
    if tag == "p":
        txt = ptext(blk)
        st = style_of(blk)
        mark = hdr.get(st, "")
        if txt or mark:
            lines.append((mark + " " + txt).strip())
        idx += 1
    elif tag == "tbl":
        t = Table(blk, doc)
        lines.append("### ▣表格")
        for r in t.rows[:120]:
            cells = " | ".join((c.text or "").strip().replace("\n", "") for c in r.cells)
            lines.append("   " + cells)
with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("转储", len(lines), "行 ->", out)