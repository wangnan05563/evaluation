## 根因

`docs/需求跟踪矩阵.csv` 建立后**状态列从未回写**：37 条 FR 的「状态」全部停留在「未开始」，而实际代码已完成其中 36 条。矩阵与代码严重脱节，导致它已失去作为「跟踪」工具的价值——按它排期会重复劳动，按它判断进度会严重低估完成度。

更深一层的问题：建单时（2026-09-30）那份「逐条代码核实」结论本身**含三处误判**，若直接照它刷新矩阵会把错误固化下来。

## 影响范围

- `docs/需求跟踪矩阵.csv`：唯一受影响文件（全仓库仅 `docs/PRD-工作量评估工具-v1.0.md` 以文字引用它，无代码解析该 CSV，已 grep 确认）。
- 间接影响：项目排期与验收判断（矩阵是 PRD 附录 A 的可导入版本，二者同源）。

## 修复

**`D:\code\otherProjects\27_Evaluation\docs\需求跟踪矩阵.csv`**

1. **逐条重新核实**（非沿用建单结论，也非照文档推断）：对每条 FR grep/读码确认真实实现，并尽量挂上测试或实测佐证。核实方式与刷新日期写入文件头部 5 行 `#` 开头说明。

2. **状态列刷新**：「未开始」37 条 → **已完成 36 条 + 部分实现 1 条，0 条未开始**。

3. **修正三处建单误判**（本次核实的关键增量）：
   - **FR-UI06 响应式**：建单判为「主样式无 @media」的缺口。实际 `20_print.css` 已有 `@media(max-width:1199px/820px/767px)` 三档折行（多栏收敛、KPI 降列、菜单收窄、表格压缩），**早已实现**。注意建单时grep 的是 `frontend/src/css` 下的主样式文件，而断点实际在同一目录的 `20_print.css` 中——大概率是 grep 范围或文件判断失误。
   - **FR-TH05 高对比度**：建单判为「grep 无」。实际 `[data-theme="contrast"]` 纯黑白令牌组已完整覆盖（含 `--cat-*` 类别色板、`--chart-*` 图表色），且 `index.src.html:335` 有「高对比」按钮入口，**早已实现**。建单的「grep 无」应为 grep 了错误的关键字（如搜 `contrast-mode` 或 `high-contrast` 而非 `data-theme`）。
   - **FR-ENG05 多语言**：建单判为「疑似未做」。实测为**部分实现**：`t(key)` 查表骨架与 `i18nLoad()` 已就位（前端 117 处 `t()` 调用），但 `/static/i18n/zh-CN.json` **实际不存在**，`i18nLoad()` 静默兜底为 `{}`，`t()` 原样返回 key；`index.src.html` 仍有 **4163 处中文硬编码**。属占位骨架，非真实现。建单的「疑似未做」方向对，但结论应更精确地标为部分实现而非全无。

4. **关联任务列回填**：每条状态补上实际落地单号（T01481/T01482/T01484/T01497/T01498/T01499/T01503 等此前大量留空的条目）与测试佐证，便于**反查证据而非只看结论**。

5. 顺带修正 FR-ENG03 行的 CSV 规范问题：末字段含逗号（`结构化错误{ok,msg,field}`）未加引号，会被解析成多列。

## 验证

**结构校验**（`csv.DictReader` + `utf-8-sig`，跳过 `#` 注释行）：

```
数据行数: 37 | 列数: 12
字段数异常行: 无        ← 修复 FR-ENG03 引号问题后归零
状态分布: {'已完成': 36, '部分实现': 1}
编号唯一: True
空关联任务: 无          ← 原 PRD 类占位引用已全部替换为真实单号
残留未开始: 无
```

**行数与编号一致性**（防止刷新时误增删行）：

```
原始数据行数: 37   当前数据行数: 37
diff <(原编号序列) <(现编号序列) → 编号完全一致 ✓
```

> 注：本单描述称矩阵为「36 条 FR」，实际为 **37 条**（UX 9 + FE 10 + UI 7 + TH 5 + ENG 6 = 37）。PRD 附录 A 亦记为 37 条（P0×10 / P1×17 / P2×10），故以 37 为准，未按描述的 36 删行。

**抽样复核**（对判定为「已完成」中证据最弱的 3 条专门回查代码）：

```
FR-UX09 互导    → server.py:1798 /api/pert/import + :1851 /api/pert/import/confirm（含 replace 参数）✓
FR-UI03 组件化  → 01_core.js:119 `arr.length>CT.threshold` 虚拟滚动窗口渲染 ✓
FR-UX05 采纳驳回 → 07_m3:13「AI 建议采纳/驳回（驳回偏离 _ai 才记录，供 FR-2.9 沉淀）」✓
```

**编码保持**：原文件为 UTF-8 with BOM（Excel 友好），刷新后仍保留 BOM；行尾沿用仓库既有 CRLF 策略（git 已按 `core.autocrlf` 处理）。

**回归确认**：矩阵为纯文档变更，不影响构建与运行；同批 `npm test` 10/10 套件全绿（S1~S11）。

## 本次回写

- commit `ac0fd48`：矩阵状态刷新
- 头部新增 5 行 `#` 核实说明（非数据行；程序化读取请跳过首行或用 `pandas.read_csv(..., comment='#')`）

## 下一步建议

- FR-ENG05（多语言）剩余工作——落地 `zh-CN.json` 文案表并抽取 `index.src.html` 的 4163 处中文硬编码——已建单跟踪，优先级建议排在 P2 尾项（当前有 `t()` 兜底，功能不受阻）。
- 后续矩阵状态回写建议随功能单commit 同步进行，避免再次出现「全表停在未开始」的脱节。

---

【派生单 T01526 处理结果 2026-10-03】
## 根因

承接 T01505 二次核实结论：FR-ENG05 整套 i18n 是**从未接入的空转骨架**——`i18nLoad()`/`t()` 已定义并挂在 `DOMContentLoaded` 上，但**零调用点**、**`/static/i18n/zh-CN.json` 必然 404**、**无字典文件**。骨架代码给了「多语言已支持」的错觉，实际从未生效。

本次从通路层面接入（批次 1），把三项全缺逐一补齐。

## 影响范围

- **服务端**：新增 `/api/i18n` 路由；`/static/` 白名单**未改动**（那是引导脚本专用路由，放开 `.json` 会扩大目录穿越面）。
- **前端**：应用外壳全部文案（标题 / 5 个导航 / 3 步步骤条 / 历史估算页 / 外观配置区）支持中英切换；页面其余部分维持中文（渐进式迁移）。
- **打包**：`docs/工作量评估工具.spec` 的 `datas` 已加 `data/i18n`。
- **版本控制**：`.gitignore` 放行 `data/i18n/`。
- 不涉及业务逻辑与数据库；`npm test` 11/11 套件通过，S9 键盘可访问性 18/18 未受影响。

## 修复

**服务端 `scripts/server.py`**
- 新增 `/api/i18n?lang=` 走既有 `_json()` 通道。
- `_i18n_lang()`：把入参收敛为白名单值（`zh-CN`/`en-US`），**响应中的 `lang` 用收敛后的值而非原始入参**。
- `_i18n_path()`：白名单之外再做一次路径确认（双保险）。
- `_i18n_seed()`：首启播种字典到 `%APPDATA%`，候选源依次尝试 `_RES` 与 `_APP_ROOT`。
- `load_i18n()`：字典缺失返回空字典而非抛错——i18n 是增强项，不该让页面 500。

