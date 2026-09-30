import sqlite3
con=sqlite3.connect(r"d:\code\otherProjects\27_Evaluation\data\pert.db")
# 清掉项目1末尾 seq 5-9 的 seed 项（seed 时按 id 顺序加在后面；项目1原有1-4）
# 更简单：清空所有 project_id=1 之外再按需；这里只删 project_id=1 的 id>=5
con.execute("DELETE FROM pert_items WHERE project_id=1 AND id>=5")
# 找阜新项目
pid=con.execute("SELECT id,name FROM projects WHERE name='阜新票据优化PERT测试'").fetchone()
print("fx project:",pid)
con.commit()
con.close()