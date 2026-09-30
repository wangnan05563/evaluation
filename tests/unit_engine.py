# -*- coding: utf-8 -*-
"""S2 · 引擎口径单测（FR-5.2）：weight/total_us/summary 不变量断言。退出码 0=全过。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
os.chdir(ROOT)

import engine as g   # noqa: E402
import gb_engine as gb   # noqa: E402

fails = []
check = lambda n, ok, d='': (print(f"  {'PASS' if ok else 'FAIL'}  {n} {d}"), None if ok else fails.append(n))

TYPES = ["EI", "EO", "EQ", "ILF", "EIF"]
ITEMS = [
    {"system": "S1", "m1": "M1", "desc": "查询客户信息", "count_item": "客户查询", "type": "EQ", "reuse": "中", "modify": "新增"},
    {"system": "S1", "m1": "M1", "desc": "维护客户基础数据表", "count_item": "客户维护", "type": "ILF", "reuse": "低", "modify": "新增"},
    {"system": "S2", "m1": "M2", "desc": "生成对账报表并导出", "count_item": "对账报表", "type": "EO", "reuse": "高", "modify": "修改"},
]

# weight：确定性 + 枚举完备 + 未知类别报错
for t in TYPES:
    w = g.weight(t, "估算功能点")
    check(f"weight({t}) 确定性且为正", w == g.weight(t, "估算功能点") and w > 0, f"w={w}")
try:
    g.weight("XX", "估算功能点")
    check("未知类别抛 ValueError", False, "未抛异常")
except ValueError:
    check("未知类别抛 ValueError", True)

# total_us：等于逐条 US 之和
expect = round(sum(g.weight(it["type"]) * g.REUSE[it["reuse"]] * g.MODIFY[it["modify"]] for it in ITEMS), 2)
check("total_us = Σ(权重×重用×修改)", g.total_us(ITEMS, "估算功能点") == expect,
      f"{g.total_us(ITEMS, '估算功能点')} vs {expect}")

# summary：口径链完整（UFP→US→调整后→工作量→费用三值）
s = g.summary(ITEMS, method="估算功能点")
check("summary 键完整", all(k in s for k in ("ufp", "us", "adjusted_fp", "work", "cost")))
check("工作量三值区间有序 low<mid<high", s["work"]["low"] < s["work"]["mid"] < s["work"]["high"])
check("费用三值区间有序且与工作量同向", s["cost"]["low"] < s["cost"]["mid"] < s["cost"]["high"]
      and (s["cost"]["mid"] / s["work"]["mid"]) > 0)
check("调整后规模 = US×因子", abs(s["adjusted_fp"] - round(s["us"] * g.SCALE_CHANGE["估算中期"], 2)) < 0.01,
      f"{s['adjusted_fp']} vs {s['us']}×{g.SCALE_CHANGE['估算中期']}")

# M6/FR-2.1：NESMA 快算口径
check("NESMA 预估法 35×ILF+15×EIF", gb.nesma_ufp({"ILF": 2, "EIF": 3}, "pre") == 35*2+15*3)
check("NESMA 估算法 7/5/4/5/4", gb.nesma_ufp({"ILF": 1, "EIF": 1, "EI": 2, "EO": 1, "EQ": 1}, "est") == 7+5+8+5+4)
check("NESMA 未知类别忽略", gb.nesma_ufp({"XX": 5}, "est") == 0)
# M6/FR-2.2：GB 造价方程（手算交叉验证：S=100×1×1.25=125；AE=6.96×125×1.67×1.0=1452.3；费用=1452.3/174×28000=233,713.79…）
o = gb.gb_cost(ufp=100, gsc=1.0, cf=1.25, swf=1.67, rdf=1.0, pdr=6.96, rate=28000, dnhc=0)
check("GB 造价 S = UFP×GSC×CF", abs(o["s"] - 125.0) < 1e-9, str(o["s"]))
check("GB 造价 AE = PDR×S×SWF×RDF", abs(o["ae"] - 6.96*125*1.67) < 0.01, str(o["ae"]))
check("GB 造价 费用 = AE/174×费率", abs(o["fee"] - round(o["ae"]/174*28000, 0)) < 1, str(o["fee"]))
# M6/FR-2.3：费率版本合法性
check("rates_ok 正常版本通过", gb.rates_ok({"pdr": 6.96, "rate": 28000, "unit_price": 850, "dnhc": 0}))
check("rates_ok 负数拒绝", not gb.rates_ok({"pdr": -1, "rate": 28000}))
check("rates_ok 超界拒绝", not gb.rates_ok({"pdr": 99999, "rate": 28000}))
check("rates_ok 非数值拒绝", not gb.rates_ok({"pdr": "abc", "rate": 28000}))

print(f"==== S2 汇总 ==== 失败 {len(fails)}")
sys.exit(1 if fails else 0)