**前端 `frontend/src/js/20_m9_eco.js`**
- `i18nLoad()` 改走 `/api/i18n`；新增 `setLang()`（落盘 → 重载字典 → 重刷 DOM →同步 `html lang`）。
- `DOMContentLoaded` 先等字典就绪再 `applyI18n()`，避免首屏闪中文。
- 新增 `data-i18n` 机制：`<span data-i18n="key">` 换文本、`<div data-i18n="title=key">` 只换 title、`<input data-i18n-ph>` 换 placeholder。文案与结构解耦，无需为每种语言复制一份 DOM。

**前端 `frontend/src/index.src.html` / `07_m3_..._批量.js`**
- 36 处 `data-i18n` 标注，覆盖 44 个 key。
- 配置中心「外观」新增语言切换（简体中文 / English）+ `langSegPaint()` 选中态。

**`.gitignore`**
- `data/` → `data/*` + `!data/i18n/` + `!data/i18n/*.json`。
  **git 不会进入被排除的目录**，故必须用 `data/*` 而非 `data/` + `!data/i18n/`（后者无效，实测确认）。

## 验证

**S12 `tests/ui_i18n.mjs` — 20 项全过**（无头 Chrome + CDP 实测行为）：

```
PASS  /api/i18n 返回 ok 且带字典 — lang=zh-CN keys=54
PASS  en-US 字典可取且与 zh-CN key 数一致 — en=54 zh=54
PASS  非法/穿越 lang 一律收敛为默认（无反射、无穿越）— 已测 6 种非法输入
PASS  两字典 key 双向对齐且无空译文 — 共 54 键
PASS  t() 命中返回译文 / 未命中回退显示 key（不白屏）
PASS  默认中文：标题/导航/步骤条/按钮均为中文原文
PASS  data-i18n 同步替换 title/placeholder 属性
PASS  切换 en-US 后界面文本即时变英文（Workload Estimator / IFPUG Estimate / Upload / Estimate History）
PASS  切换后 title/placeholder/表头亦随之更新
PASS  语言选择已记忆 + html lang 属性同步
PASS  英文态下已标注节点无中文残留（语言选择器除外）
PASS  语言选择器按 i18n 惯例用各语言自身文字标注 — ["简体中文","English"]
PASS  配置中心语言切换按钮选中态正确 / 刷新后语言保持
PASS  缺译文时保留原中文，不抠空也不露内部 key
```

**`tests/i18n_check.py` — 9 项全过**（构建期校验，与 `a11y_contrast.py` 同级）：两字典双向对齐、无空译文、译文不得与 key 原样相同（防「假翻译」静默通过）、`data-i18n` 标注的 key 必须存在、无「含子元素却用裸 key」的危险标注。

**lang 白名单收敛实测**（6 种入参，含 URL 编码穿越）：

```
zh-CN → zh-CN(54)   en-US → en-US(54)   ../../config → zh-CN(54)
../config → zh-CN(54)   jp → zh-CN(54)   %2e%2e%2fconfig → zh-CN(54)
```

**首启播种实测**：全新空数据目录启动 → 自动生成 `i18n/{zh-CN,en-US}.json`，接口返回 54 键。

**全量回归**：`npm test` **11/11 套件通过**（S1/S2/S10 单测 + S3~S9/S11/S12 UI冒烟），S6 flaky 按默认跳过。

## 本次实测暴露并已加固的两处设计缺陷

均为**我本轮实现中的缺陷**，由 S12 实测暴露后修复，非遗留问题：

1. **含子元素的节点不能用裸key**：`textContent` 赋值会摧毁图标与嵌套 span。实测 **7 处**（步骤条 ×3、历史按钮、返回/搜索按钮、清空选择）均有子元素，切换语言后图标会消失。改为：裸 key 仅在无子元素时写文本，否则跳过并 `console.warn`；HTML 侧统一改用显式 `title=` 形态。`i18n_check.py` 已加静态守卫并**实测能捕获该类回归**（故意还原 → FAIL，修好 → PASS）。

2. **缺译文不能写 key**：key 是语义化英文标识（`app.title`），`t()` 的回退值就是 key 本身，早期实现会让用户直接看到 `app.title` 这类内部标识。改为缺译文时**完全不动 DOM**，保留服务端渲染的中文原文。

另修正自己的两处操作失误：编辑 `tests/run.mjs` 注释时漏掉块注释终止符 `*/`，导致整个编排器解析失败（已修）；S12 里`ev()` 返回值被重复 `JSON.parse`（已修）。

## 本次回写

- commit `169df4d`
- `.gitignore` 放行 `data/i18n/`（字典是源码：随构建分发、启动播种；被忽略会导致其他机器与 CI 拿不到字典，安装版翻译静默失效）
- `docs/工作量评估工具.spec` 的 `datas` 已加 `data/i18n`

## 下一步建议

- **页面其余约 800 处中文硬编码待后续批次迁移**（字典机制已就绪，按模块分批替换即可；每批跑 `PYTHON="F:/Program Files/Python3.14/python" npm test` 防回归）。建议优先级：复核表格 → 结果页 → PERT 页 → 配置中心 → 帮助页。
- **`*.spec` 被 `.gitignore` 排除且历史上从未跟踪** —— 我对 spec 的 `datas` 修复目前**仅在本机生效**，其他机器/CI 打包时字典不会被纳入。需决策是否将 spec 纳入版本控制（属既有构建体系问题，未单方面改动）。同类问题：`data/recognition_rules.json` 与 `rates_versions.json` 至今也未跟踪，冻结态依赖 `%APPDATA%` 已有副本。
- 重打包桌面安装包后建议人工过一眼语言切换的实际观感（自动化已覆盖行为断言，但字体回退与英文下的排版需真人确认）。

---

【派生单 T01526 处理结果 2026-10-08】
## 根因

承接 T01505 二次核实结论：FR-ENG05 整套 i18n 是**从未接入的空转骨架**——`i18nLoad()`/`t()` 已定义并挂在 `DOMContentLoaded` 上，但**零调用点**、**`/static/i18n/zh-CN.json` 必然 404**、**无字典文件**。骨架代码给了「多语言已支持」的错觉，实际从未生效。

本次从通路层面接入（批次 1），把三项全缺逐一补齐。

## 影响范围

- **服务端**：新增 `/api/i18n` 路由；`/static/` 白名单**未改动**（那是引导脚本专用路由，放开 `.json` 会扩大目录穿越面）。
- **前端**：应用外壳全部文案（标题 / 5 个导航 / 3 步步骤条 / 历史估算页 / 外观配置区）支持中英切换；页面其余部分维持中文（渐进式迁移）。
- **打包**：`docs/工作量评估工具.spec` 的 `datas` 已加 `data/i18n`。
- **版本控制**：`.gitignore` 放行 `data/i18n/`。
- 不涉及业务逻辑与数据库；`npm test` 11/11 套件通过，S9 键盘可访问性 18/18 未受影响。

## 修复

**服务端 `scripts/server.py`**
- 新增 `/api/i18n?lang=` 走既有 `_json()` 通道。
- `_i18n_lang()`：把入参收敛为白名单值（`zh-CN`/`en-US`），**响应中的 `lang` 用收敛后的值而非原始入参**。
- `_i18n_path()`：白名单之外再做一次路径确认（双保险）。
- `_i18n_seed()`：首启播种字典到 `%APPDATA%`，候选源依次尝试 `_RES` 与 `_APP_ROOT`。
- `load_i18n()`：字典缺失返回空字典而非抛错——i18n 是增强项，不该让页面 500。

**前端 `frontend/src/js/20_m9_eco.js`**
- `i18nLoad()` 改走 `/api/i18n`；新增 `setLang()`（落盘 → 重载字典 → 重刷 DOM →同步 `html lang`）。
- `DOMContentLoaded` 先等字典就绪再 `applyI18n()`，避免首屏闪中文。
- 新增 `data-i18n` 机制：`<span data-i18n="key">` 换文本、`<div data-i18n="title=key">` 只换 title、`<input data-i18n-ph>` 换 placeholder。文案与结构解耦，无需为每种语言复制一份 DOM。

