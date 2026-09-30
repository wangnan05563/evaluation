# -*- coding: utf-8 -*-
"""S1 · 识别规则表驱动单测（FR-2.9 零回归对拍 + 回退 + 坏正则拒绝）。
收编自 logs/_w010_parity.py；退出码 0=全过。"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
os.chdir(ROOT)

import replay_recognize as rr                      # noqa: E402
from recognition_rules import RulesStore           # noqa: E402

RULES_PATH = os.path.join(ROOT, 'data', 'recognition_rules.json')
fails = []
check = lambda n, ok, d='': (print(f"  {'PASS' if ok else 'FAIL'}  {n} {d}"), None if ok else fails.append(n))

# 样本：45 条真实回放 + 10 条对抗边界
s1 = json.load(open(os.path.join(ROOT, 'data', 'candidates_replay.json'), encoding='utf-8'))
samples = [(it.get('desc') or '', it.get('count_item') or '') for it in s1]
samples += [
    ("新增客户信息维护页面字段校验", "字段校验"),
    ("对接第三方支付接口查询交易结果", "支付接口"),
    ("生成《对账汇总》报表并导出", "对账报表"),
    ("客户信息登记信息表新增字段", "客户登记信息表"),
    ("批量校验数据打包下载", "数据打包"),
    ("跨系统对接数据回调", "回调"),
    ("暂不符合条件返回报错提示", "报错"),
    ("查询历史批次信息", "历史批次信息"),
    ("优化调整报表统计口径", "报表口径"),
    ("新增用户并修改其权限配置", "用户权限"),
]

# 1) 内置链 vs 规则表驱动：零回归
builtin = [rr.guess_type_builtin(d, n) for d, n in samples]
store = RulesStore(RULES_PATH)
rr.set_rules_store(store)
driven = [rr.guess_type(d, n) for d, n in samples]
diff = [(i, b, g) for i, (b, g) in enumerate(zip(builtin, driven)) if b != g]
check('对拍零回归（内置链 vs 规则表 0 差异）', not diff, f'{len(diff)} 条差异: {diff[:3]}')

# 2) 规则表损坏 → 回退内置链
bad_path = RULES_PATH + '.unit.bad'
with open(bad_path, 'w', encoding='utf-8') as f:
    f.write('{broken')
store_bad = RulesStore(bad_path)
check('坏 JSON 触发 fallback', store_bad.fallback, store_bad.err[:40])
rr.set_rules_store(store_bad)
fb = [rr.guess_type(d, n) for d, n in samples]
check('损坏回退后与内置链一致', fb == builtin)
os.remove(bad_path)

# 3) save 校验：坏正则抛异常、好规则版本递增
rr.set_rules_store(store)
v0 = store.version()['rules_version']
try:
    store.save([{'id': 'X', 'patterns': ['(['], 'scope': 'desc', 'type': 'EI', 'priority': 1, 'enabled': True}])
    check('坏正则保存被拒', False, '未抛异常')
except Exception:
    check('坏正则保存被拒', True)
check('保存拒绝后版本不变', store.version()['rules_version'] == v0)

print(f"==== S1 汇总 ==== 失败 {len(fails)}")
sys.exit(1 if fails else 0)
