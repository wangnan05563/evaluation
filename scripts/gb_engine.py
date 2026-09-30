# -*- coding: utf-8 -*-
"""M6/FR-2.1、2.2、2.7：NESMA 快算与 GB/T 36964 方程法造价（零依赖纯函数）。

口径出处：
  NESMA 预估法 UFP = 35×ILF + 15×EIF；估算法 UFP = 7×ILF+5×EIF+4×EI+5×EO+4×EQ（GB/T 42588-2023 / NESMA 2.1）。
  GB/T 36964-2018：S = UFP × GSC × CF；AE = PDR × S × SWF × RDF；费用 = AE / 174 × 费率 + 直接非人力成本。
  CF 按估算阶段；SWF 按业务领域×应用类型；RDF 按开发语言×团队背景（CSBMK-2023 公开口径，可经费率版本覆盖）。
"""

NESMA_PRE = {"ILF": 35, "EIF": 15}
NESMA_EST = {"ILF": 7, "EIF": 5, "EI": 4, "EO": 5, "EQ": 4}

CF = {"预算": 1.70, "立项": 1.45, "招标": 1.25, "需求": 1.10, "设计": 1.00}

SWF = {  # 业务领域 → 应用类型 → 因子（CSBMK-2023 公开口径，费率版本可覆盖）
    "金融": {"后台核心": 1.67, "渠道类": 1.30, "分析类": 1.10},
    "政务": {"后台核心": 1.15, "渠道类": 1.00, "分析类": 0.95},
    "制造": {"后台核心": 1.10, "渠道类": 1.05, "分析类": 0.95},
    "通用": {"后台核心": 1.00, "渠道类": 1.00, "分析类": 1.00},
}
RDF = {  # 开发语言 → 团队背景 → 因子（CSBMK-2023 公开口径，可覆盖）
    "Java": {"熟手": 1.00, "一般": 1.10, "新手": 1.25},
    "Python": {"熟手": 0.95, "一般": 1.05, "新手": 1.20},
    "前端/全栈": {"熟手": 1.00, "一般": 1.08, "新手": 1.22},
    "其他": {"熟手": 1.00, "一般": 1.10, "新手": 1.25},
}


def nesma_ufp(counts: dict, mode: str = "est") -> int:
    """NESMA 快算。counts={"ILF":n,"EIF":n,...}；mode="pre"（预估法）|"est"（估算法）。"""
    table = NESMA_PRE if mode == "pre" else NESMA_EST
    return sum(table.get(k, 0) * int(v or 0) for k, v in counts.items() if k in table)


def gb_cost(ufp: float, gsc: float, cf: float, swf: float, rdf: float,
            pdr: float, rate: float, dnhc: float = 0.0) -> dict:
    """GB/T 36964 造价测算。返回逐级中间量（元），供页面出处展示与报告。"""
    ufp, gsc, cf, swf, rdf, pdr, rate, dnhc = (float(x) for x in
                                               (ufp, gsc, cf, swf, rdf, pdr, rate, dnhc))
    s = ufp * gsc * cf
    ae = pdr * s * swf * rdf
    fee = ae / 174.0 * rate + dnhc
    return {"s": round(s, 2), "ae": round(ae, 2), "fee": round(fee, 2),
            "manmonth": round(ae / 174.0, 2)}


def rates_ok(v: dict) -> bool:
    """FR-2.3：费率版本合法性（负数/超界拒绝）。"""
    try:
        if float(v["pdr"]) <= 0 or float(v["pdr"]) > 1000:
            return False
        if float(v["rate"]) <= 0 or float(v["rate"]) > 10_000_000:
            return False
        if float(v.get("unit_price", 0)) < 0 or float(v.get("dnhc", 0)) < 0:
            return False
        return True
    except Exception:
        return False


# COCOMO II 2000 · Early Design（出处：Boehm et al., COCOMO II 2000；SF 取名义值 3.72）
COCOMO_SF = 3.72          # 规模因子名义值（Early Design 五因子各取 Nominal=3.72/5≈… 此处取ΣSF=3.72 常用缺省）
COCOMO_A = 2.94
COCOMO_B = 0.91


def cocomo_ii(kloc: float, eaf: float = 1.0, sf_sum: float = COCOMO_SF) -> dict:
    """COCOMO II Early Design：PM = A × EAF × (KLOC)^E，E = B + 0.01×ΣSF；工期 TDEV = C×PM^F（C=3.67,F=0.28+0.2×(E-0.91)）。"""
    kloc = float(kloc)
    if kloc <= 0:
        return {"pm": 0.0, "tdev": 0.0, "staff": 0.0}
    e = COCOMO_B + 0.01 * sf_sum
    pm = COCOMO_A * eaf * (kloc ** e)
    f = 0.28 + 0.2 * (e - 0.91)
    tdev = 3.67 * (pm ** f)
    return {"e": round(e, 4), "pm": round(pm, 2), "tdev": round(tdev, 2), "staff": round(pm / tdev, 2) if tdev else 0.0}