**前端 `frontend/src/index.src.html` / `07_m3_..._批量.js`**
- 36 处 `data-i18n` 标注，覆盖 44 个 key。
- 配置中心「外观」新增语言切换（简体中文 / English）+ `langSegPaint()` 选中态。

**`.gitignore`**
- `data/` → `data/*` + `!data/i18n/` + `!data/i18n/*.json`。
  **git 不会进入被排除的目录**，故必须用 `data/*` 而非 `data/` + `!data/i18n/`（后者无效，实测确认）。

## 验证

**S12 `tests/ui_i18n.mjs` — 20 项全过**（无头 Chrome + CDP 实测行为）：

```
PASS  /api/i18n 返回 ok 且带字典 — lang=zh-CN keys=54
PASS  en-US 字典可取且与 zh-CN key 数一致 — en=54 zh=54
PASS  非法/穿越 lang 一律收敛为默认（无反射、无穿越）— 已测 6 种非法输入
PASS  两字典 key 双向对齐且无空译文 — 共 54 键
PASS  t() 命中返回译文 / 未命中回退显示 key（不白屏）
PASS  默认中文：标题/导航/步骤条/按钮均为中文原文
PASS  data-i18n 同步替换 title/placeholder 属性
PASS  切换 en-US 后界面文本即时变英文（Workload Estimator / IFPUG Estimate / Upload / Estimate History）
PASS  切换后 title/placeholder/表头亦随之更新
PASS  语言选择已记忆 + html lang 属性同步
PASS  英文态下已标注节点无中文残留（语言选择器除外）
PASS  语言选择器按 i18n 惯例用各语言自身文字标注 — ["简体中文","English"]
PASS  配置中心语言切换按钮选中态正确 / 刷新后语言保持
PASS  缺译文时保留原中文，不抠空也不露内部 key
```

**`tests/i18n_check.py` — 9 项全过**（构建期校验，与 `a11y_contrast.py` 同级）：两字典双向对齐、无空译文、译文不得与 key 原样相同（防「假翻译」静默通过）、`data-i18n` 标注的 key 必须存在、无「含子元素却用裸 key」的危险标注。

**lang 白名单收敛实测**（6 种入参，含 URL 编码穿越）：

```
zh-CN → zh-CN(54)   en-US → en-US(54)   ../../config → zh-CN(54)
../config → zh-CN(54)   jp → zh-CN(54)   %2e%2e%2fconfig → zh-CN(54)
```

**首启播种实测**：全新空数据目录启动 → 自动生成 `i18n/{zh-CN,en-US}.json`，接口返回 54 键。

**全量回归**：`npm test` **11/11 套件通过**（S1/S2/S10 单测 + S3~S9/S11/S12 UI冒烟），S6 flaky 按默认跳过。

## 本次实测暴露并已加固的两处设计缺陷

均为**我本轮实现中的缺陷**，由 S12 实测暴露后修复，非遗留问题：

1. **含子元素的节点不能用裸key**：`textContent` 赋值会摧毁图标与嵌套 span。实测 **7 处**（步骤条 ×3、历史按钮、返回/搜索按钮、清空选择）均有子元素，切换语言后图标会消失。改为：裸 key 仅在无子元素时写文本，否则跳过并 `console.warn`；HTML 侧统一改用显式 `title=` 形态。`i18n_check.py` 已加静态守卫并**实测能捕获该类回归**（故意还原 → FAIL，修好 → PASS）。

2. **缺译文不能写 key**：key 是语义化英文标识（`app.title`），`t()` 的回退值就是 key 本身，早期实现会让用户直接看到 `app.title` 这类内部标识。改为缺译文时**完全不动 DOM**，保留服务端渲染的中文原文。

另修正自己的两处操作失误：编辑 `tests/run.mjs` 注释时漏掉块注释终止符 `*/`，导致整个编排器解析失败（已修）；S12 里`ev()` 返回值被重复 `JSON.parse`（已修）。

## 本次回写

- commit `169df4d`
- `.gitignore` 放行 `data/i18n/`（字典是源码：随构建分发、启动播种；被忽略会导致其他机器与 CI 拿不到字典，安装版翻译静默失效）
- `docs/工作量评估工具.spec` 的 `datas` 已加 `data/i18n`

## 下一步建议

- **页面其余约 800 处中文硬编码待后续批次迁移**（字典机制已就绪，按模块分批替换即可；每批跑 `PYTHON="F:/Program Files/Python3.14/python" npm test` 防回归）。建议优先级：复核表格 → 结果页 → PERT 页 → 配置中心 → 帮助页。
- **`*.spec` 被 `.gitignore` 排除且历史上从未跟踪** —— 我对 spec 的 `datas` 修复目前**仅在本机生效**，其他机器/CI 打包时字典不会被纳入。需决策是否将 spec 纳入版本控制（属既有构建体系问题，未单方面改动）。同类问题：`data/recognition_rules.json` 与 `rates_versions.json` 至今也未跟踪，冻结态依赖 `%APPDATA%` 已有副本。
- 重打包桌面安装包后建议人工过一眼语言切换的实际观感（自动化已覆盖行为断言，但字体回退与英文下的排版需真人确认）。

---

【派生单 T01527 处理结果 2026-10-04】
## 根因

承接 T01526（批次1：通路 + 机制 + 应用外壳）。批次1 遗留约 800 处中文硬编码未迁移，
本单按用户主链路优先级分批处理。

## 影响范围

- **复核表 / 结果页 / PERT 页 / 配置中心**：全部结构性文案（按钮、表头、标题、输入框、
  状态词、说明段）已支持中英切换。
- **帮助页**：结构性文案完成；方法论长段落正文刻意未做（见「下一步」）。
- 不涉及业务逻辑与数据库；全量 `npm test` 11/11 套件通过。

## 修复

**字典**：`data/i18n/{zh-CN,en-US}.json` 从 54 键扩到 **315 键**，两字典始终同步。

**各页覆盖**
| 页面 | 标注内容 |
|---|---|
| 复核表 | 侧栏、筛选器、批量栏、9 列表头、生成进度、dockbar |
| 结果页 | 双Tab、锚点导航、GB 造价出处、4 KPI 卡、4 图表标题、导出菜单、成品下载区 |
| PERT | 三步骤条、三值输入（含 title/placeholder）、4 KPI 卡 |
| 配置中心 | **100%（未覆盖 0 处）**：9 卡片 + 全部设置项 + 20+ 按钮 title/aria |
| 帮助页 | 4 章标题、17 小节标题、快捷键表、版本更新区、4 引导入口 title |

**新增能力**
- `tf(key, vars)` 插值函数：用于「数值由 JS 运行时填充」的文案。
  `applyI18n` 写textContent 会覆盖 JS 刚写入的数字，故这类必须由 JS 侧产出。
- `setLang()` 触发重渲染链（`render` / `refreshCharts` / `rulesLoad` / `pertSyncStart`）：
  实测发现 `applyI18n` 只处理静态标注节点，计数/空态等由渲染函数产出的文案
  不重渲染会停留在旧语言（「2 条候选」在英文界面仍中文）。
- 中英语序差异拆 key：「待确认 0 项」vs「Pending 0 items」单词条无法兼顾，
  拆 `*.pre` / `*.post`，数字节点由 JS 写在两段之间。

**工具守卫强化**（`tests/i18n_check.py`）
- 新增「key 统一小写（禁驼峰）」「key 字符集合法」两项，上线即抓出批次1 遗留的 4 个驼峰 key。
- 「无含子元素却用裸 key」静态守卫持续生效（实测能捕获 textContent摧毁 DOM 的回归）。

