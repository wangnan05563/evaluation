
@echo off
chcp 936 >nul 2>&1
REM 工作量评估工具构建打包：停止占用 -> 依赖校验 -> 金标准校验 -> 打 zip 发布包
cd /d "%~dp0.."
setlocal enabledelayedexpansion

set "ENGINE_PORT=8020"
if defined WE_PYTHON (set "PY_EXE=%WE_PYTHON%") else (set "PY_EXE=python")
set "ZIP_DIR=release"
set "ZIP_NAME=workload-estimate"
set "ZIP_PATH=%ZIP_DIR%\%ZIP_NAME%.zip"

echo ========================================
echo   正在构建打包工作量评估工具...
echo ========================================

REM [0] Generate unique build version YYYYMMDD-NNN, write back to root package.json
echo [0/6] Generate unique build version...
%PY_EXE% scripts\bump_version.py
if errorlevel 1 (
    echo   [WARN] version bump failed, keep current version
)

REM [0/6] 清空发布目录（产物均可重建；设置 SKIP_CLEAN=1 可跳过）
if not "%SKIP_CLEAN%"=="1" (
    echo [0/6] 清空 release...
    call "scripts\清理发布目录.bat" -NoPause
)

REM [1/5] 停止占用（PID + 端口 + 命令行签名）
echo [1/6] 停止引擎占用...
if exist "logs\engine.pid" (
    for /f "tokens=*" %%a in (logs\engine.pid) do (
        taskkill /F /T /PID %%a >nul 2>&1
    )
    del "logs\engine.pid" >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%ENGINE_PORT%.*LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)
for /f "tokens=2 delims=," %%p in ('wmic process where "name='python.exe' and CommandLine like '%%server.py%%'" get ProcessId /format:csv 2^>nul ^| findstr /r "[0-9]"') do (
    taskkill /F /T /PID %%p >nul 2>&1
)
rem 桌面壳进程会持有 release\**\resources\app.asar 句柄，导致 electron-builder 报 EBUSY
taskkill /F /T /IM "工作量评估工具.exe" >nul 2>&1
taskkill /F /T /IM "electron.exe" >nul 2>&1
timeout /t 1 >nul 2>&1

REM [2/5] 依赖校验
echo [2/6] 校验依赖...
"%PY_EXE%" -c "import openpyxl, docx" >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] 缺少依赖，请先执行: pip install openpyxl python-docx
    echo   [HINT] 当前生效的 python 解释器:
    where python
    echo   [HINT] 多 Python 环境可用 WE_PYTHON 指定，例如: set WE_PYTHON=C:\Python313\python.exe
    pause
    exit /b 1
)
echo   [OK] 依赖已就绪

REM [3/5] 金标准校验（引擎复算母版 US=105.07，失败即中止）
echo [3/6] 运行金标准校验...
"%PY_EXE%" scripts\generate_xlsx.py --verify
if errorlevel 1 (
    echo   [ERROR] 金标准校验未通过，构建中止
    pause
    exit /b 1
)
echo   [OK] 金标准校验通过

REM [4/5] 打 zip 发布包
echo [4/6] 打包发布包...
if not exist "%ZIP_DIR%" mkdir "%ZIP_DIR%"
if exist "%ZIP_PATH%" del "%ZIP_PATH%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'scripts','frontend' -DestinationPath '%ZIP_PATH%' -Force"
if errorlevel 1 (
    echo   [ERROR] 打包失败
    pause
    exit /b 1
)
for %%f in ("%ZIP_PATH%") do set "ZIP_SIZE=%%~zf"
echo   [OK] 已生成 %ZIP_PATH% （%ZIP_SIZE% 字节）

