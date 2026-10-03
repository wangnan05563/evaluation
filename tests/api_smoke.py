# -*- coding: utf-8 -*-
"""S3 · API 冒烟（FR-5.2）：health/rules/recognize/generate(异步)/history CRUD 隔离全链路。
用法：python tests/api_smoke.py [port]（由编排器传入；实例由编排器起停）。退出码 0=全过。
收编自 logs/_w002_api_test.py + W010 规则链路。"""
import json
import sys
import time
import urllib.request

PORT = sys.argv[1] if len(sys.argv) > 1 else '8032'
API = f'http://127.0.0.1:{PORT}'
# T01501（S1192）：方法名与「估算功能点」标题在下方多处复用，提取常量避免改口径时漏改
METHOD = '估算功能点'
CX_DEFAULT = '中'   # 补默认复杂度
EP_GENERATE = '/api/generate'   # T01501(S1192)：接口路径原内联 3 处
TITLE = 'S3-API冒烟'
DOCX = 'data/testdocs/t00928_req.docx'
fails = []
check = lambda n, ok, d='': (print(f"  {'PASS' if ok else 'FAIL'}  {n} {d}"), None if ok else fails.append(n))


def call(path, payload=None, method=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, method=method or ('POST' if data else 'GET'),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode('utf-8'))


# 1) health + 规则种子
h = json.load(urllib.request.urlopen(API + '/health', timeout=10))
check('health 就绪', h.get('ok') is True and 'engine' in h)
rules = call('/api/rules')
check('规则表种子（v1，6 条内置）', rules['ok'] and rules['version'] == 1 and len(rules['rules']) == 6,
      f"v={rules.get('version')} count={len(rules.get('rules') or [])}")

# 2) 识别：meta 携带规则版本
import base64
doc = open(DOCX, 'rb').read()
payload = {"name": "t00928_req.docx", "b64": base64.b64encode(doc).decode(), "job": "s3rec"}
res = call('/api/recognize', payload)
check('识别 ok 且 meta.rules_version=1', res.get('ok') and res['meta']['rules']['rules_version'] == 1,
      f"items={len(res.get('items') or [])}")

# 3) 生成（异步）：落库 + history_id
items = res['items']
hist_items = [{**it, 'cx': CX_DEFAULT, 'ok': True} for it in items]
g = call(EP_GENERATE, {'items': items, 'method': METHOD, 'title': TITLE,
                           'job': 's3gen', 'hist_items': hist_items, 'source_name': 't00928_req.docx'})
check('生成 ok 且自动落库', g.get('ok') and bool(g.get('history_id')), f"fp={g.get('summary', {}).get('ufp')}")

# 4) 历史：列表/详情/版本组/删除
l = call('/api/history?limit=10')
check('历史列表可见', l['ok'] and l['total'] >= 1, f"total={l['total']}")
d = call('/api/history/' + g['history_id'])
check('详情明细一致', d['ok'] and len(d['row']['items']) == len(items))
g2 = call(EP_GENERATE, {'items': items, 'method': METHOD, 'title': TITLE,
                            'job': 's3gen2', 'hist_items': hist_items, 'reopen_group': call(f"/api/history/{g['history_id']}/group")['versions'][0]['version_group']})
vs = call(f"/api/history/{g2['history_id']}/group")['versions']
check('重开同组版本递增', [v['version_no'] for v in vs] == [1, 2])

# 4b) FR-FE05 版本 diff：v2 相比 v1 改 1 条复杂度、删 1 条、加 1 条
# 注：后端 us_total 按 engine 口径（US 只由 type/reuse/modify 决定，cx 不参与），
# 故此处只改 cx 时两侧 us_total 相同属预期；ΔUS 的非零验证放在 UI 套件（改 reuse）。
h2_items = [dict(x) for x in hist_items]
h2_items = h2_items[1:]                                     # removed（末条被删）
h2_items[0]['cx'] = '低'                                    # changed（改留存条目的复杂度）
h2_items.append({**hist_items[0], 'desc': 'S3新增功能点', 'system': 'S3新增系统'})   # added
g3 = call(EP_GENERATE, {'items': [i for i in items], 'method': METHOD, 'title': TITLE,
                            'job': 's3gen3', 'hist_items': h2_items,
                            'reopen_group': call(f"/api/history/{g['history_id']}/group")['versions'][0]['version_group']})
df = call(f"/api/history/diff?a={g['history_id']}&b={g3['history_id']}")
check('diff 返回 ok 且分类计数正确',
      df.get('ok') and df['summary'] == {'added': 1, 'removed': 1, 'changed': 1},
      json.dumps(df.get('summary'), ensure_ascii=False))
chg = [c for c in df.get('changes', []) if c['kind'] == 'changed']
check('diff 字段级变化含 cx', len(chg) == 1 and chg[0]['fields'][0]['field'] == 'cx'
      and chg[0]['fields'][0]['a'] == '中' and chg[0]['fields'][0]['b'] == '低',
      json.dumps(chg[0]['fields'] if chg else [], ensure_ascii=False))
# 列表/详情的 count/us_total 必须有值（历史列表两列与 ΔUS 依赖它们）
check('历史列表 count/us_total 已填充', isinstance(l['rows'][0].get('count'), int)
      and isinstance(l['rows'][0].get('us_total'), (int, float))
      and df['a']['count'] > 0 and df['a']['us_total'] > 0,
      f"count={l['rows'][0].get('count')} us={l['rows'][0].get('us_total')}")
try:
    bad = call('/api/history/diff?a=ffffffffffffffffffffffffffffffff&b=' + g['history_id'])
    check('不存在的 a 返回 404', False, f"got {bad}")
except urllib.error.HTTPError as e:
    check('不存在的 a 返回 404', e.code == 404, str(e.code))
try:
    call('/api/history/diff?a=' + g['history_id'])
    check('缺 b 返回 400', False, '未返回 400')
except urllib.error.HTTPError as e:
    check('缺 b 返回 400', e.code == 400, str(e.code))
check('同版本自比无差异', call(f"/api/history/diff?a={g['history_id']}&b={g['history_id']}")['summary']
      == {'added': 0, 'removed': 0, 'changed': 0})

dl = call('/api/history/' + g['history_id'], method='POST')
check('删除生效', dl.get('ok') is True)

# 5) 规则保存链路（坏正则 400）
req = urllib.request.Request(API + '/api/rules/save', data=json.dumps(
    {'rules': [{'id': 'X', 'patterns': ['(['], 'scope': 'desc', 'type': 'EI', 'priority': 1, 'enabled': True}]}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
try:
    json.load(urllib.request.urlopen(req, timeout=30))
    check('坏正则保存被拒', False, '未返回 400')
except urllib.error.HTTPError as e:
    check('坏正则保存被拒', e.code == 400, str(e.code))

print(f"==== S3 汇总 ==== 失败 {len(fails)}")
sys.exit(1 if fails else 0)