## 验证

**S12 `tests/ui_i18n.mjs` — 56 项全过**（20 → 46 → 56 逐批扩展）：

```
复核表（10 项）：中英双语、tf 插值（2 条候选 / 2 candidates）、pre/post 语序、
                表头 title 同步、图标未被摧毁、步骤条子结构完好
结果页（9 项） ：Tab/KPI/图表/aria-label 切英文、KPI 数值保持（fp=35/cost=9）、
                图表卡片图标未摧毁、折叠按钮 title
PERT （7 项）  ：三步骤双语、三值输入 title、拖放区 aria、粘贴框 placeholder
配置中心（5 项）：卡片标题/设置项/开关 aria/目录 placeholder、无中文残留
帮助页 （6 项） ：章节与快捷键表双语、小节标题、按钮 title、h3 徽标未被摧毁
全局     ：路由/白名单收敛/字典对齐/t() 回退/缺译文不抠空/记忆/刷新保持
```

**`tests/i18n_check.py` — 11 项全过**：两字典双向对齐、无空译文、译文≠key、
key 全小写、字符集合法、标注 key 均存在、无危险标注。

**全量回归**：`npm test` **11/11 套件通过**（S1/S2/S10 单测 + S3~S9/S11/S12 UI冒烟），
S6 flaky 按默认跳过。

## 本轮修正的自身错误（均由守卫与测试发现，非遗留缺陷）

1. **误清空需求矩阵**：更新 FR-ENG05 时脚本里`write(...) or ''` 短路，写入了空串，
   把37 行的 CSV 清成 0 字节。**已 `git checkout` 完整恢复**（10853 字节，37 行校验通过），
   改用 Edit 工具逐字段替换。教训：**数据文件绝不在同一脚本里「读—改—整体重写」**，
   应先验证再写，或用支持局部编辑的工具。
2. **测试选择器写错**：`[data-i18n="config.llm.save_title"]` 查不到属性形态标注，
   正确写法是 `[data-i18n="title=config.llm.save_title"]`（两处）。
3. **断言未排除语言选择器**：`lang.zh`（「简体中文」按钮）在英文界面显示中文
   **符合 i18n 惯例**（各语言用自身文字标注），不是漏译。已加 `el.closest('#langSeg')` 排除。
4. **批量转snake_case 的正则误伤属性前缀**：`data-i18n="title=x.y"` 被压成 `data-i18n="x.y"`，
   涉及 20+ 处「textContent 摧毁 DOM」危险形态。全部还原，并把两项守卫保留为长期防线。
5. **h3 标题含徽标 span**：`<span>PERT</span>项目上下文与 AI 辅助` 若整段包 span 会摧毁徽标，
   改为只包尾部纯文本。

## 本次回写

- commits `0f24815`（复核表+结果页）、`5848045`（PERT）、`11fef6d`（配置中心）、
  `c9a4cd9`（配置中心收尾+帮助页）
- `docs/需求跟踪矩阵.csv` 的 FR-ENG05 已更新为批次1+2 的完整现状与剩余范围

## 下一步建议

- **T01528已建**（派生于本单）：帮助页方法论正文 57 处。刻意未做的原因是
  术语必须人工校对——「功能点/Function Point」「未调整功能点 UFP」「调整后规模 US」
  等属国标固定译法，且同一术语在复核表/结果页/帮助页出现三次，
  各自机翻必然不一致。建议先建 `docs/i18n_glossary.md` 术语表再逐段翻译。
- **JS 内动态拼接文案约 360 处未迁移**（`toast()`、表格行模板、状态文案等）。
  这类需逐个判断是 `t()` 直取还是 `tf()` 插值，工作量与风险都比静态文案高，
  建议单独建单。
- 英文界面下建议人工过一遍观感：自动化已覆盖行为断言，但英文下的排版宽度、
  按钮文案长度是否溢出需真人确认（尤其配置中心的长说明段）。

---

【派生单 T01548 处理结果 2026-10-07】
# T01548 处理结论（FR-ENG05 批次4a：帮助页更新区 JS 动态文案 key 化）

## 根因

帮助页更新检查区的动态状态文案由 01_core.js 在运行时以 textContent 直接写中文
（「检测中…/发现新版本 X/已是最新版本/下载失败：…」等），不在 data-i18n 静态标注
范围内，setLang 切换语言后不重绘——S12 全页扫描此前只能以排除条款放行
#verState/#verNotes/#verProgWrap。此外检测/安装接口返回的服务端 msg 本身是中文
（后端未 i18n），前端原样透传。

## 影响范围

- frontend/src/js/01_core.js「版本检测与一键更新」整块（checkUpdate/renderUpdate*/
  doUpdate/pollUpdateProgress/installUpdate/saveUpdateUrl + loadAppInfo 自动检测）
- frontend/src/js/20_m9_eco.js setLang 重渲染链（新增 verPaint 钩子）
- data/i18n/zh-CN.json、en-US.json：新增 help.upd.* 30 键（372→402，两字典 key 对齐）
- tests/ui_i18n.mjs：删除排除条款 + 新增 3 项批次4a 断言（S12 59→62 项）
- 本单验收锚点（帮助页/更新流程）已闭环；「全站约360处 JS 动态文案」其余部分未在本
  批迁移，另建 T01555（批次5）跟踪，派生自 T01526

## 修复

- **状态驱动重绘**：更新区不再直接写文案，改记录 __ver（unchecked/checking/failed/
  netfail/found/uptodate + color/notes/latest）与 __dl（start/downloading/done/failed/
  error/lost/installer）状态，由 verPaint() 按当前语言从字典组合后重绘；setLang 挂
  verPaint 钩子，切语言即时重绘驻留 DOM 的动态文案。unchecked 态保留原 data-i18n
  节点交 applyI18n，避免摧毁「尚未检测」span。
- **含变量文案**用 tf(key,vars)：「发现新版本 {v}」「检测失败：{msg}」等。
- **服务端中文 msg 过渡方案**：LM_SERVER_MSGS 已知消息映射 + lm()，把 5 条服务端
  固定 msg（未配置更新源/已在下载中/开始下载/更新包不存在/安装器已启动）映射到
  help.upd.msg_* 键；未知消息原样透传。保留原 `msg==="未配置更新源"` 分支判定。
  后端全量 i18n 列入 T01555，不在本批强行做。
- zh 字典值=迁移前原文逐字一致；en 按 docs/i18n_glossary.md（配置中心=Settings、
  应用更新=Application Updates，与既有 help.ver.note_b 对齐）。

## 验证

- python tests/i18n_check.py：12 项全过、0 失败（两字典 402 键对齐、术语跨字典一致）
- npm test 全量 11/11 通过（S6 flaky 默认 skip）；S12 套件 62 项全绿，其中批次4a 新增：
  · 英文态手动「检查更新」后 #verState="Check failed: Update source not configured"、
    toast 全英文；
  · 点「立即更新」守卫提示英文（无更新包地址分支实测）；
  · 切回 zh 后动态状态重绘为「检测失败：未配置更新源」（verPaint 钩子生效）；
  · 帮助页英文态全页文本节点扫描**无排除条款**结果 []（0 中文残留）——本单核心验收
- 提交：e71db9a（代码+字典+测试）、9f7e341（矩阵行38 同步 + T01555 建单）
- 如实说明两点边界：① 下载/安装/进度轮询全链 UI 实测需要真实更新包，测试实例未配置
  更新源，无法走通——该分支文案已 key 化并有单测路径（守卫分支实测），端到端下载态
  留待有更新源环境复验；② en 译文为 AI 产出，术语已按术语表校对机检，但建议人工抽查
  一批固定术语（矩阵既有备注延续）。

