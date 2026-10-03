# -*- coding: utf-8 -*-
"""估算历史存储（M1 / FR-1.1、1.8、2.5）。

独立库 data/estimation.db（与 pert.db 平级，职责分离）；单表 estimation_history。
线程模型：ThreadingHTTPServer 多线程访问，内部用互斥锁 + 按次短连接，避免跨线程共用连接。
任何异常由调用方降级（历史功能禁用不影响估算主流程）。
"""
import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime

SCHEMA_VER = 1
# T01501（S1192）：diff 参与字段级比较的属性清单，原内联在 diff 方法里
_DIFF_CMP_FIELDS = ("system", "type", "cx", "reuse", "modify", "count_item")
MAX_ROWS = max(50, int(os.environ.get("WE_HIST_MAX") or 500))          # 保留上限，惰性清理
MAX_ITEMS_BYTES = 1024 * 1024                                          # items_json 体积上限 1MB

_DDL = """
CREATE TABLE IF NOT EXISTS estimation_history (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  title         TEXT NOT NULL,
  source_name   TEXT,
  method        TEXT NOT NULL,
  params_json   TEXT NOT NULL,
  items_json    TEXT NOT NULL,
  summary_json  TEXT,
  sid           TEXT,
  version_group TEXT NOT NULL,
  version_no    INTEGER NOT NULL DEFAULT 1,
  schema_ver    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_hist_created ON estimation_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hist_vgroup  ON estimation_history(version_group, version_no);
"""


