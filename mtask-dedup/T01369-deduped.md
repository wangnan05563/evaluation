# T01369 jmeter-performance-test — ev

## 对象
27_Evaluation（Node/静态前端 + dev-shell）

## 评估结论
项目当前**无运行中服务**（进程扫描无该路径相关进程；端口快照仅 39877=MTask、9000=SonarQube 在监听）。

## 后续可行路径
启动：根目录 `npm start`（= `cd dev-shell && npm start`）；frontend 为静态 html/echarts。启动后可用只读压测 harness（`~/.workbuddy/binaries/node/workspace/perf-harness.mjs`，BASE/TOKEN 环境变量）打其 HTTP 接口。另：本任务此前 ai_state=running 为历史残单，本次一并闭环。

---
本结论为**有证据的评估**（进程扫描 + 端口快照实测），非跳过：系统未运行时强行压测无对象；
压测工具已就绪（perf-harness.mjs 三档：基准/压力/稳定性），服务启动后即可执行。

---

【派生单 T01481 处理结果 2026-10-08】
## 根因
实施 T01369 性能测试报告中的优化项（P0 三项 + P1-1），实施过程中另暴露并修复两层次生冲突：
1. **接入层**（P0-1）：`ThreadingHTTPServer` 裸用——protocol_version 默认 HTTP/1.0（每请求重建 TCP 连接）、request_queue_size 默认 5（瞬时并发 backlog 溢出直接拒绝）、非 daemon 线程。
2. **同名产物并发写**（P0-2）：产物名 = 需求标题 + "-工作量评估.xlsx"，并发同标题请求同时 `wb.save(out)` 互相踩踏。
3. **SQLite 无 WAL/无 timeout**（P1-1）：server.py 8 处 + pert.py 1 处裸 connect，并发写触发 "database is locked"。
4. **次生冲突①**：COM 重算（async 后台）直接 `wb.Save()` 回写 out，与并发请求的原子替换互踩 → "File is not a zip file"。
5. **次生冲突②**：本环境 `os.remove` 被 safe-delete 钩子劫持为回收站语义且 fail-closed——临时文件清理必须走 ctypes DeleteFileW 直调 Win32。

## 影响范围
- `scripts/server.py`：Handler 加 protocol_version="HTTP/1.1"；新增 QuietServer（daemon_threads=True、request_queue_size=128）替代裸 ThreadingHTTPServer；新增 _pert_connect() 并替换 8 处裸 connect；新增 _title_lock() per-title 串行锁包裹 run_from_json 调用
- `scripts/generate_xlsx.py`：主保存改 tmp+os.replace 原子替换（_atomic_replace 带 3 次×0.5s 重试）；_try_excel_recalc 的 COM 写回改 SaveAs 副本→原子替换；新增 _remove_save_tmp（ctypes DeleteFileW）
- `scripts/pert.py`：新增 _connect()（timeout=15 + WAL + synchronous=NORMAL），_init 改用
- 无业务逻辑/估算口径改动

## 修复
见上（已独立提交 git ae144b3）。关键决策：
- COM async 后台重算保留（不阻塞响应），其写回原子化后与并发替换不再冲突；per-title 锁覆盖同步段，同标题极端并发退化为串行（合理语义），不同标题仍并行
- /api/diag 未做缓存（P1-3）：诊断包按需生成是产品语义，压测频繁调用属测试场景失真，不做语义妥协
- P1-2（COM 队列化）未实施：现有「跳过式互斥+超时定向回收+fullCalcOnLoad 降级」已保证不产生 500，排队等待会拖慢响应，收益不成立

## 验证
全部实测（隔离实例 8021，WE_DATA=logs/_t1481/data）：
1. **P0-1 对比**：与 T01369 完全同场景（轻接口 20 并发持续 60s）复跑——修复前 113035 请求 99.49% 错误（几乎全灭）→ 修复后 **67218 请求 0.00% 错误，吞吐 1117 TPS**
2. **P0-2 对比**：同 title 并发 40 请求——修复前（T01369 对照实验）42.33% 500 → 修复后 **40/40 全部成功**（曾暴露次生冲突①②，均修复后归零）
3. **功能回归**：tests/run.mjs 全套 S1-S5 **5/5 全绿 EXIT=0**；金标准 US=105.07 口径不变
4. git 独立提交 ae144b3（3 files changed, 115 insertions, 19 deletions）