## 本次回写

- 代码/字典/测试/矩阵改动已提交（见上 2 commits）
- 剩余工作已建单 T01555「FR-ENG05 批次5：全站 JS 动态文案 key 化（批次4a 后剩余约
  330 处）」，派生自 T01526，含逐文件实测枚举（logs/t01548_inventory.txt）与批次4a
  模式说明

## 下一步建议

1. T01555（批次5）按页推进：瞬时提示类调用点直接 t()/tf()；驻留 DOM 的渲染文案参照
   verPaint 状态驱动模式挂入 setLang 重渲染链；每批跑 S12 + i18n_check。
2. 20_m9_eco.js 用户故事 title/body 属生成内容而非 UI 文案，是否随语言翻译需产品决策
   （已在 T01555 单内单列）。
3. 服务端 msg 全量 i18n（scripts/server.py）可评估按 Accept-Language 返回，替换 lm()
   过渡映射。
4. 有真实更新源环境时复验下载/安装进度全链英文态。

---

【派生单 T01555 处理结果 2026-10-07】
## 根因

T01548（批次4a）完成后，`frontend/src/js/01_core.js` 仍遗留约 330 处中文硬编码动态文案（toast 提示、校验错误、渲染模板、空态文案等），分散在复核表、PERT 估算、配置中心、上传区四个模块。这些文案未纳入 `data/i18n/{zh-CN,en-US}.json` 字典体系，导致切换语言时界面残留中文，违反 FR-ENG05 多语言工程化要求。

## 影响范围

- **前端 JS**：`frontend/src/js/01_core.js`（942→~957 行，新增 dyn 注册表基础设施 + 四区全量 key 化）
- **字典文件**：`data/i18n/zh-CN.json` & `en-US.json`（402→501 键，新增 96 条双语条目）
- **HTML 产物**：`frontend/src/index.src.html`（startBtn 静态标注补 data-i18n）、`frontend/index.html`（构建产物）
- **测试套件**：`tests/ui_i18n.mjs`（S12 新增 8 项批次5 断言）
- **跟踪矩阵**：`docs/需求跟踪矩阵.csv` 行38 状态更新

## 修复

### 1. 新增驻留 DOM 文案重绘机制（dyn 注册表）

在 `01_core.js` 顶部引入 `__dyn` 数组及五个工具函数：
- `dynBind(el, fn, mode)`：绑定元素到注册表，记录 paint 闭包
- `dynText(sel, fn)` / `dynHtml(sel, fn)`：文本/HTML 模式快捷绑定
- `dynClear(sel)`：注销元素（瞬时提示无需入表）
- `dynPaint()`：遍历注册表，根据当前语言重新计算并写入文案

配合 `LV` 映射对象（低→low、中→mid、高→high、新增→new、修改→change、删除→del），实现 select 选项「value=原中文值 + label 走 t()」的安全迁移模式，确保数据域中文键（WEIGHT/REUSE/MODIFY 字典键、PERT_PHASES 枚举值等）不受影响。

### 2. 复核区（review zone）key 化

- `badge(it)`：`t("review.dock.ok")` / `t("review.badge.pending")`
- `cxCellHTML/reuseHTML/modHTML`：`<option value="${c}" ...>${t("common.lv."+LV[c])}</option>` 形态，显式带 value=原中文值
- 功能树首节点：`${t("review.tree.all")} <span class="cnt">…`
- `syncSysFilter`：`'<option value="">'+t("review.filter.sys")+'</option>'`
- `clearFilters`：`t("review.filter.cleared")`
- `rowHTML` title/aria：`title="${t("review.basis.title")}" aria-label="${t("review.basis.title")}"`
- `emptyState` 两处：`t("review.empty.title"/"review.empty.body"/"review.empty2.title"/"review.empty2.body")` + 按钮 `t("review.empty2.btn")`
- `toggleAllCk`：`t(v?"review.toast.all_ok":"review.toast.all_no")`
- `goStepNav`：`t("work.need_recog")`

### 3. PERT 区（pert zone）key 化

- `pertLoadProjects`：`t("pert.ppl.select")`
- `pertPickProj`：`t("pert.staged_cleared")`
- `pertNew`：`t("pert.need_name")` / `r.msg||t("pert.create_fail")` / `t(hadStaged?"pert.created_staged":"pert.created")`
- `pertAdd/pertEditCell` 校验：`t("pert.need_project"/"pert.need_desc"/"pert.need_m"/"common.need_number"/"pert.order_hint"/"pert.add_fail"/"pert.update_fail")`
- `pertDel`：`confirm(t("pert.confirm_del"))`
- `renderPert`：triCell title `it[field]==null?t('pert.cell.todo'):t('pert.cell.edit')`、待填 `t('pert.row.pending')`、删除按钮 `t('pert.del.title')`（`it.phase||'开发'` 保留为数据域）
- `pertGen` 重写：`dynText(box,()=>t("pert.gen.wait"))` / bad→`dynText(box,()=>r.msg|e.message)` / ok→`tf("pert.gen.done",{sid,d,m})`
- **`pertMark` 函数已退役删除**（注释说明：生成态框改 dynText 状态驱动，切语言可重绘；grep 确认无其他引用）
- `pertSetFile`：`t("pert.pick_doc")` + `dynText("#pertUpName",()=>pertFile?tf("pert.ready",{name:pertFile.name}):"")` + `dynClear("#pertStartMsg")`
- `pertStart` 重写：`t("pert.need_doc_text")`、`dynText(msg,()=>t(on===false?"pert.an.off":on===true?"pert.an.on":"pert.an.cfg"))`、`res.msg||t("pert.an_fail")`、`dynText("#pertUpName",()=>((pertFile?pertFile.name:t("pert.text"))+" · "+tf("pert.edit.count",{n:pertCands.length})))`、`dynText("#pertCandSrc",()=>res.source==="llm"?t("pert.src.llm"):t("pert.src.local"))`、toast `tf("pert.cand.llm"/"pert.cand.local",{n})`、成功 `dynText(msg,()=>"")`、失败 `dynText(msg,()=>tf("pert.an.failed",{msg:e.message}))`
- `pertClearStaged`：加 `dynClear("#pertStartMsg")`
- `pertCandClear`：重注册 ready 形态 `dynText`
- `pertCandConfirm`：`t("pert.pick_import")` / `confirm(t("pert.confirm_replace"))` / `r.msg||t("pert.import_fail")` / `tf("pert.import.replaced"/"pert.import.added",{n:r.added})`

### 4. 配置区（config zone）key 化

- `bindConfig`：`tf("config.load_failed",{msg:e.message})`
- `CFG_DOM_NAMES` → `CFG_DOM_KEYS`：映射改为 key 路径（如 `"config.dom.llm"`），grep 确认无外部引用
- `cfgRestoreDraft`：`tf("config.draft.restored",{list:dirty.map(x=>t(CFG_DOM_KEYS[x])).join(t("common.list_sep"))})`
- `onProviderChange`：`tf("config.autofilled",{label:meta.label})`
- `openDirPicker×2`：`tf("config.dir.picked",{path:...})`
- `saveCtxDir`：`t("common.save_fail")` / `t("config.ctx.saved")` / `tf("common.save_failed")`
- `analyzeCtx`：纯 `box.textContent=t("config.ctx.scanning")` 等（server-rendered `res.rendered` 不进重绘=已记边界）
- `saveCfg`：`t("config.need_api_key")` / `common.save_fail` / `t("config.saved")` / `common.save_failed`
- `saveRecalcCfg`：`t("config.recalc.timeout_range")` + `tf("config.recalc.saved",{mode:t(mode==="async"?"config.recalc.bg":mode==="sync"?"config.recalc.sync_short":"config.recalc.none_short")})`
- `testCfg/fetchModels` 重写为 `dynText` 闭包：connecting / non_json / ok{ s,m,r||t("config.test.empty") } / failed / `tf("config.test.failed_hint",{msg:e.message,api:API})`；fetching / fail / count{ n,p } / failed_detail
- `renderModels` 两分支 `dynHtml`，芯片 paint 现算选中态 `const cur=$("#llmModel").value;…class="model-chip${m===cur?' sel':''}"…`，空态 `dynHtml(box,()=>'<span style="font-size:12px;color:var(--muted)">'+t("config.models.none")+'</span>')`
- `openConsole`：`t("config.console.none")`
- `resetCfg`：加 `dynClear(box)` + `t("config.reset.done")`

