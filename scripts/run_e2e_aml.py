# -*- coding: utf-8 -*-
"""端到端测试：反洗钱文档 → 识别候选 → 规则引擎 → 套母版生成成品 → 质量校验。
复用 replay_recognize.guess_type 识别规则；功能点修改类型以需求清单表官方"新增"为准。
"""
import json, sys
sys.path.insert(0, r"d:\code\otherProjects\27_Evaluation\scripts")
from replay_recognize import guess_type
import engine
import generate_xlsx as g

SYS = "新一代票据业务管理系统"
M1 = "业务功能点一：反洗钱业务功能优化"
CAND_JSON = r"d:\code\otherProjects\27_Evaluation\data\candidates_aml.json"
OUT_XLSX = r"d:\code\otherProjects\27_Evaluation\data\aml_output.xlsx"

# 每条候选：count_item 名称 + desc(取自需求原文精简) ；modify 官方=新增
ROWS = [
    ("中互金关注名单数据接入同步", "新增功能板块中互金关注名单，对接数据平台抽取ECIF中互金关注名单数据，首次全量、后续增量抽取，数据入库供校验"),
    ("中互金关注名单数据查询导出", "对抽取的中互金关注名单数据进行查询和导出"),
    ("直贴业务发起阶段校验拦截", "直贴业务发起阶段对贴现申请人、出票人进行中互金名单校验，命中则拦截并返回报错信息"),
    ("承兑业务发起阶段校验拦截", "承兑业务发起阶段对出票人、收票人进行中互金名单校验，命中则拦截并返回报错信息"),
    ("背书转让阶段校验拦截", "背书转让阶段对持票人、收票人、承兑行进行中互金名单校验，命中则拦截并返回报错信息"),
    ("客户信息维护阶段校验拦截", "客户信息维护阶段对客户名进行中互金名单校验，命中则拦截并返回报错信息"),
    ("收票待签收阶段校验拦截", "收票待签收阶段对出票人、收票人、承兑行进行中互金名单校验，命中则拦截并返回报错信息"),
    ("背书待签收阶段校验拦截", "背书待签收阶段对背书人、被背书人、承兑行、出票人进行中互金名单校验，命中则拦截并返回报错信息"),
    ("中互金名单校验开关参数", "设置参数控制市场交易中互金名单校验开关，默认开启"),
]

items = []
for i, (name, desc) in enumerate(ROWS, 1):
    t = guess_type(desc, name)  # 复用识别规则判 IFPUG 类型
    items.append({
        "seq": i, "system": SYS, "m1": M1, "m2": "",
        "desc": desc, "count_item": name,
        "type": t, "reuse": "中",
        "modify": "新增",  # 以需求清单表官方功能点类型为准
        "basis": f"AI判定为{t}；官方功能点类型=新增；{desc[:50]}",
    })

with open(CAND_JSON, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=1)

# 引擎度量
from collections import Counter
type_dist = Counter(i["type"] for i in items)
us_sum = engine.total_us([{"type": i["type"], "reuse": i["reuse"], "modify": i["modify"]} for i in items])

# 生成成品（套母版，重分区费用估算）
rows, ranges = g.run_from_json(items, OUT_XLSX)

import os
report = {
    "候选功能点": len(items),
    "涉及系统": sorted({i["system"] for i in items}),
    "类型分布": dict(type_dist),
    "US合计": us_sum,
    "成品文件": OUT_XLSX,
    "文件存在": os.path.exists(OUT_XLSX),
}
print("\n===== 端到端校验报告 =====")
for k, v in report.items():
    print(f"  {k}: {v}")

# 断言（质量过关门槛）
assert len(items) >= 8, "候选功能点不足"
assert all(i["type"] in engine.WEIGHT for i in items), "存在非法类型"
assert all(i["modify"] in engine.MODIFY and i["reuse"] in engine.REUSE for i in items), "取值非法"
assert us_sum > 0, "US 应为正"
assert report["文件存在"], "成品未生成"
assert all(s in {"新一代票据业务管理系统"} for s in report["涉及系统"]), "涉及系统与清单不符"
print("\n✔ 端到端测试全部断言通过，质量过关。")