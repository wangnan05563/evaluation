# -*- coding: utf-8 -*-
"""识别层回放：用票据真实功能点描述回测识别器，比对权威标注，输出候选JSON并统计准确率。
目的：量化"正文描述→IFPUG类型/修改类型"识别能力，暴露待优化项，驱动识别层迭代。
"""
import json, re, sys
sys.path.insert(0, r"d:\code\otherProjects\27_Evaluation\scripts")
import generate_xlsx as g

OUT_JSON = r"d:\code\otherProjects\27_Evaluation\data\candidates_replay.json"


_rules_store = None

def set_rules_store(store):
    """注入规则表（server 启动时以 APP_DATA/recognition_rules.json 构造注入）。
    注入后 guess_type 走规则表驱动；规则表损坏（fallback）或未注入时回退内置链。"""
    global _rules_store
    _rules_store = store


def guess_type(desc: str, name: str) -> str:
    """M3/FR-2.9：规则表驱动的类型判定。未命中回退内置链末尾语义（默认 EI）。"""
    if _rules_store is not None:
        t, _hit = _rules_store.apply(desc, name)
        if t:
            return t
        if not _rules_store.fallback:
            return "EI"          # 规则表可用但全未命中：与内置链末尾语义一致
        # 规则表损坏（fallback=True）：落回内置链并交由 store.err 告警
    return guess_type_builtin(desc, name)


def guess_type_builtin(desc: str, name: str) -> str:
    d, n = desc or "", name or ""
    s = d + " " + n
    # 1) 数据文件(ILF)：表/字段/批次信息等结构变更，且非"页面"语境
    if (re.search(r"(增加|新增|修改|保存|更新).{0,14}(字段|表)", d)
            and not re.search(r"页面|界面|详情|展示", d)
            or ("报表数据信息" in n or n.endswith("批次信息") or n.endswith("登记信息表"))):
        return "ILF"
    # 校验/拦截类业务处理明确为 EI，避免"返回报错"被"返回"词误判为查询返回(EQ)
    if re.search(r"校验|拦截|报错|暂不符合|不予通过|不允许", d):
        return "EI"
    # 2) 查询/返回/下载/展示(箭头 EQ)
    if re.search(r"查询|下载|模板下载|导出|查看|展示|返回|回调|检索|详情查询", s):
        return "EQ"
    # 3) 派生输出(EO)：报表/对账/统计/加工口径
    if re.search(r"《.*》报表|报表|对账|统计|汇总|加工口径|数据打包|批量校验", s):
        return "EO"
    # 4) 外部接口(EIF)
    if re.search(r"外部|第三方|对接.{0,4}接口|跨系统", s):
        return "EIF"
    # 5) 事务输入(EI)：登记/报送/导入/保存/维护/审批/增删改
    return "EI"


def guess_modify(desc: str) -> str:
    # 描述语境优先；"新增"与"修改/优化/调整"容易同现，取出现位置靠前者
    idx_new = desc.find("新增")
    idx_mod = min(i for i in (desc.find(k) for k in ("修改", "优化", "调整")) if i >= 0) if any(
        k in desc for k in ("修改", "优化", "调整")) else -1
    if idx_new >= 0 and (idx_mod < 0 or idx_new < idx_mod):
        return "新增"
    if "删除" in desc:
        return "删除"
    return "修改"


def main():
    rows = g.read_template_rows()
    stats = {"total": 0, "type_hit": 0, "type_skip(空描述)": 0, "modify_hit": 0, "diff": []}
    cands = []
    for r in rows:
        desc = r["desc"]
        text = desc or r["m1"] or r["count_item"] or ""
        if not text:
            # 无可用描述：沿用权威标注，标注需人工
            gtype, gmod = r["type"], r["modify"]
            stats["type_skip(空描述)"] += 1
        else:
            gtype = guess_type(text, r["count_item"])
            gmod = guess_modify(text)
        stats["total"] += 1
        if gtype == r["type"]:
            stats["type_hit"] += 1
        else:
            stats["diff"].append({"sys": r["system"], "name": r["count_item"], "desc": text[:40],
                                  "判": gtype, "权威": r["type"]})
        if gmod == r["modify"]:
            stats["modify_hit"] += 1
        if gtype != r["type"]:
            basis = f"AI判{gtype}，权威为{r['type']}，需确认。"
        else:
            basis = f"识别为{gtype}；" + (f"见描述：{desc[:60]}" if desc else "描述为空，沿用标注")
        cands.append({
            "system": r["system"], "m1": r["m1"], "desc": desc or r["count_item"] or "",
            "count_item": r["count_item"], "type": gtype,
            "reuse": r["reuse"], "modify": gmod,
            "basis": basis,
        })

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(cands, f, ensure_ascii=False, indent=1)

    def pct(a, b): return f"{a}/{b} = {a / b * 100:.1f}%" if b else "-"
    print("识别层回放统计：")
    print(f"  总条数 {stats['total']}；类型命中 {pct(stats['type_hit'], stats['total'])}；"
          f"修改类型命中 {pct(stats['modify_hit'], stats['total'])}；空描述沿用 {stats['type_skip(空描述)']} 条")
    print("  类型判定不一致清单：")
    for d in stats["diff"][:25]:
        print(f"    [{d['sys']}] {d['name'][:18]:20} 判<{d['判']}> 权威<{d['权威']}> | {d['desc']}")
    print("已写候选人清单:", OUT_JSON)


if __name__ == "__main__":
    main()