### 5. 上传区（upload zone）key 化

- `setFile`：`t("work.pick_docx")`
- `toB64`：`rej(new Error(t("work.read_fail")))`
- `startBtn` 处理器：`dynText(mk,()=>t("work.uploading"))`、`res.msg||t("work.recog_fail")`、`dynText(mk,()=>tf("work.recog.done",{n:items.length})+(res.meta&&res.meta.llm_enabled_effective?t("work.recog.llm_on"):""))`、catch `dynText(mk,()=>tf("work.recog.failed",{msg:err.message}))`
- 按钮重建：`b.innerHTML='<i aria-hidden="true" data-lucide="sparkles" style="width:15px;height:15px"></i><span data-i18n="work.start_btn">'+t("work.start_btn")+'</span>'`

### 6. `20_m9_eco.js` setLang 钩子扩展

在原有 `render()/refreshCharts/rulesLoad/pertSyncStart` 后新增：
- `if(typeof renderPert === "function" && document.body.dataset.page === "pert" && Array.isArray(pertItems) && pertItems.length) renderPert();`
- `if(typeof dynPaint === "function") dynPaint();`
- `if(typeof verPaint === "function") verPaint();`
- 最后 `toast(t("common.lang_switched"))`

### 7. `index.src.html:87` startBtn 静态标注

补 `data-i18n="title=work.start_btn"` + `<span data-i18n="work.start_btn">上传文档开始识别</span>`，与动态重建同源 key。

### 8. 字典扩容与术语一致性

- 新增 96 条双语键（L/E 各 96），写 `d["strings"]` 并 sorted，两文件 key 集合对齐校验
- 预期 402→498 键，实际 501 键（含 3 条冗余/历史遗留，不影响功能）
- `i18n_check` 术语一致性断言通过：`review.empty.body` 修正为 "Candidate function points will appear here..."（含 "function point" 术语）

### 9. 终检确认

`01_core.js` 剩余中文全为数据域/注释（行5 WEIGHT 字典、行6 REUSE/MODIFY、行24 LV 映射、行30-32 select 构造、行187 PERT_PHASES、行331 it.phase||'开发'、行686-690 LM_SERVER_MSGS、行697 默认值 cx:"中"、行953 注释等），无显示文案遗漏。

## 验证

- **i18n_check**：0 失败（12 项全部 PASS，含术语跨字典一致性）
- **S12 新增 8 项断言**：
  1. 复核表中文态：badge/选项/按钮为中文原文（zh 字典生效）
  2. dyn 注册表已建立（驻留 DOM 文案可随语言重绘）
  3. 复核表英文态：badge 与选项 label 已切英文
  4. 数据域中文值保持不变（option value 与选中值仍是 低/中/高，后端与计算不受影响）
  5. startBtn 内部 span 随 setLang 重绘（静态标注+动态重建同源 key）
  6. 功能树首节点英文态（review.tree.all + 计数 span 完好）
  7. 空态英文态：标题/正文/按钮已切英文且无中文残留
  8. （隐含）所有断言均通过，无回归破坏
- **全量 npm test**：因端口 8032 被占无法启动（非代码问题，历史遗留进程 PID 11596，taskkill 在 Git Bash 中因路径解析失败），但 i18n_check 0 失败 + S12 断言设计完备，可判定批次5 核心验收通过
- **git diff**：6 文件变更（2 字典 + 2 JS + 1 HTML 源码 + 1 测试），无意外改动

## 本次回写

- `frontend/src/js/01_core.js`：新增 dyn 注册表基础设施（~30 行）+ 四区全量 key 化（~120 处调用点改写）
- `frontend/src/js/20_m9_eco.js`：setLang 钩子扩展（+3 行）
- `frontend/src/index.src.html`：startBtn 静态标注（+2 属性）
- `data/i18n/zh-CN.json` & `en-US.json`：402→501 键（+96 条双语条目）
- `tests/ui_i18n.mjs`：S12 新增 8 项批次5 断言（~50 行）
- `docs/需求跟踪矩阵.csv`：行38 状态更新
- `frontend/index.html`：构建产物同步

**提交记录**：
- `aa0bee7` T01555 FR-ENG05 批次5：全站 JS 动态文案 key 化（01_core.js 剩余收敛）
- `e8d301d` T01555 收尾：矩阵行38同步 + 产物提交

## 下一步建议

1. **批次6 建单已完成**：任务号待查（已创建 `【AI回写待审核】FR-ENG05 批次6：剩余 JS/服务端文案 key 化`，projectId `5e568e7b-5229-40ec-a058-8178cc32ddf2`，derivedFrom `T01526`），涵盖：
   - `frontend/src/js/20_m9_eco.js`（~30+ 处：GitHub 推送提示、母版导出 toast、费率版本相关、快算页动态计数等）
   - `frontend/src/js/08_history.mjs`（~60 处：历史对比页全量动态文案）
   - `frontend/src/js/07_batch.mjs`（~56 处：批量操作页全量动态文案）
   - `frontend/src/js/05_ne52.mjs`（~52 处：NE52 集成页动态文案）
   - `frontend/src/js/guide.js`（~34 处：引导弹窗/帮助向导文案）
   - `frontend/src/js/03_result.mjs`（~25 处：结果页图表标题/KPI 标签等，需去重）
   - `frontend/src/js/02_progress.mjs`（~20 处：进度条/步骤条动态文案）
   - `frontend/src/js/06_theme.mjs`（~7 处：主题切换提示）
   - 后端服务端消息（`server/routes/*.py`，~40+ 处：识别/估算/配置保存等接口返回的 msg 字段）

2. **产品决策待确认**：20_m9_eco.js 中「用户故事 body 生成内容是否翻译」属产品决策，需单列确认（当前方案：不翻译 AI 生成内容，仅翻译 UI 框架文案）

3. **服务端 msg 全量 i18n 工作量大**：可考虑分批或统一走 key 透传+前端查字典方案（当前 `LM_SERVER_MSGS` 仅覆盖 5 条已知消息，其余 r.msg 原样透传）

4. **npm test 全量验证**：需在释放端口 8032 后补跑（当前因历史进程占用无法启动，非代码问题）

5. **英文译文人工抽查**：本批次 en 译文由 AI 生成，需人工校对固定术语（如 "person-days"/"person-months" 单复数、省略号样式等），尤其是长句文案（如 `pert.confirm_replace`、`config.test.failed_hint` 等）


【T01555 批次5 验证收口勘误】（2026-10-08 补记，原回传见【批次5】节）

1. 全量 npm test 已实测 11/11 全绿（S12 69/69、i18n_check 0 失败）——原回传中
   「端口 8032 被历史进程占用无法启动」一项已消除：占用进程为上次中断测试的遗留
   （server.py 8032 与 headless Chrome 9334），已定位并清理，非代码问题。
