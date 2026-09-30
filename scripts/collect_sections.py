# -*- coding: utf-8 -*-
"""按标题层级切分第4章小节，抽取前若干个小节（4.1..4.9）的正文+表格到文件。"""
from docx import Document
from docx.table import Table
from docx.oxml.ns import qn

SRC = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
OUT = r"d:\code\otherProjects\27_Evaluation\data\proper_4x.txt"
doc = Document(SRC)

def style_of(p):
    p_pr = p.find(qn("w:pPr"))
    if p_pr is not None:
        ps = p_pr.find(qn("w:pStyle"))
        if ps is not None:
            return (ps.get(qn("w:val")) or "").replace("Heading", "").strip()
    return ""

def ptext(elm):
    return "".join(t.text or "" for t in elm.iter(qn("w:t"))).strip()

sections = []          # list of list[str]
cur = None
started = False
for blk in doc.element.body.iterchildren():
    tag = blk.tag.rsplit("}", 1)[-1]
    if tag == "p":
        st = style_of(blk)
        txt = ptext(blk)
        if st in ("2", "3"):  # 标题2/标题3 即章节边界
            if started:
                sections.append(cur)
            cur = [txt or f"(标题{st}·编号空)"]
            # 第4章：从"标题2"切出的第一节（P67）即第4章；其后系列标题3=4.1..4.9
            if st == "2":
                started = True
            elif st == "3":
                # 若已在章内，当前标题3为4.x小节点
                pass
            continue
        if started and cur is not None and txt:
            cur.append(txt)
    elif tag == "tbl" and started and cur is not None:
        t = Table(blk, doc)
        for r in t.rows[:200]:
            cells = " | ".join((c.text or "").strip().replace("\n", " ") for c in r.cells)
            if cells.strip("|"):
                cur.append("[表] " + cells)
if started and cur is not None:
    sections.append(cur)

# 第一部分(标题2=第4章头)是章标题，其后标题3开头即4.1
# 取小节：去掉chunk0（章标题），取chunk1..起为 4.1..4.9
body = sections[1:] if len(sections) > 1 else sections
N = min(9, len(body))
lines = []
for i in range(N):
    lines.append(f"\n======================== 4.{i+1} ========================")
    lines.extend(body[i])
text = "\n".join(lines)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(text)

print("小节总数:", len(body), "；导出前9节（4.1-4.9）段落/表格行数:", len(lines))
print("各小节首个标题:")
for i in range(min(N, len(body))):
    print(f"  4.{i+1}:", (body[i][0] if body[i] else "")[:50])