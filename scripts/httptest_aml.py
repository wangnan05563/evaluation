import os
# -*- coding: utf-8 -*-
"""HTTP 冒烟测试：验证 本地服务 → 前端 的全链路端点。用反洗钱需求文档走一遍。
覆盖: /health → /api/recognize → /api/generate → /api/download
"""
import base64, json, urllib.request, sys
from pathlib import Path

API = os.environ.get("WE_ENGINE","http://127.0.0.1:8020")
DOC = Path(r"C:\Users\hspcadmin\Desktop\工作量评估\HNNS-EB-STD-REQ-002-票据业务系统反洗钱工作对接-日常优化类(公司金融部)(20260831).docx")

def post(path, obj):
    req = urllib.request.Request(API + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.load(r)

ok = True
def check(name, cond, extra=""):
    global ok
    print(("✔ " if cond else "✘ ") + name + ("  " + extra if cond else ""))
    ok = ok and cond

# 1) health
st, h = 200, json.load(urllib.request.urlopen(API + "/health", timeout=5))
check("GET /health", st == 200 and h.get("us") == "105.07 口径", str(h))

# 2) recognize
st, r = post("/api/recognize", {"name": DOC.name, "b64": base64.b64encode(DOC.read_bytes()).decode()})
items = r.get("items", [])
summ = r.get("summary", {})
check("POST /api/recognize", st == 200 and r.get("ok") and len(items) >= 8,
      f"{len(items)} 条候选; US={summ.get('us')}")
from collections import Counter
check("识别类型合理", Counter(i["type"] for i in items).get("EQ", 0) == 1, str(Counter(i["type"] for i in items)))

# 3) generate
gen_items = [{k: i[k] for k in ("system", "m1", "desc", "count_item", "type", "reuse", "modify")} for i in items]
st, g = post("/api/generate", {"items": gen_items})
sid = g.get("sid"); gs = g.get("summary", {})
check("POST /api/generate", st == 200 and g.get("ok") and sid and gs.get("us") == summ.get("us"),
      f"sid={sid}; US={gs.get('us')}")

# 4) download
req = urllib.request.Request(API + "/api/download?s=" + sid)
with urllib.request.urlopen(req, timeout=10) as r:
    data = r.read()
    check("GET /api/download (成品xlsx)", r.status == 200 and len(data) > 10000 and data[:2] == b"PK",
          f"{len(data)} 字节")

print("\n" + ("全部通过 ✔ 本地直连链路可用" if ok else "存在失败项，请检查") )
sys.exit(0 if ok else 1)