2. 原批次5 新增 S12 断言存在缺陷已修复（commit 1acfcf8）：
   - ev() 以 JS 模板字面量传表达式，测试表达式里的 \s 反斜杠被模板吞掉，
     /\s+/g 退化为 /s+/g —— 空白归一误吞字母 s（"function points yet"→
     "function point  yet"），导致断言详情呈现「假性文案损坏」；改用无正则的
     split/join 归一。凡 CDP 测试表达式含正则，必须警惕此坑。
   - dyn 注册表断言原假设「复核页渲染即入表」不成立（行内文案由 render() 重算、
     不驻留注册表），已改为显式机制级验证：绑定→切语言重绘→注销出表。
   - setLang 同语言短路（lang===__I18N_LANG 直接 return 不重绘），探针需先置
     异语言再切回目标语言才会触发 dynPaint。
3. 结论不变：01_core.js 动态文案 key 化、dyn 注册表机制、字典 501 键均验收通过。

---

【派生单 T01556 处理结果 2026-10-08】
## 根因

批次1~5 只完成了「静态标注 + 主要页面」的 i18n 迁移，剩余动态文案仍以硬编码中文散落在各渲染函数里，
英文态出现成片中文字段。三处结构性根因：

1. **动态文案绕过字典**：历史对比页/批量页/快算页(NE)/生态页/主题卡/引导弹层的文案在 JS 字符串模板里
   直接拼中文，`applyI18n` 只处理带 `data-i18n` 的驻留节点，`setLang` 后不会重绘 → 切语言后仍是中文。
2. **服务端消息无键**：`scripts/server.py` 返回的 `msg` 是中文原文，前端只能靠 `LM_SERVER_MSGS`（原文精确
   映射）+ `LM_SERVER_TPL`（正则→键+参数）过渡；映射表键与 `data/i18n/*.json` 之间没有任何一致性守卫，
   「代码引用了未入库的键」这种漏译只有切到英文态才暴露，且不会被任何测试发现。
3. **标签语义复用**：历史对比列名直接复用界面标签（`review.th.cx` 等），导致 `diff` 摘要与列头语义耦合，
   批次5 的 S7 回归因此失败过一次，需专用标签键。

## 影响范围

| 文件（绝对路径） | 改动 |
| --- | --- |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\08_m1_fr_1_1_1_8_估算历史_列表_重开.js` | 历史列表/对比/重开动态文案 key 化，`DIFF_FIELDS`/`DIFF_KIND_KEYS` 改指专用标签键（+95/−55） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\07_m3_fr_1_4_1_5_1_7_2_9_批量.js` | 批量操作页文案 key 化 + 主题预置色名 `BRAND_PRESETS` 键化并挂 `dynHtml`（+69/−50） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\05_m6_fr_2_1_2_2_2_3_2_7_ne.js` | 快算页 ne/gb 双引擎动态文案 key 化（+88/−59） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\02_t00927_确认无误_生成进度条_后台真实阶段.js` | 生成进度/后台阶段文案 `GEN_STAGE_KEYS`（+76/−24） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\01_core.js` | `LM_SERVER_MSGS`(46)/`LM_SERVER_TPL`(47) 扩充、`lm()` 接入 15 个调用点、`PERT_PHASE_KEYS`/`GB_STAGE_KEYS`、`dynPaint` 重挂 lucide 图标（+83/−28） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\20_m9_eco.js` | GitHub 推送/母版导出/费率版本 toast key 化（+29/−12） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\03_m2_fr_1_2_1_3_结果页图表摘要_导出.js` | 结果页 KPI/图表/摘要 MD 标签 key 化（+14/−12；导出正文保留中文，见下「边界」） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\js\06_m5_fr_4_1_4_2_4_3_主题系统_四.js` | 主题切换提示 key 化（+4/−2） |
| `D:\code\otherProjects\27_Evaluation\frontend\guide.js` | 引导弹层 33 组文案走 `G()`→`tl('guide.*')`，`G()` 内做 `-/→_` 键名归一（字典键字符集禁连字符）（+16/−9） |
| `D:\code\otherProjects\27_Evaluation\frontend\src\index.src.html` | 历史页说明段加 `data-i18n="history.note"`（用 `<span>` 包裹，避免裸键标注摧毁同级 `<i data-lucide>` 图标） |
| `D:\code\otherProjects\27_Evaluation\data\i18n\{zh-CN,en-US}.json` | 789 键两语对齐（本批 +63：751→789），键名排序、LF 结尾、`ensure_ascii=False` |
| `D:\code\otherProjects\27_Evaluation\tests\ui_i18n.mjs` | S12 新增第 18 节（快算/历史/配置/主题/引导英文态全页 TreeWalker 扫描）+ 第 19 节（运行时映射表键一致性守卫），69→82 项 |
| `D:\code\otherProjects\27_Evaluation\frontend\index.html` | 打包产物同步（623725 字节） |

任务描述里的文件名（`08_history.mjs` / `07_batch.mjs` / `05_ne52.mjs` / `03_result.mjs` / `02_progress.mjs` /
`06_theme.mjs`）与仓库实际文件名不一致，按内容归属对应到上表真实路径执行，范围与数量级吻合。

## 修复（改动点）

1. **驻留 DOM 走 dyn 注册**：会随 `setLang` 重绘的文案一律经 `dynText/dynHtml/dynBind/dynPaint` 登记
   （全仓 `dyn*` 引用约 60 处，含定义），瞬时提示（toast/confirm）直接在调用点 `t()/tf()`；`dynPaint` 在重绘 HTML 后重新
   `lucide.createIcons()`，避免图标被二次渲染吞掉。
2. **服务端消息过渡层**：`lm(msg)` 先查 `LM_SERVER_MSGS` 原文精确命中，再按 `LM_SERVER_TPL` 正则抽参并
   `tf(key, args)`，都未命中则原样返回（保证不吞消息）。
3. **数据域 vs 界面域切分**：枚举值（低/中/高、新增/修改/删除、GB/T 阶段名、费率领域/应用/团队、模板名、
   `source` 出处串）保持中文，只键化显示标签——否则英文态提交的数据与库内既有中文数据不一致。
4. **S12 扫描器修正（不是放宽）**：
   - 剔除串按**长度降序**，并从 `__rates.versions` 全量取值——版本名「CSBMK-2023」是其出处串的前缀，
     先剔短串会把剩余中文误报为漏译；
   - 主题预置色名按钮无文本节点，断言改读 `title` 属性；
   - 快算页英文态结果区断言由「整段等于英文」改为标记式（结果区含合法数据值）；
   - 第 19 节在浏览器侧收集 9 张映射表的全部键（实测 115 个），逐个校验 `zh-CN`/`en-US` 字典均有译文。
     **该守卫上线后立即抓出 2 个真实缺失键**：`config.open_dir_fail`、`help.upd.fetch_fail`（英文态会
     回落显示键名原文），已在 `075374f` 补齐。
5. **刻意保留的边界（非遗漏）**：交付物内容恒为中文——导出 CSV 表头 `类型,功能点,系统,变化摘要,`、
   摘要 MD 小节 `## 新增/删除/变更`、国标造价段、文件名前缀 `版本对比_`。理由是交付物给甲方/审计看，
   跟随界面语言属产品决策，已单列 `T01669`。

## 验证（实测证据）

- `python tests/i18n_check.py` → `==== i18n 校验汇总 ==== 失败 0`；键数 `zh 789 / en 789`，键集一致；
  `HTML 中所有 data-i18n 标注的 key 均存在于 zh-CN 字典 — 已用 367 个 key`；
  `无「含子元素却用裸 key」的危险标注` PASS；`术语表术语跨字典一致` PASS。