class HistStore:
    """估算历史存取。insert/get/delete/list/group；线程安全。"""

    def __init__(self, db_path):
        self.db_path = str(db_path)
        self._lock = threading.Lock()
        self._init_schema()

    # ---- 基础 ----
    def _conn(self):
        c = sqlite3.connect(self.db_path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def _init_schema(self):
        with self._lock:
            c = self._conn()
            try:
                c.executescript(_DDL)
                c.commit()
            finally:
                c.close()

    @staticmethod
    def _now():
        return datetime.now().isoformat(timespec="seconds")

    # ---- 写 ----
    def insert(self, *, title, method, items, params=None, source_name=None,
               summary=None, sid=None, reopen_group=None):
        """写入一条历史。reopen_group 非空 = 重开修订（沿用组，version_no+1）；否则新建组。
        返回 {"id","version_group","version_no"}。items 超 1MB 抛 ValueError。"""
        items_json = json.dumps(items, ensure_ascii=False)
        if len(items_json.encode("utf-8")) > MAX_ITEMS_BYTES:
            raise ValueError("明细体积超过 1MB，暂不入库（可精简后重试）")
        params_json = json.dumps(params or {}, ensure_ascii=False)
        summary_json = json.dumps(summary, ensure_ascii=False) if summary is not None else None
        now = self._now()
        with self._lock:
            c = self._conn()
            try:
                if reopen_group:
                    row = c.execute("SELECT MAX(version_no) AS m FROM estimation_history WHERE version_group=?",
                                    (reopen_group,)).fetchone()
                    group, vno = reopen_group, (row["m"] or 0) + 1
                else:
                    group, vno = uuid.uuid4().hex, 1
                hid = uuid.uuid4().hex
                c.execute(
                    "INSERT INTO estimation_history (id,created_at,updated_at,title,source_name,method,"
                    "params_json,items_json,summary_json,sid,version_group,version_no,schema_ver) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (hid, now, now, title, source_name, method, params_json, items_json,
                     summary_json, sid, group, vno, SCHEMA_VER))
                # 惰性清理：超出保留上限时删最旧
                n = c.execute("SELECT COUNT(*) AS m FROM estimation_history").fetchone()["m"]
                if n > MAX_ROWS:
                    olds = c.execute("SELECT id FROM estimation_history ORDER BY created_at LIMIT ?",
                                     (n - MAX_ROWS,)).fetchall()
                    c.executemany("DELETE FROM estimation_history WHERE id=?", [(r["id"],) for r in olds])
                c.commit()
                return {"id": hid, "version_group": group, "version_no": vno}
            finally:
                c.close()

    def delete(self, hid):
        with self._lock:
            c = self._conn()
            try:
                cur = c.execute("DELETE FROM estimation_history WHERE id=?", (hid,))
                c.commit()
                return cur.rowcount > 0
            finally:
                c.close()

    # ---- 读 ----
    def list(self, query="", limit=50, offset=0):
        limit = max(1, min(int(limit or 50), 200))
        offset = max(0, int(offset or 0))
        with self._lock:
            c = self._conn()
            try:
                like = f"%{query.strip()}%"
                total = c.execute(
                    "SELECT COUNT(*) AS m FROM estimation_history WHERE ?='' OR title LIKE ? OR IFNULL(source_name,'') LIKE ?",
                    (query.strip(), like, like)).fetchone()["m"]
                rows = c.execute(
                    "SELECT id,created_at,updated_at,title,source_name,method,sid,version_group,version_no,"
                    "summary_json FROM estimation_history "
                    "WHERE ?='' OR title LIKE ? OR IFNULL(source_name,'') LIKE ? "
                    "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (query.strip(), like, like, limit, offset)).fetchall()
                out = []
                for r in rows:
                    d = dict(r)
                    try:
                        s = json.loads(d.pop("summary_json") or "{}")
                        d["count"] = s.get("count")
                        d["us_total"] = s.get("us_total") or s.get("total_us")
                    except Exception:
                        d["count"] = d["us_total"] = None
                    out.append(d)
                return {"ok": True, "total": total, "rows": out}
            finally:
                c.close()

    def get(self, hid):
        with self._lock:
            c = self._conn()
            try:
                r = c.execute("SELECT * FROM estimation_history WHERE id=?", (hid,)).fetchone()
                if not r:
                    return None
                d = dict(r)
                d["params"] = json.loads(d["params_json"] or "{}")
                d["items"] = json.loads(d["items_json"] or "[]")
                d["summary"] = json.loads(d["summary_json"]) if d["summary_json"] else None
                for k in ("params_json", "items_json", "summary_json"):
                    d.pop(k, None)
                return d
            finally:
                c.close()

    def group(self, hid):
        """按任一历史记录 id 返回其版本组的全部版本（路径参数是记录 id，非组键）。"""
        with self._lock:
            c = self._conn()
            try:
                anchor = c.execute("SELECT version_group FROM estimation_history WHERE id=?", (hid,)).fetchone()
                if not anchor:
                    return {"ok": True, "versions": []}
                rows = c.execute(
                    "SELECT id,version_no,created_at,title,sid,version_group FROM estimation_history "
                    "WHERE version_group=? ORDER BY version_no", (anchor["version_group"],)).fetchall()
                return {"ok": True, "versions": [dict(r) for r in rows]}
            finally:
                c.close()

    @staticmethod
    def _item_key(it):
        """功能点匹配键：描述 + 系统（去空格）。同名重复项由 _index_items 加 #seq 后缀去重。"""
        return (str(it.get("desc") or "").strip(),
                str(it.get("system") or "").strip())

    @classmethod
    def _index_items(cls, items):
        """把明细列表按匹配键建索引；同名仅保留首个，避免重复项炸出多余 removed/added。"""
        m = {}
        for idx, it in enumerate(items or []):
            k = cls._item_key(it)
            if not k[0] and not k[1]:
                k = ("#seq%d" % it.get("seq", idx), "")
            m.setdefault(k, it)
        return m

    @staticmethod
    def _field_changes(ai, bi):
        """逐字段比较两份功能点，返回有差异的字段列表。
        缺失字段与空串等价（统一 None→""），否则 count_item 的 None vs "" 会被误判为变更。"""
        out = []
        for f in _DIFF_CMP_FIELDS:
            av, bv = ai.get(f), bi.get(f)
            av = "" if av is None else av
            bv = "" if bv is None else bv
            if str(av) != str(bv):
                out.append({"field": f, "a": av, "b": bv})
        return out

    def diff(self, a_id, b_id):
        """FR-FE05：任选两历史版本生成 diff。按功能点描述(desc, 去空格)匹配；
        返回 added/removed/changed 及字段级变化(type/cx/reuse/modify/system/count_item)，
        并附两侧 summary(count/us_total) 供前端算增量。

        T01501（S3776）：原把「建索引 → 三轮分类 → 字段比较」全内联，三重循环加
        内层条件使复杂度超阈值。拆为 _index_items / _field_changes 两个纯函数，
        本函数只保留分类编排，判定口径逐条不变。
        """
        a = self.get(a_id)
        if not a:
            return {"ok": False, "msg": "基准版本不存在或已被清理", "which": "a"}
        b = self.get(b_id)
        if not b:
            return {"ok": False, "msg": "对比版本不存在或已被清理", "which": "b"}

        a_map, b_map = self._index_items(a.get("items")), self._index_items(b.get("items"))
        changes = []
        for k, it in b_map.items():
            if k not in a_map:
                changes.append({"kind": "added", "name": it.get("desc"),
                                "system": it.get("system"), "item": it})
        for k, it in a_map.items():
            if k not in b_map:
                changes.append({"kind": "removed", "name": it.get("desc"),
                                "system": it.get("system"), "item": it})
        for k in a_map:
            if k not in b_map:
                continue
            ai, bi = a_map[k], b_map[k]
            fields = self._field_changes(ai, bi)
            if fields:
                changes.append({"kind": "changed", "name": bi.get("desc"),
                                "system": bi.get("system"), "fields": fields,
                                "a": ai, "b": bi})

        def summ(row):
            s = row.get("summary") or {}
            return {"count": s.get("count"), "us_total": s.get("us_total") or s.get("total_us")}

        return {
            "ok": True,
            "a": {"id": a["id"], "title": a["title"], "version_no": a["version_no"],
                  "created_at": a["created_at"], **summ(a)},
            "b": {"id": b["id"], "title": b["title"], "version_no": b["version_no"],
                  "created_at": b["created_at"], **summ(b)},
            "changes": changes,
            "summary": {
                "added": sum(1 for c in changes if c["kind"] == "added"),
                "removed": sum(1 for c in changes if c["kind"] == "removed"),
                "changed": sum(1 for c in changes if c["kind"] == "changed"),
            },
        }
