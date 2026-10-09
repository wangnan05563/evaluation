## 根因

前端 i18n 完成界面文案 key 化后，服务端 `msg` 仍为硬编码中文，靠 `frontend/src/js/01_core.js` 的 `LM_SERVER_MSGS`（46 条）/`LM_SERVER_TPL`（47 条）过渡映射兜底——「后端新增消息、前端映射表漏登记」即漏中文，属架构问题。

## 修复（文件绝对路径+改动点）

1. **`scripts/server.py`**（commit 08f8719）：新增 `_m(key, zh_tpl, **args)` 消息构造器——响应体同时携带 `msg`（中文原文，老前端/日志降级可读）、`msgKey`（稳定键）、`msgArgs`（插值参数）。53 处响应站点全部改造，键名**复用前端过渡表既有键**（`help.upd.*`/`history.*`/`pert.srv_*`/`config.*` 等，译文早已存在）；500 兜底与两处 `VErr` 透传 key/vargs。附带修复：generate 校验分支的透传代码缩进错位（`getattr(e,...)` 落到 except 块外，首轮回归暴露为生成链路 500，已修复并复验）。
2. **`scripts/validators.py`**：`VErr` 增加 `key`/`vargs` 元数据，20 条校验消息键化 `srv.v.*`（占位符 `字段 {field} 应为数值` 等，en 同步出译）。
3. **`frontend/src/js/01_core.js` + 4 个模块 js**：`lm()` 重写为接受响应对象（优先 `msgKey`→`tf(key,args)` 查字典，否则回退 msg 原文）；删除 `LM_SERVER_MSGS`/`LM_SERVER_TPL` 两表；33 处调用点 `lm(r.msg)`→`lm(r)`；更新区状态机（`__ver`/`renderUpdateFailed`/`verStateText`）改走 msgKey。
4. **`data/i18n/{zh-CN,en-US}.json`**：各 789→813 键（+24：`srv.v.*` 19 条 + 推送/导入/AI 连接/内部错误 5 条），双向对齐。
5. **守卫**：`tests/i18n_check.py` 新增「服务端 msgKey 两语字典齐备」构建期检查（扫描 server.py/validators.py 字面量，现 63 键 0 缺失）；`tests/ui_i18n.mjs` S12 映射表阈值 90→46（LM 表已删，注释说明）。

## 验证（实测证据）

- 隔离实例 API 冒烟：`brand_color=red` → 400 + `msgKey=srv.v.brand_color_invalid`；合法生成 `ok=true` 且历史落库；校验错误（items 非法/为空/method 非法）均 400+对应 msgKey；
- `tests/i18n_check.py` 0 失败（含新守卫）；
- `npm test` **11/11 全绿**（S6 flaky 按惯例 skip；报告 `logs/test_report_1791515425161.md`），其中 S12 多语言 82 项含英文态全页扫描 0 中文残留、更新区手动检查 toast 英文（`Update source not configured` 等已直译）、快算/历史/配置/引导页动态文案全英文；
- 验收对照：`LM_SERVER_MSGS`/`LM_SERVER_TPL` 条目数降为 **0**（两表整体删除）；`npm test` 全绿；S12 守卫不退化。

## 本次回写

无剩余工作。

## 下一步建议（可选）

（仅观察不建单）英文态下「上游大模型返回的错误文本」「历史 diff 的旧版快照内容」仍可能是中文——两者是外部/业务数据内容，不属界面文案口径（与 T01669 交付物边界同理）。
