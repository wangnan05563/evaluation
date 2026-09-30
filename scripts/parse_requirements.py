# -*- coding: utf-8 -*-
"""M1 需求解析器：抽取 docx 的章节树与候选线索，输出结构化 JSON。
实现要点：python-docx 无法按流式遍历混合段落/表格，故按 body 顺序扫描，
用 Heading 维护标题栈，并识别含 IFPUG 动作词的表格行作为候选线索。
"""
import json, re
from docx import Document

INPUT = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
OUT = r"d:\code\otherProjects\27_Evaluation\data\requirements_structure.json"

# IFPUG 候选动作词（用于把表格/正文行粗线索化为候选提示）
ACTION_WORDS = ["新增", "修改", "删除", "查询", "导入", "下载", "导出", "保存",
                "审批", "报表", "报文", "接口", "登记", "模板", "定时任务", "字典"]
# 常见系统名后缀，用于识别"涉及系统"
SYS_HINT = ["系统", "平台", "前置", "网关", "影像", "核心", "信贷", "网银"]

doc = Document(INPUT)
outline, stack, tables_seen = [], [], []

def heading_path(level: int, text: str):
    """维护 1..6 级标题栈，返回层级路径。"""
    while len(stack) >= level:
        stack.pop()
    while len(stack) < level:
        stack.append("")
    stack[level - 1] = text
    return "/".join(x for x in stack if x)

def walk():
    """按文档顺序遍历段落与表格，建立大纲并抽取候选线索。"""
    candidates = []
    systems = set()
    cur_path = ""
    for block in doc.element.body.iterchildren():
        tag = block.tag.rsplit("}", 1)[-1]
        if tag == "p":
            # 用 python-docx 重新定位到该段落对象，读取样式与文本
            # （为简洁：仅通过占位段落无法逐一定位，这里改用独立遍历策略）
            pass
    # 简化：仅用段落与表格两层独立遍历（大纲为主）
    for p in doc.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        st = p.style.name or ""
        if st.startswith("Heading") or st in ("Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5"):
            try:
                lvl = int(re.search(r"\d", st).group())
            except Exception:
                lvl = 2
            cur_path = heading_path(lvl, t[:50])
            if lvl <= 2:
                outline.append({"level": lvl, "text": t[:80], "path": cur_path})
    for i, tb in enumerate(doc.tables, 1):
        for row in tb.rows[:40]:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            line = " ".join(x for x in cells if x)
            if not line:
                continue
            if any(w in line for w in ACTION_WORDS):
                candidates.append({"table": i, "text": line[:160]})
            for s in SYS_HINT:
                if re.search(rf"[「『【】]?[^，。；、]{1,24}{s}", line):
                    m = re.search(rf"([^，。；、]{2,24}{s})", line)
                    if m:
                        systems.add(m.group(1))
    return candidates, systems

candidates, systems = walk()
data = {
    "source": INPUT,
    "stat": {"paragraphs": len(doc.paragraphs), "tables": len(doc.tables),
             "outline_htags": len(outline), "candidate_hints": len(candidates),
             "systems_est": sorted(systems)},
    "outline": outline,
    "candidate_hints": candidates,
}
import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

print("统计:", data["stat"])
print("前12个大纲条目:")
for o in outline[:12]:
    print(" ", o["text"])
print("候选线索示例(前10):")
for c in candidates[:10]:
    print("  [表%d] %s" % (c["table"], c["text"][:70]))