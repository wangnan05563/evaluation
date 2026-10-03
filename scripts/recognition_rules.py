# -*- coding: utf-8 -*-
"""识别规则表（M3/FR-2.9）：data/recognition_rules.json 外置 + 驳回流沉淀。

匹配语义（与设计文档 §6 一致）：
  rules 按 priority 降序、数组序逐条尝试；scope 决定匹配文本（desc/name/any=d+' '+n）；
  patterns 任一命中且 exclude 全不命中即命中该规则；全部未命中返回 (None,None)，
  由 guess_type 回退：规则表可用→默认 EI（与内置链末尾一致）；规则表损坏→内置链并置 fallback 告警。
线程模型：锁保护规则快照；maybe_reload 按文件 mtime 自动重载（配置中心保存后即时生效）。
"""
import json
import os
import re
import threading
from datetime import datetime

SCHEMA_VER = 1
DEFAULT_TYPE = "EI"   # 与内置链末尾语义一致


class RulesStore:
    """识别规则存取与应用。"""

    def __init__(self, path):
        self.path = str(path)
        self._lock = threading.Lock()
        self._rules = []
        self._version = 0
        self._updated = ""
        self._mtime = None
        self.fallback = False
        self.err = ""
        self.reload()

    def reload(self):
        with self._lock:
            try:
                with open(self.path, 'rb') as f:
                    raw = f.read()
                d = json.loads(raw.decode('utf-8-sig'))
                rules = d.get('rules') or []
                for r in rules:                      # 预编译校验：坏正则直接整体回退
                    re.compile('|'.join(r.get('patterns') or ['(?!)']))
                self._rules = sorted(rules, key=lambda r: -int(r.get('priority') or 0))
                self._version = int(d.get('version') or 1)
                self._updated = d.get('updated_at') or ''
                self._mtime = os.path.getmtime(self.path) if os.path.exists(self.path) else None
                self.fallback = False
                self.err = ""
            except Exception as e:
                self._rules = []
                self._version = 0
                self.fallback = True
                self.err = f"{type(e).__name__}: {e}"

    def maybe_reload(self):
        try:
            m = os.path.getmtime(self.path)
        except OSError:
            return
        if m != self._mtime:
            self.reload()

    def version(self):
        with self._lock:
            return {"rules_version": self._version, "updated_at": self._updated,
                    "count": len(self._rules), "fallback": self.fallback, "err": self.err}

    def list_rules(self):
        with self._lock:
            return {"ok": True, "version": self._version, "updated_at": self._updated,
                    "fallback": self.fallback, "rules": json.loads(json.dumps(self._rules))}

    def save(self, rules):
        """整表保存（配置中心/沉淀入口）。坏正则抛 ValueError，由调用方返回 400。"""
        for r in rules:
            for pat in (r.get('patterns') or []):
                re.compile(pat)                      # 校验
        now = datetime.now().isoformat(timespec='seconds')
        doc = {"schema_ver": SCHEMA_VER, "version": self._version + 1,
               "updated_at": now, "rules": rules}
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)
        self.reload()
        return self.version()

    @staticmethod
    def _scope_texts(rule, d, n):
        """按 scope 取出该规则应匹配的文本集合。

        T01501（S3776）：scope 分派 + 空值过滤原内联在主循环里，与 exclude/异常处理
        交织后认知复杂度超阈值。抽成独立方法后，「取文本 → 判命中 → 排除」三段线性可读。
        scope 语义：desc 只看描述；name 只看文件名；其余（any）看两者拼接。
        """
        scope = rule.get('scope') or 'any'
        texts = {'desc': [d], 'name': [n]}.get(scope, [d, d + ' ' + n])
        return [t for t in texts if t]

    @staticmethod
    def _matches(rule, texts):
        """规则是否命中：任一 pattern 在任一文本中 search 到，且不在 exclude 名单内。
        坏正则（re.error）按「不命中」处理，与原行为一致——单条规则配错不应中断整表匹配。"""
        try:
            hit = any(re.compile(pat).search(t)
                      for pat in (rule.get('patterns') or [])
                      for t in texts)
            if hit and rule.get('exclude'):
                ex = re.compile('|'.join(rule['exclude']))
                if any(ex.search(t) for t in texts):
                    hit = False
            return hit
        except re.error:
            return False

    def apply(self, desc, name):
        """返回 (type, hit_rule_id)；未命中返回 (None, None)。"""
        self.maybe_reload()
        d, n = desc or '', name or ''
        with self._lock:
            rules = list(self._rules)
        for r in rules:
            if not r.get('enabled', True):
                continue
            if self._matches(r, self._scope_texts(r, d, n)):
                return r.get('type') or DEFAULT_TYPE, r.get('id') or r.get('name') or '?'
        return None, None
