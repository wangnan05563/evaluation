# -*- coding: utf-8 -*-
"""M3 规则引擎：按 IFPUG 与成品模板公式口径计算 US 及汇总（正本清源，供校验与前端展示）。
与母版《规模估算/费用估算》公式保持一致：
- UFP 按"估算功能点"方法取类别默认权重：ILF10/EIF7/EI4/EO5/EQ4
- US = UFP × 重用系数 × 修改类型系数
"""
from typing import Iterable

# 权重（估算功能点法）：对应母版 '模板使用说明&基础参数' E22-E26
WEIGHT = {"ILF": 10, "EIF": 7, "EI": 4, "EO": 5, "EQ": 4}
# 母版预估功能点法（E15-E16），仅 ILF/EIF 有值
WEIGHT_PRE = {"ILF": 35, "EIF": 15}
# T01501（python:S1192）：方法名字面量原在 4 个函数签名里重复内联，
# 且 validators.METHODS 另有一份；改口径须同步多处，易漏。提取为常量并由其派生 METHODS。
METHOD_ESTIMATE = "估算功能点"      # 默认口径：全部类别取 WEIGHT
METHOD_PRESELECT = "预估功能点"      # 母版口径：仅 ILF/EIF 取 WEIGHT_PRE，事务类回退 WEIGHT
METHODS = (METHOD_ESTIMATE, METHOD_PRESELECT)
# 母版实际为精确分数：高=1/3、中=2/3（0.333.../0.666...），低=1
REUSE = {"低": 1.0, "中": 2 / 3, "高": 1 / 3}
MODIFY = {"新增": 1.0, "修改": 0.80, "删除": 0.20}
# 规模变更调整因子（估算时机），母版 H51-H54 / I51-I54
SCALE_CHANGE = {"估算早期": 1.39, "估算中期": 1.21, "估算晚期": 1.10, "项目交付后及运维阶段": 1.00}


def weight(type_: str, method: str = METHOD_ESTIMATE) -> int:
    table = WEIGHT_PRE if method == METHOD_PRESELECT else WEIGHT
    if type_ in table:
        return table[type_]
    if method == METHOD_PRESELECT:
        return WEIGHT[type_]  # 预估功能点法母版仅 ILF/EIF 有专门权重，事务类回退估算权重
    raise ValueError(f"未知类别 {type_}")


def us(type_: str, reuse: str, modify: str, method: str = METHOD_ESTIMATE) -> float:
    """US = 类别权重 × 重用系数 × 修改系数。"""
    if reuse not in REUSE or modify not in MODIFY:
        raise ValueError(f"非法取值 reuse={reuse}, modify={modify}")
    return weight(type_, method) * REUSE[reuse] * MODIFY[modify]


def total_us(items: Iterable[dict], method: str = METHOD_ESTIMATE) -> float:
    return round(sum(us(i["type"], i["reuse"], i["modify"], method) for i in items), 2)


def summary(items: Iterable[dict], timing: str = "估算中期", method: str = METHOD_ESTIMATE) -> dict:
    """返回与费用估算链路一致的汇总（工作量月 = 天/22；费用单位万元）。"""
    ufp = sum(weight(i["type"], method) for i in items)
    us_sum = total_us(items, method)
    adjusted = round(us_sum * SCALE_CHANGE[timing], 2)  # 调整后规模 = US × 规模变更因子
    eff_mid = 10.67  # 中值生产率(人时/FP)
    work_mid = adjusted * eff_mid / 8            # 未调整工作量(人天)
    work_low, work_high = work_mid * 0.8, work_mid * 1.2
    factor = 0.8                                 # 调整因子链（应用类型1×质量1×完整1×语言1×团队0.8）
    perf = 22
    price = 2.57
    return {
        "ufp": ufp, "us": us_sum, "adjusted_fp": adjusted,
        "work": {"low": round(work_low * factor, 2), "mid": round(work_mid * factor, 2),
                 "high": round(work_high * factor, 2)},
        "cost": {"low": round(work_low * factor / perf * price, 2),
                 "mid": round(work_mid * factor / perf * price, 2),
                 "high": round(work_high * factor / perf * price, 2)},
    }