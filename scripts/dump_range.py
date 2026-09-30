# -*- coding: utf-8 -*-
"""按序号转储段落(样式+文本)便于人工定位 4.x 章节正文，并夹入表格标记。"""
from docx import Document
from docx.table import Table
from docx.oxml.ns import qn

SRC = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
doc = Document(SRC)

def ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()

out = []
start, end = 55, 320
in_start = False
pi = 0
for blk in doc.element.body.iterchildren():
    tag = blk.tag.rsplit("}", 1)[-1]
    if tag == "p":
        if pi < start:
            pi += 1
            continue
        if pi >= end:
            break
        txt = ptext(blk)
        st = ""
        # 读取段落样式
        pPr = blk.find(qn("w:pPr"))
        if pPr is not None:
            pstyle = pPr.find(qn("w:pStyle"))
            if pstyle is not None:
                st = pstyle.get(qn("w:val")) or ""
        mark = ""
        # 检测自动编号 numPr
        if pPr is not None and pPr.find(qn("w:numPr")) is not None:
            mark = "·num"
        out.append(f"P{pi} [{st}{mark}] {txt[:100]}")
        pi += 1
    elif tag == "tbl" and start <= pi < end:
        t = Table(blk, doc)
        out.append(f"   ==我表格 {len(t.rows)}行==")

with open(r"d:\code\otherProjects\27_Evaluation\data\range_55_320.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("共", len(out), "行。前 120 行预览：")
print("\n".join(out[:120]))