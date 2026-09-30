# -*- coding: utf-8 -*-
"""抽取综合服务平台 docx 正文 4.x 章节（段落+表格）到文本文件，供语义识别。"""
import re
from docx import Document
from docx.table import Table
from docx.oxml.ns import qn

SRC = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
OUT = r"d:\code\otherProjects\27_Evaluation\data\section_4x.txt"

doc = Document(SRC)

def ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()

# 先收集所有"4."开头标题，判断格式
headers = []
for p in doc.paragraphs:
    t = p.text.strip()
    if re.match(r"^4[\.\s][1-9]", t):
        headers.append(t[:60])
print("检测到的 4.x 标题（前 40）：")
for h in headers[:40]:
    print("  ", h)
print("== 开始区段抽取 ==")

out = []
seen1 = set()
insec = False
sectitle = None
for blk in doc.element.body.iterchildren():
    tag = blk.tag.rsplit("}", 1)[-1]
    if tag == "p":
        txt = ptext(blk)
        m = re.match(r"^(4[\.\s]([1-9]))(\s+(.*))?$", txt)
        if m:
            key = m.group(1)
            desc = (m.group(3) or "").strip() or (m.group(4) or "").strip()
            insec = key in {f"4.{i}" for i in range(1, 10)} or key.startswith("4.")
            sectitle = f"{key} {desc}"
            out.append("\n## " + sectitle)
            continue
        # 结束：遇到"5"或"附件/结束"大节
        if insec and re.match(r"^5[\.\s]", txt):
            break
        if insec and txt:
            out.append(txt)
    elif tag == "tbl" and insec:
        t = Table(blk, doc)
        for r in t.rows[:80]:
            cells = " | ".join((c.text or "").strip().replace("\n", " ") for c in r.cells)
            if cells.strip(" |"):
                out.append("  [表] " + cells)
    if insec and sectitle:
        seen1.add(sectitle)

text = "\n".join(out)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(text)
print("抽取完成，共", len(out), "行，写入:", OUT)
print("输出前 40 行预览：")
print("\n".join(out[:40]))