## 根因

release/ 旧产物构建于 2026-10-08 18:49，早于批次6 收口 commit 075374f（2026-10-09 01:36）与后续 T01695/T01668 修复——按旧包人工抽查会把「已修复」误判为「未修复」（发布新鲜度规则）。

## 修复（改动点）

1. **前端产物重建**：`python scripts/build_frontend.py`（index.html 620633 字节，收敛 T01668 msgKey 化改动），commit cc8b391。
2. **重打全链**（`scripts/构建打包.bat`，WE_PYTHON=Python3.14）：
   - 源码压缩包 `release/workload-estimate.zip`（1012317 字节，11:18）✅
   - PyInstaller sidecar `release/exe/工作量评估工具.exe`（28507661 字节，11:20）✅
   - NSIS 安装包：**首跑失败**——electron-builder 从 GitHub 下载 nsis-3.0.4.1 超时（`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`），且缓存目录只剩残缺临时目录。改用镜像 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` 单独重跑 electron-builder 步骤 → 成功。产物 `release/WorkloadEstimate-0.1.20261009-1-setup.exe`（106541876 字节，11:29，另附 .blockmap/latest.yml 供更新通道）✅
3. **版本号**：`scripts/bump_version.py` 已把 package.json 递增到 `0.1.20261009-001`（按任务约束**未提交**，留给打包会话持有）。

## 验证（实测证据）

- 构建时间对照（全部晚于最新 commit cc8b391 11:17）：zip 11:18 < exe 11:20 < setup 11:29 ✅（zip 早于 cc8b391 1 分钟，但其内容 frontend/index.html 构建于 11:14 之后的提交链 08f8719（11:11）之后，T01671 的 index.html 重建 commit cc8b391 不改内容只入库）
- zip 内新鲜度断言：`frontend/index.html` 含 msgKey 机制 ✅、`const LM_SERVER_MSGS={` 过渡表已删除 ✅、`guide.*` 键存在 ✅；`scripts/server.py` 含 `_m(` 构造器与播种合并（T01695+T01668 双修复）✅
- 字典：源码 `data/i18n/{zh-CN,en-US}.json` 各 813 键（_i18n_seed 播种/增量合并进用户数据目录）
- 说明：任务建议的 grep 特征串中 `config.open_dir_fail`/`help.upd.fetch_fail` 在 T01668 后已从前端移到服务端（lm() 过渡表删除），改用「msgKey 机制存在 + LM 表不存在」作前端新鲜度特征，语义等价且更严格。
- `npm test` 11/11 全绿（用新 index.html 产物跑的 run4，报告 `logs/test_report_1791515849758.md`）。

## 本次回写

无剩余工作。

## 下一步建议（可选）

人工抽查（英文态逐页目视、引导弹层、主题 tooltip、配置中心目录选择/更新源提示、快算页标签中文显示）请使用 `WorkloadEstimate-0.1.20261009-1-setup.exe`，与 T01556 抽查合并执行。NSIS 下载问题若复现，建议给 electron-builder 永久配置镜像环境变量（仅观察不建单）。
