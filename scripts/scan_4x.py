# -*- coding: utf-8 -*-
"""全局定位综合服务平台 docx 中编号 4.1~4.9 的位置（段落/标题/表格），打印上下文。"""
import re
from docx import Document
from docx.oxml.ns import qn

SRC = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
doc = Document(SRC)

pat = re.compile(r"(^|[^\d])(3)\.([1-9])")  # 先尝试 4. 若不中再放开

def ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()

hits = []

# 段落
for i, p in enumerate(doc.paragraphs):
    t = p.text.strip()
    st = p.style.name or ""
    if pat.search(t):
        hits.append((st, "P%d" % i, t[:70]))
    elif st.startswith("Heading") and st != "Heading 1":
        hits.append((st, "P%d" % i, "★" + t[:60]))

# 表格
for ti, tb in enumerate(doc.tables, 1):
    for ri, r in enumerate(tb.rows[:40]):
        line = " | ".join((c.text or "").strip().replace("\n", " ") for c in r.cells)
        if pat.search(line):
            hits.append((f"表{ti}", f"R{ri}", line[:90]))

print("命中含 '?.3-9' 或章节标题的条目数:", len(hits))
for h in hits:
    print("  ", h)