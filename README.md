# 工作量评估助手

> 需求文档 → IFPUG 功能点 → 成品造价表（引擎直连）

本地运行的软件项目工作量评估工具：上传需求说明书，自动识别 IFPUG 功能点并生成符合企业造价模板的成品评估表；同时提供 PERT 三点估算双模式，支持大模型（LLM）辅助识别与拆分。全部计算在本地完成，需求文档不出本机。

## 特性

- **IFPUG 估算**：上传 `.docx` 需求文档 → 本地引擎解析候选功能点 → 逐条审核（类别/复杂度/重用/修改）→ 一键生成《规模估算》《费用估算》成品 xlsx（公式与样式保真，Excel 打开即重算）
- **PERT 三点估算**：新建/选择项目 → 需求导入（AI 拆分或人工录入）→ 乐观/最可能/悲观三值 → 预期 = (O + 4M + P) ÷ 6、σ = (P − O) ÷ 6 → 生成 PERT 成品表
- **大模型识别增强**：配置中心可接入任意 OpenAI 兼容接口（OpenAI / Claude / 通义 / 火山 / Agnes / 自定义），支持连接测试、模型列表自动拉取；启用后对候选做复核补全，并可注入项目上下文目录扫描出的技术栈/规模信息
- **项目库持久化**：PERT 项目与估算项落库 SQLite，支持多项目管理
- **桌面应用**：Electron 壳 + PyInstaller sidecar，安装即用；前端图标库本地内联，离线/内网环境正常渲染
- **本地目录选择**：配置中心浏览目录走系统原生对话框，返回绝对路径自动填入

## 计算口径（与母版 Excel 公式对齐）

| 项 | 口径 |
|---|---|
| UFP | 估算功能点法：ILF=10 / EIF=7 / EI=4 / EO=5 / EQ=4（预估功能点法 ILF=35 / EIF=15） |
| US | UFP × 重用系数（低 1 / 中 2/3 / 高 1/3） × 修改系数（新增 1 / 修改 0.8 / 删除 0.2） |
| 工作量 | 调整后规模 × 中值生产率 10.67 人时/FP ÷ 8 × 调整因子 0.8（低/中/高 ±20%） |
| 费用 | 工作量 ÷ 22 人/月 × 2.57 万元/人月 |

内置金标准校验：引擎复算母版 US 合计必须等于 `105.07`（`python scripts/generate_xlsx.py --verify`）。

## 安装

### 桌面版（推荐）

从 `release/` 获取 `WorkloadEstimate-0.1.0-setup.exe`，双击安装后启动桌面应用（自动拉起本地引擎并打开界面）。

### 开发运行

依赖：Python 3.10+（需 `python-docx`、`openpyxl`）

```bash
# 方式一：启动脚本（引擎 8020 端口 + 自动打开前端）
scripts\启动服务.bat

# 方式二：手动启动
python scripts/server.py 8020
# 浏览器访问 http://127.0.0.1:8020
```

## 快速开始

1. 打开 **IFPUG 估算** 页，拖入需求说明书（`.docx`）
2. 在 **审核功能点** 步骤确认/调整每条候选的类别、复杂度、重用与修改类型
3. 点击 **生成成品造价表**，下载成品 xlsx（含规模估算、费用估算与汇总）
4. 如需 AI 识别增强，先到 **配置中心** 填写 API 地址与 Key 并启用

## 构建

```bat
rem 一条命令跑完全流程（0 清空 release -> 1 停占用 -> 2 依赖校验 -> 3 金标准
rem -> 4 源码 zip -> 5 sidecar exe -> 6 桌面安装包）
scripts\构建打包.bat

rem 只清空发布目录（产物均可重建，可随时清理）
scripts\清理发布目录.bat

rem 保留现有产物、跳过清理再构建
set SKIP_CLEAN=1 && scripts\构建打包.bat
```

产物固定落在 `release/`：`workload-estimate.zip`、`exe\工作量评估工具.exe`、`WorkloadEstimate-0.1.0-setup.exe`。
electron-builder 的中间产物（`win-unpacked\resources\app.asar`）输出到系统临时目录 `%TEMP%\we-eb-out`，
构建完成后只把 `setup.exe` 移回 `release` —— 避免 asar 落进工作区后被 IDE/索引进程独占打开，
导致 `release` 整个目录删不掉、改不了名。

> 清理失败时的排查：脚本会自动列出删不掉的文件与占用进程
> （`python scripts\_rm_locks.py release`）。历史遗留的 `release\*\win-unpacked\resources\app.asar`
> 若被 WorkBuddy.exe 索引句柄占住（err=32），需要**重启 WorkBuddy 后**再跑一次清理脚本。

## 目录结构

```
├── frontend/index.html      # 单文件前端（含本地内联图标库，无 CDN 依赖）
├── scripts/
│   ├── server.py            # 本地引擎：stdlib http.server，REST API + 前端托管
│   ├── engine.py            # IFPUG 规则引擎（US/汇总口径）
│   ├── generate_xlsx.py     # 母版保真生成器（写明细、保公式、Excel 重算）
│   ├── pert.py              # PERT 库与成品表生成
│   └── replay_recognize.py  # 功能点类型/修改类型识别规则
├── tpl/template.xlsx        # 成品母版（公式/样式保真基座）
├── data/                    # 运行数据（上传件、生成物、pert.db、config.json）
├── dev-shell/               # Electron 壳（main.js 拉起 sidecar 并托管窗口）
├── assets/                  # 应用图标
├── scripts\构建打包.bat      # 一键构建（先清 release，再 zip / exe / 安装包）
├── scripts\清理发布目录.bat  # 清空 release（可随时执行，产物可重建）
└── release/                 # 构建产物（zip、sidecar exe、安装包），可随时清理
```

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/recognize` | 上传需求 docx(base64) → 候选功能点清单 |
| POST | `/api/generate` | 候选清单 + 参数 → 成品 xlsx（返回下载句柄） |
| GET | `/api/download?s=` | 下载生成的成品表 |
| POST | `/api/config` | 配置中心读写（LLM 预设/上下文目录） |
| POST | `/api/pert/*` | PERT 项目/估算项/导入/生成 |
| POST | `/api/pickdir` | 系统原生目录选择，返回绝对路径 |

## 设计文档

- `概要设计说明.md` — 总体架构、模块划分、接口定义、计算口径
- `工作量估算双模式设计-概要设计.md` / `工作量估算双模式设计-估算方案.md` — IFPUG + PERT 双模式设计
- `工作量评估自动化实现方案.md` — 自动化实现路径

## 许可证

内部工具，未随附开源许可证。
