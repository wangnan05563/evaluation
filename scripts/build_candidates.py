# -*- coding: utf-8 -*-
"""从需求说明书的功能需求清单表构建 IFPUG 候选功能点清单（M2 识别的前置结构化）。
识别定位：找到表头含"子功能名称及描述"的清单表，逐行抽取为候选并判 IFPUG 类型。
类型启发式：含"查询/下载/导出/查看/展示/预览"→EQ；含"导入/录入/维护/登记/保存/新增/修改/删除/审批"
→EI；含"报表/统计/汇总/报送/报文生成"→EO；无明确动作但描述含"表/字段/数据结构"→ILF；
被修改的表记 ILF；含"与X系统交互/接口"→可 EIF/EQ。
（完整准确判定需人工复核，本表输出含 type_hint 与判定依据 basis）
"""
import json, re, os
from docx import Document

INPUT = r"C:\Users\hspcadmin\Desktop\工作量评估\综合服务平台需求说明书V0.1(2).docx"
OUT = r"d:\code\otherProjects\27_Evaluation\data\candidates.json"

doc = Document(INPUT)
list_tbl = None
for tb in doc.tables:
    if len(tb.rows) < 3:
        continue
    head = " ".join(c.text for c in tb.rows[0].cells)
    if "子功能名称" in head and "功能类型" in head:
        list_tbl = tb
        break
if list_tbl is None:
    print("已找到含关键词的表如下，供排查：")
    for i, tb in enumerate(doc.tables[:30], 1):
        h0 = " ".join(c.text for c in tb.rows[0].cells)
        print(f"  表{i} rows={len(tb.rows)} cols={len(tb.columns)} 首行={h0[:60]}")
    raise SystemExit("未找到功能需求清单表")
print("选定清单表 rows=%d cols=%d" % (len(list_tbl.rows), len(list_tbl.columns)))

# 表头列定位
head = [c.text.strip() for c in list_tbl.rows[0].cells]
def col(*keys):
    for i, h in enumerate(head):
        if any(k in h for k in keys):
            return i
    return None
i_seq, i_mod, i_desc, i_type = col("编号"), col("模块"), col("子功能"), col("功能类型")

def guess_type(desc):
    d = desc
    if re.search(r"查询|下载|导出|查看|展示|列表|预览", d): return "EQ"
    if re.search(r"报表|统计|汇总|报送|报文|清单|对账|导出文件", d): return "EO"
    if re.search(r"新增|修改|删除|录入|登记|维护|保存|提交|审批|导入|上传|发送|同步", d): return "EI"
    if re.search(r"(表|字段|数据结构|新增.{0,6}(表|字段))", d): return "ILF"
    if re.search(r"接口|对接|外部|报错|接收.*通知", d): return "EIF"
    return "EI"

candidates = []
for r in list_tbl.rows[1:]:
    cells = [c.text.strip() for c in r.cells]
    def get(idx):
        return cells[idx] if (idx is not None and idx < len(cells)) else ""
    seq = get(i_seq); mod = get(i_mod); desc = get(i_desc); typ = get(i_type)
    if not desc and not mod:
        continue
    desc = re.sub(r"\s+", " ", desc)
    gh = guess_type(desc)
    candidates.append({
        "seq": seq, "module": mod, "desc": desc[:200],
        "mod_type": typ or (""), "type_hint": gh,
        "basis": f"AI 初判为 {gh}；功能类型={typ or '未知'}，需人工复核。",
    })

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(candidates, f, ensure_ascii=False, indent=1)

from collections import Counter
print("候选总数:", len(candidates))
print("类型初判分布:", dict(Counter(c["type_hint"] for c in candidates)))
print("样例(前8):")
for c in candidates[:8]:
    print(f"  {c['seq']} [{c['mod']}] {c['desc'][:46]} | 判:{c['type_hint']} 功能:{c['mod_type']}")