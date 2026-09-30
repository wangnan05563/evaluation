# -*- coding: utf-8 -*-
"""M8/FR-5.3：接口入参统一校验层（零依赖 dataclass 风格）。
失败统一返回 (ok=False, msg, field)；field 为字段路径（如 items[3].type）。
原则：只收紧明显非法输入，不改变任何现有合法行为。"""
import base64
import re

TYPES = ("EI", "EO", "EQ", "ILF", "EIF")
REUSES = ("高", "中", "低")
MODIFIES = ("新增", "修改", "删除")
METHODS = ("估算功能点", "预估功能点")


class VErr(Exception):
    """校验失败：msg 人类可读，field 字段路径。"""
    def __init__(self, msg, field):
        super().__init__(msg)
        self.msg, self.field = msg, field


def _req(payload, key, vtype=str):
    if not isinstance(payload, dict) or key not in payload or payload[key] is None:
        raise VErr(f"缺少必填字段 {key}", key)
    v = payload[key]
    if not isinstance(v, vtype):
        raise VErr(f"字段 {key} 类型应为 {vtype.__name__}", key)
    return v


def _num(v, field, lo=None, hi=None):
    try:
        x = float(v)
    except Exception:
        raise VErr(f"字段 {field} 应为数值", field)
    if lo is not None and x < lo:
        raise VErr(f"字段 {field} 不能小于 {lo}", field)
    if hi is not None and x > hi:
        raise VErr(f"字段 {field} 不能大于 {hi}", field)
    return x


def check_recognize(p):
    _req(p, "name")
    b64 = _req(p, "b64")
    if len(b64) > 70_000_000:                      # ≈50MB 原文
        raise VErr("文档过大（>50MB）", "b64")
    try:
        base64.b64decode(b64, validate=True)
    except Exception:
        raise VErr("b64 不是合法 base64", "b64")
    return p


def check_generate(p):
    _req(p, "method")
    if p["method"] not in METHODS:
        raise VErr(f"method 应为 {'/'.join(METHODS)}", "method")
    items = _req(p, "items", list)
    if not items:
        raise VErr("items 不能为空", "items")
    for i, it in enumerate(items[:5000]):
        if not isinstance(it, dict):
            raise VErr(f"items[{i}] 应为对象", f"items[{i}]")
        t = it.get("type")
        if t not in TYPES:
            raise VErr(f"items[{i}].type 非法（{t}）", f"items[{i}].type")
        if it.get("reuse") not in REUSES:
            raise VErr(f"items[{i}].reuse 非法", f"items[{i}].reuse")
        if it.get("modify") not in MODIFIES:
            raise VErr(f"items[{i}].modify 非法", f"items[{i}].modify")
    bc = p.get("brand_color")
    if bc and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(bc)):
        raise VErr("brand_color 应为 #RRGGBB", "brand_color")
    gb = p.get("gb_state")
    if gb is not None:
        if not isinstance(gb, dict):
            raise VErr("gb_state 应为对象", "gb_state")
        for k in ("gsc", "cf", "swf", "rdf", "pdr", "rate", "dnhc"):
            if k in gb:
                _num(gb[k], f"gb_state.{k}", lo=0)
    return p


def check_rules(doc):
    rules = _req(doc, "rules", list)
    for i, r in enumerate(rules):
        if not isinstance(r, dict):
            raise VErr(f"rules[{i}] 应为对象", f"rules[{i}]")
        if not (r.get("patterns") or []):
            raise VErr(f"rules[{i}].patterns 不能为空", f"rules[{i}].patterns")
        for pat in r["patterns"]:
            try:
                re.compile(pat)
            except Exception as e:
                raise VErr(f"rules[{i}] 正则非法：{e}", f"rules[{i}].patterns")
        pr = r.get("priority", 0)
        if not isinstance(pr, int) or not (0 <= pr <= 999):
            raise VErr(f"rules[{i}].priority 应为 0~999 整数", f"rules[{i}].priority")
    return doc