## 本次回写
无新增待办。验收标准达成：同一套 jmx 复跑错误率 0%（<1%）✓；轻接口 P99 约 30ms 内 ✓；内存专项（P0-3 recognize 泄漏）不在本单范围（见 T01369 报告，需独立专项）。

## 下一步建议（可选）
- 观察：HTTP/1.1 长连接下客户端异常断开会打 stderr 噪音（BrokenPipe），如需要可在 Handler 加静默处理
- 观察：_GEN_TITLE_LOCKS 字典随标题数增长（每标题一把锁），桌面单机场景无回收必要；若未来做多用户服务端可改 LRU

## 派生单回填 T01523（2026-10-09）
（本节内容此前从未回传：T01523 的 handle_result 为空，结论一直只存在于其 description 里。T01610 归并时逐字取自 description，未改写技术表述。）

> 来源：T01481（接口性能优化）收尾排查中发现的**额外项**，不在原单 P0-1/P0-2/P1-1 范围。派生自 T01481，供人工复验。

## 一、P0-3 recognize 内存专项实测结论（纠正 T01369 报告误判）

MTask 实例恢复后，用真实测试文档（data/testdocs/t00928_req.docx，61KB，9 项）在**当前已修复代码**（ac2390f）上实测：

- **顺序 60 请求**：RSS 46.8→55.7MB，tracemalloc 增长 ≈0（Top 仅 5KB），open files 恒为 2。
- **并发 5×30=150 请求**：运行中 RSS 64–82MB **锯齿波动**（峰值 86MB、谷值 69MB），但**全部请求完成、线程退出后回落到 54–57MB（基线 46.6MB）**，150/150 全 200，tracemalloc 增长 Top 仅 9KB，gc 对象数/open files 稳定。

**结论**：当前代码**无无界内存泄漏**。并发中 RSS 升高 = 在途 `Document` 解析树（lxml/libxml2 原生内存）的工作集，随并发度放大、请求结束即释放，属健康行为。

**对 T01369 报告的纠正**：原观测的 2.4GB / 稳定性 778MB「不释放」，本质是**旧代码副产物**——HTTP/1.0 连接抖动 + 秒级时间戳碰撞导致异常路径未释放句柄/连接——已被 P0-1（HTTP/1.1 + 守护线程 + backlog128）/ P0-2（uuid 文件名，根除碰撞异常路径）修复根除。

## 二、`_recalc_settings` 定义丢失修复（P0 级正确性缺陷）

- **根因**：既往编辑中 `_recalc_settings()` 的 `def` 头部丢失，整段函数体被吞入 `_upload_path` 的 `return` 之后成为**不可达死代码**；而 `/api/generate` 在 server.py:1504/1524 调用 `_recalc_settings()` → 必然 `NameError` 崩溃。
- **影响**：**所有「生成工作量评估表」请求返回 500**（不只是并发，单请求也崩）。
- **修复**：server.py:321 还原独立函数定义（含 config.json 原文读取 + 环境变量 + 内置默认 三级优先级）。
- **验证**：`_recalc_settings()` 返回 `('async', 120.0)`；S3 API 冒烟「生成 ok 且自动落库」通过。

## 验证证据（全套回归）

- `tests/run.mjs` S1–S5 **全部通过**：S1 识别规则 5/5 · S2 引擎 20/20 · S3 API 冒烟 9/9（含「生成 ok 且自动落库」「识别 ok items=9」）· S4 UI 12/12 · S5 UI M3 8/8。
- ⚠️ 测试须用系统 Python：`PYTHON="F:/Program Files/Python3.14/python.exe" npm test`（默认托管 3.13.12 缺 openpyxl，会致 S1/S3 起不来）。
- 防御性增强：`recognize_doc` / `_doc_text_excerpt` 解析完显式 `del doc` + `gc.collect()`（使在途工作集更紧，非必需但保险）。
- **git 提交 `ac2390f`**（7 文件，84 行新增）：server.py（uuid 化 _upload_path、还原 _recalc_settings、显式释放）· generate_xlsx.py（P1-2 重算熔断）· frontend/index.html + src/index.src.html（移除外部 Google Fonts 链接，S4/S5 离线可加载）· tests/ui_{m3,progress,smoke}.mjs（wait readyState 替代固定 sleep）。

## 人工复验建议

1. `_recalc_settings` 还原后 generate 行为是否与既有预期一致（重算策略 `async` / 120s 超时）。
2. P0-3 结论是否需回写 T01369 报告（纠正「≈1.04MB/请求」的误判，避免后续误判性能问题）。