REM [5/6] 打包可执行 exe（需 PyInstaller；未装则跳过并提示）
echo [5/6] 打包可执行 exe...
"%PY_EXE%" -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo   [WARN] 未检测到 PyInstaller，跳过 exe 打包。安装命令: pip install pyinstaller
    set "EXE_EXISTS=0"
) else (
    if not exist "%ZIP_DIR%\exe" mkdir "%ZIP_DIR%\exe"
    REM spec 必须位于项目根：PyInstaller 以 spec 所在目录为基准解析 ['scripts/server.py']
    REM 等相对路径，而 spec 里的路径是相对项目根写的。docs\ 下那份仅作归档。
    if not exist "工作量评估工具.spec" (
        echo   [ERROR] 缺少 spec 文件: %CD%\工作量评估工具.spec
        echo          源文件应位于 docs\工作量评估工具.spec
        pause
        exit /b 1
    )
    if not exist "build" mkdir "build"
    REM 不再 >nul 2>&1：失败时输出是唯一排查线索，必须留痕
    "%PY_EXE%" -m PyInstaller "工作量评估工具.spec" --distpath "%ZIP_DIR%\exe" --workpath "build" --noconfirm > "build\pyinstaller.log" 2>&1
    if errorlevel 1 (
        echo   [ERROR] exe 打包失败，详见 build\pyinstaller.log
        echo   ------ PyInstaller 输出末尾 20 行 ------
        powershell -NoProfile -Command "Get-Content -Encoding UTF8 'build\pyinstaller.log' -Tail 20"
        echo   ------------------------------------------
        pause
        exit /b 1
    )
    if exist "%ZIP_DIR%\exe\工作量评估工具.exe" (
        echo   [OK] 已生成 %ZIP_DIR%\exe\工作量评估工具.exe
        set "EXE_EXISTS=1"
    )
)

REM [7/7] Build desktop shell installer (electron-builder, NSIS)
echo [6/6] 打包桌面安装包 (electron-builder / NSIS)...
set "NODE_EXE="
where node >nul 2>&1
if not errorlevel 1 (
    set "NODE_EXE=node"
)
if not defined NODE_EXE (
    for %%c in (
        "%ProgramFiles%\nodejs\node.exe"
        "%ProgramFiles(x86)%\nodejs\node.exe"
        "%LOCALAPPDATA%\Programs\nodejs\node.exe"
        "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
        "%USERPROFILE%\AppData\Roaming\nvm\current\node.exe"
    ) do (
        if not defined NODE_EXE (
            if exist %%~c set "NODE_EXE=%%~c"
        )
    )
)
if not defined NODE_EXE (
    echo   [WARN] node not found in PATH, skip installer build
    goto :done_summary
)
echo   [OK] node: !NODE_EXE!
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
rem sidecar must exist: electron-builder silently skips missing extraResources,
rem which yields an installer without the engine
if not exist "%ZIP_DIR%\exe\工作量评估工具.exe" (
    echo   [ERROR] sidecar %ZIP_DIR%\exe\工作量评估工具.exe missing, re-run PyInstaller step first
    goto :done_summary
)
rem electron-builder 的真实产物路径是 <output>\win-unpacked\resources\app.asar；
rem 上一轮残留被占用时会 EBUSY: unlink app.asar，故先把旧 win-unpacked 整体移开再构建。
rem 中间产物（win-unpacked\resources\app.asar）会被 IDE / 索引进程独占打开，
rem 一旦落进 release 就会导致整个 release 目录删不掉、改不了名。
rem 因此输出到系统临时目录，构建成功后只把 setup.exe 移回 release。
set "EB_TMP=%TEMP%\we-eb-out"
if exist "%EB_TMP%" rd /s /q "%EB_TMP%" >nul 2>&1
if not exist "%EB_TMP%" mkdir "%EB_TMP%"
"!NODE_EXE!" node_modules\electron-builder\cli.js --win nsis -c.directories.output=%EB_TMP%
if errorlevel 1 (
    echo   [WARN] electron-builder failed, see output above
    goto :done_summary
)
set "SETUP_BUILT=0"
set "SETUP_SRC="
rem T00630: version is date-seq (changes every build), locate setup.exe by wildcard
for %%f in ("%EB_TMP%\WorkloadEstimate-*-setup.exe") do set "SETUP_SRC=%%~ff"
if defined SETUP_SRC move /Y "%SETUP_SRC%" "%ZIP_DIR%\" >nul 2>&1
set "SETUP_DST="
for %%f in ("%ZIP_DIR%\WorkloadEstimate-*-setup.exe") do set "SETUP_DST=%%~ff"
if defined SETUP_DST (
    echo   [OK] installer: !SETUP_DST!
    set "SETUP_BUILT=1"
) else (
    echo   [WARN] installer not generated, see electron-builder output above
)
if exist "%EB_TMP%" rd /s /q "%EB_TMP%" >nul 2>&1
:done_summary

REM 完成
echo.
echo ========================================
echo   构建打包完成
echo ========================================
echo   源码压缩包 : %ZIP_PATH%
echo   注: release 下仅保留最终产物，可用 scripts\清理发布目录.bat 随时清空
if "!EXE_EXISTS!"=="1" echo   可执行版exe  : %ZIP_DIR%\exe\工作量评估工具.exe
if "!SETUP_BUILT!"=="1" echo   桌面安装包  : !SETUP_DST!
echo.
pause >nul
exit /b 0
