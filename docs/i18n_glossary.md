# i18n 术语表（FR-ENG05）

> T01528 建立。帮助页方法论正文（IFPUG / GB/T 36964 方程法 / NESMA / PERT）的固定术语
> zh/en 译法在此**一次性固化**：`data/i18n/*.json` 中所有 key 的译文必须引用本表，
> 禁止各页独立机翻。一致性由 `tests/i18n_check.py` 的「术语跨字典一致」用例断言，
> 英文态中文残留由 S12（`tests/ui_i18n.mjs`）断言。

## 出处约定

| 缩写 | 全称 | 本项目对应 |
|---|---|---|
| IFPUG CPM | IFPUG Counting Practices Manual | 帮助页「评估方法论 / 算法说明」两块 |
| GB/T 36964 | 《系统与软件度量 软件规模度量》国标（功能点法/方程法） | 复杂度、重用度、调整因子等术语口径 |
| NESMA | Netherlands Software Metrics Association | PERT 页「NESMA 快速估算」 |
| PERT | Program Evaluation and Review Technique（计划评审技术） | 帮助页「三点估算」块 |

## 核心术语

| 中文 | English | 出处/说明 |
|---|---|---|
| 功能点 | Function Point (FP) | IFPUG CPM；禁止译作「功能点位」等 |
| 未调整功能点 | Unadjusted Function Point (UFP) | 与 result.kpi.fp「Unadjusted FP」一致 |
| 调整后规模（US） | Adjusted Size (US) | GB/T 36964 术语；**US 不是 Unit Size 的直译** |
| 调整后功能点 | Adjusted Function Points | 与 help.h4.a3 既有译法一致 |
| 内部逻辑文件 | Internal Logical File (ILF) | IFPUG 五类之一 |
| 外部接口文件 | External Interface File (EIF) | IFPUG 五类之一 |
| 外部输入 | External Input (EI) | IFPUG 五类之一 |
| 外部输出 | External Output (EO) | IFPUG 五类之一 |
| 外部查询 | External Inquiry (EQ) | IFPUG 五类之一 |
| 复杂度 | Complexity | 三级：低/中/高 = Low/Medium/High |
| 权重 | Weight | 类别权重 type weight × 复杂度权重 complexity weight |
| 重用度 / 重用程度 | Reuse | 与 result.chart.reuse「Reuse Distribution」一致 |
| 重用系数 | Reuse Factor | 公式内用量词，与「重用度」术语域区分 |
| 修改类型 | Modification Type | 新增/修改/删除 = Add/Modify/Delete |
| 修改系数 | Modification Factor | 同上 |
| 规模变更因子 | Size Changing Factor (SCF) | NESMA 术语，估算时机折减/放大 |

## 调整因子 vs 调节系数（易混，必须区分）

| 中文 | English | 说明 |
|---|---|---|
| 调整因子（IFPUG 块） | Adjustment Factors | help.h4.m4 批次2 已定译，含重用/修改/规模变更三项，**不改** |
| 调节系数（PERT 汇总） | Adjustment Coefficients | 客户/质量/变更/进度四项加成，与上行区分，避免同词歧义 |
| GB/T 36964 调整因子 CF | Adjustment Factor (CF) | 国标方程法口径；引用国标时可用单数 |

## 工作量与费用

| 中文 | English | 出处/说明 |
|---|---|---|
| 工作量 | Effort | 与 result.kpi.work 一致；标题「Workload Estimator」为产品名，不冲突 |
| 人天 | Person-Day | 与 help.h4.a4「Effort (person-days)」一致 |
| 人月 | Person-Month | 最理想人月 Ideal Person-Months |
| 人月单价 | Cost per Person-Month | 费用公式 |
| 生产率（PDR） | Productivity (PDR) | 单位 person-hours/FP（人时/FP） |
| 费用 | Cost | 单位 10k CNY（万元），与 help.h4.a5 一致 |
| 基准数据 | Benchmark Data | 换算工作量/费用的输入 |
| 上下限 | Lower / Upper Bounds | 中值 ±20%，与 help.h4.a6 一致 |

## PERT 三点估算

| 中文 | English | 出处/说明 |
|---|---|---|
| 三点估算 | Three-Point Estimation | 与 help.h3.pert 一致 |
| 计划评审技术 | Program Evaluation and Review Technique (PERT) | 正文首现给全称 |
| 乐观值 O | Optimistic (O) | 三值符号 O/M/P **不译** |
| 最可能值 M | Most Likely (M) | 同上 |
| 悲观值 P | Pessimistic (P) | 同上 |
| 预期工期 | Expected Duration | 与 help.h4.p3 一致 |
| 标准差 σ | Standard Deviation (σ) | 符号 σ 不译 |
| 汇总与调节 | Aggregation and Factors | help.h4.p4 批次2 已定译 |

## 公式段译法约定

- 变量与符号（O、M、P、σ、UFP、US、FP、×、÷、Σ、±）**一律保留不译**；
  公式内出现的中文术语按本表替换为固定英文，整式仍包在
  `<span class="formula">` 内。例：
  `US = UFP × 重用系数 × 修改系数` → `US = UFP × Reuse Factor × Modification Factor`。
- 公式外围说明文字（如「（估算中期取 1.10）」）单独成 key 翻译。

## 通用规则

- 数字、单位（10k CNY、person-hours/FP）、模板列名（E/F/G 列、R8 行）跨页一致；
  列名「最小/最可能/最大」= Minimum / Most Likely / Maximum（模板列引用）。
- 「配置中心」= **Settings**（与 nav.config 批次2 定译一致），不译 Configuration Center。
- 「复核」列表 = review；「需求输入」= Upload；步骤名以既有 key 为准。
- 语言选择器（简体中文/English）按 i18n 惯例用各语言自身文字标注，不算残留。
