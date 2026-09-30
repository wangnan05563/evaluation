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
doc = open('data/testdocs/t00928_req.docx', 'rb').read()
payload = {"name": "t00928_req.docx", "b64": base64.b64encode(doc).decode(), "job": "s3rec"}
res = call('/api/recognize', payload)
check('识别 ok 且 meta.rules_version=1', res.get('ok') and res['meta']['rules']['rules_version'] == 1,
      f"items={len(res.get('items') or [])}")

# 3) 生成（异步）：落库 + history_id
items = res['items']
hist_items = [{**it, 'cx': '中', 'ok': True} for it in items]
g = call('/api/generate', {'items': items, 'method': '估算功能点', 'title': 'S3-API冒烟',
                           'job': 's3gen', 'hist_items': hist_items, 'source_name': 't00928_req.docx'})
check('生成 ok 且自动落库', g.get('ok') and bool(g.get('history_id')), f"fp={g.get('summary', {}).get('ufp')}")

# 4) 历史：列表/详情/版本组/删除
l = call('/api/history?limit=10')
check('历史列表可见', l['ok'] and l['total'] >= 1, f"total={l['total']}")
d = call('/api/history/' + g['history_id'])
check('详情明细一致', d['ok'] and len(d['row']['items']) == len(items))
g2 = call('/api/generate', {'items': items, 'method': '估算功能点', 'title': 'S3-API冒烟',
                            'job': 's3gen2', 'hist_items': hist_items, 'reopen_group': call(f"/api/history/{g['history_id']}/group")['versions'][0]['version_group']})
vs = call(f"/api/history/{g2['history_id']}/group")['versions']
check('重开同组版本递增', [v['version_no'] for v in vs] == [1, 2])
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
