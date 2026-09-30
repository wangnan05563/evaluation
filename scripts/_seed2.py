import os
import json, ssl, urllib.request, sqlite3
API=os.environ.get("WE_ENGINE","http://127.0.0.1:8020")
def post(path,p):
    req=urllib.request.Request(API+path,data=json.dumps(p).encode(),headers={"Content-Type":"application/json"},method="POST")
    return json.loads(urllib.request.urlopen(req,timeout=60).read().decode())
con=sqlite3.connect(r"d:\code\otherProjects\27_Evaluation\data\pert.db")
pid=con.execute("SELECT id FROM projects WHERE name='阜新票据优化PERT测试'").fetchone()[0]
con.close()
d=[("需求分析","","","需求梳理调研",5,8,12),
   ("系统设计","","","概要及详细、数据库设计",10,12,15),
   ("开发","票据系统","扣款","批量扣款提交功能",6,6,7),
   ("开发","票据系统","止付","止付结清功能",8,10,12),
   ("实施","","","部署上线、调测验收",25,30,35)]
for ph,s,m,desc,o,mp,p in d:
    r=post("/api/pert/item",{"project_id":pid,"phase":ph,"system":s,"module":m,"desc":desc,"optimistic":o,"most_likely":mp,"pessimistic":p})
    assert r["ok"], r
print("seeded pid=",pid, "ok")