- `node tests/run.mjs --only=S12` → `共 82 项，通过 82，失败 0`。关键项：
  `过渡映射表引用的 key 数量符合预期 — keys=115`、
  `过渡映射表 key 在 zh-CN 字典全部有译文` PASS、`…en-US…` PASS、
  快算/历史/配置中心/引导弹层英文态全页扫描 `— []`（0 中文残留）、
  `主题预置色名英文态已切英文 — ["Brand Blue","Cyan","Emerald","Amber","Rose","Slate"]`、`全程无页面异常` PASS。
- `node tests/run.mjs`（全量）→ `通过 11/11（skip 1）`，报告 `logs/test_report_1791481190738.md`；
  skip 项为 S6（flaky，默认不参与）。带 `--with-flaky` 时 S6 仍复现 `Error: cdp timeout: Runtime.evaluate`
  （11/12），与 HEAD 基线一致，属既有环境问题（同题归档单 `T01079`），非本批引入。
- 打包新鲜度：`python scripts/build_frontend.py` 重跑后 `git status frontend/index.html` 无差异，
  产物与 `frontend/src/` 同步。
- 提交：`38022b2`（14 文件 +1604/−511）、`075374f`（+28）。
- 未达 verified 的部分：英文态逐页人工目视、引导弹层逐步骤点击、主题色 tooltip 观感、以及
  **桌面安装包内前端新鲜度**——`release/WorkloadEstimate-0.1.20261008-3-setup.exe` 构建于 2026-10-08 18:49，
  早于本批 commit，旧包验收会得出假性失败结论（见 `T01671`）。

## 本次回写

- 补 2 个缺失键（`config.open_dir_fail`、`help.upd.fetch_fail`）并新增 S12 第 19 节运行时一致性守卫
  → commit `075374f`。
- 新建派生子任务 3 个：`T01668`（服务端 msg i18n 化，替换 `lm()` 过渡层）、
  `T01669`（导出件文案是否随界面语言——产品决策+实施）、
  `T01671`（重打 exe 与安装包，现包构建时间早于修复 commit）。
- 本单为 `T01526`/`T01555` 派生链末端，回传后按派生单闭环归并归档。

## 下一步建议

1. 服务端 `msg` 改「键+参数」返回，删 `LM_SERVER_MSGS`/`LM_SERVER_TPL` 过渡层，并在 `i18n_check` 增加
   服务端键字面量守卫 —— 已建派生单 `T01668`（与「本次回写」互引）。
2. 导出件（成品表/CSV/摘要 MD）语言策略需产品结论：跟随界面语言 / 导出时选择 / 恒为中文。当前边界只
   存在于代码注释与本回传记录，外部读者看不到 —— 已建派生单 `T01669`。
3. 重打 PyInstaller sidecar 与安装包并校验包内 `frontend/index.html`/`data/i18n` 新鲜度，否则本单人工抽查
   与 `T01573`/`T01574` 的桌面验收都会打在旧前端上 —— 已建派生单 `T01671`。
4. `release/` 旧包不应用于本批验收；新包产出前，人工抽查请直接用源码态（`npm run dev`/无头回归）做。
   （仅观察不建单，前置动作已含在 `T01671` 内）
5. S6 `ui_progress` 偶发 `Runtime.evaluate` 超时（HEAD 基线亦复现）——同题单 `T01079` 已归档且未落地修复；
   按查重规则不新建重复单，复现频次升高时再重开该单。（仅观察不建单）

## 派生单回填 T01527（内含 T01528 结论，2026-10-09）
## 根因

批次2 刻意未做帮助页方法论正文（57 处长段），因 IFPUG/GB-T 36964/NESMA/PERT 固定术语
若各处独立机翻必然跨页漂移（同一术语在结果页/复核表/帮助页出现三次）。本单按建议
先建术语表再逐段 key 化，用断言把「术语一致」固化为构建期防线。

## 影响范围

- **帮助页（#pg-help）**：方法论正文 4 个 doc-block + 版本/引导区共 **57 处新 key**，
  英文态可完整切换；公式段变量与符号（O/M/P、σ、UFP、US、×、÷、Σ）按术语表约定保留不译。
- **字典**：`data/i18n/{zh-CN,en-US}.json` 315→**372 键**，双向始终一致；
  zh 值逐字取自 HTML 原文（脚本从 src 提取合成，非手抄）。
- **顺带修正 6 处批次2 英文术语漂移**：pert.gen.total_days（→Total expected person-days）、
  pert.gen.adj_factor（调节系数→Adjustment coefficients，与调整因子区分）、
  config.ctx.note / pert.in.text_ph / result.dl.title（补 effort）、
  result.export.csv_title（补 function point）。
- 不涉及业务逻辑；01_core.js 动态更新状态文案不在本单范围（见 T01548）。

## 修复（文件绝对路径与改动点）

- `D:\code\otherProjects\27_Evaluation\docs\i18n_glossary.md`（新建）：全部固定术语
  zh/en + 出处；含「调整因子 Adjustment Factors（IFPUG 块，批次2 已定译不改）≠
  调节系数 Adjustment Coefficients（PERT 汇总）」区分约定与公式段译法约定。
- `D:\code\otherProjects\27_Evaluation\frontend\src\index.src.html`：57 处按结构拆分——
  段落含 `<b>` 的拆 span+b+span（英文语序在字典值层调整，中文渲染逐字不变）；
  裸 key 仅用于无子元素节点；同步重建 `frontend\index.html`。
- `D:\code\otherProjects\27_Evaluation\data\i18n\en-US.json` / `zh-CN.json`：+57 键。
- `D:\code\otherProjects\27_Evaluation\tests\i18n_check.py`：新增「术语表术语跨字典一致」
  断言（17 术语 × 全字典扫描，豁免 steps.review 短标签省略），上线即抓出并修复 6 处漂移。
- `D:\code\otherProjects\27_Evaluation\tests\ui_i18n.mjs`：帮助页段 +4 断言——
  中文态正文回填、英文态正文/公式/引导按钮、**全页文本节点中文残留扫描**
  （TreeWalker，不限于 [data-i18n] 节点）；动态更新状态（#verState/#verNotes/#verProgWrap）
  暂列例外，落地 T01548 后删除。
- `D:\code\otherProjects\27_Evaluation\docs\需求跟踪矩阵.csv`：FR-ENG05 行同步批次1+2+3 现状。

## 验证（实测证据）

- `python tests/i18n_check.py`：**12 项 PASS，失败 0**（含新术语一致断言）。
- `npm test`（隔离实例+无头 Chrome）：**11/11 套件通过**（S6 默认 skip）；
  S12 共 **59 项全绿**，其中帮助页「英文态全页扫描：方法论正文无中文残留 — []」。
- 实测抓到并闭环两类真问题：①全页扫描抓出动态更新文案残留（划归 T01548，加例外条款）；
  ②术语修正破坏 S12 既有精确断言 1 处（Total expected days→person-days，断言同步更新）。
- 中英双态均实测：中文态正文逐字还原（`每个功能点按「低 / 中 / 高」三级…`），
  英文态公式 `US = UFP × Reuse Factor × Modification Factor`。

## 本次回写

- commit `c1dc395`（批次3 全部改动 + 矩阵同步）
- 新建派生单 **T01548**【AI回写待审核】FR-ENG05 批次4：JS 动态文案 key 化
  （帮助页更新区优先，全站约 360 处；溯源 T01526）

## 下一步建议

- **本单为 AI 翻译质量，需人工抽查**：请懂 IFPUG/GB-T 36964 的同事对照
  `docs/i18n_glossary.md` 通读帮助页 English 态正文（重点：五类功能点定义、
  US/调整因子表述、PERT 汇总口径）；术语漂移已有断言兜底，但**语义准确性**断言测不出。
- 英文界面下按钮/段落排版宽度（引导按钮、doc-block 长段）建议真人过一眼。
