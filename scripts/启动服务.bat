
@echo off
chcp 936 >nul 2>&1
REM 工作量评估工具启动脚本：引擎(8020) + 打开前端
REM 脚本位于 scripts/ ，此处回退到项目根目录
cd /d "%~dp0.."
setlocal enabledelayedexpansion

set "ENGINE_PORT=8020"

echo ========================================
echo   正在启动工作量评估引擎...
echo ========================================

REM [1/7] 清理残留进程：PID 文件优先，端口扫描兜底，精准清理重复启动
echo [1/7] 清理残留进程...
if not exist "logs" mkdir logs
if exist "logs\engine.pid" (
    for /f "tokens=*" %%a in (logs\engine.pid) do (
        taskkill /F /T /PID %%a >nul 2>&1
    )
    del "logs\engine.pid" >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%ENGINE_PORT%.*LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)
REM 精准清理异常残留的本引擎 python 进程（仅匹配命令行含 server.py 者，不影响其它 python）
for /f "tokens=2 delims=," %%p in ('wmic process where "name='python.exe' and CommandLine like '%%server.py%%'" get ProcessId /format:csv 2^>nul ^| findstr /r "[0-9]"') do (
    taskkill /F /T /PID %%p >nul 2>&1
)

REM 等待端口释放，最多 5 秒
set /a portWait=0
:wait_port_release
netstat -aon | findstr ":%ENGINE_PORT%.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    set /a portWait+=1
    if !portWait! lss 5 (
        timeout /t 1 >nul 2>&1
        goto wait_port_release
    )
    echo [WARN] 端口 %ENGINE_PORT% 仍被占用，引擎可能启动失败
)
timeout /t 1 >nul 2>&1

REM [2/7] 校验依赖
echo [2/7] 校验依赖...
python -c "import openpyxl, docx" >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] 缺少依赖，请先执行: pip install openpyxl python-docx
    pause
    exit /b 1
)
echo   [OK] 依赖已就绪

REM [3/7] 后台启动引擎（隐藏窗口，日志写入 logs\engine.log）
echo [3/7] 启动引擎...
wscript scripts\runhidden.vbs "cmd /c cd /d ""%~dp0.."" && python scripts\server.py 8020 >""%~dp0..\logs\engine.log"" 2>&1"

REM [4/7] 等待引擎监听并记录 PID
echo [4/7] 等待引擎就绪...
set /a tries=0
:wait_engine
set /a tries+=1
timeout /t 1 /nobreak >nul 2>&1
netstat -aon | findstr ":%ENGINE_PORT%.*LISTENING" >nul 2>&1
if errorlevel 1 (
    if !tries! lss 60 (
        echo   等待引擎... !tries!/60
        goto wait_engine
    )
    echo [ERROR] 引擎 60 秒未启动成功
    echo   请查看 logs\engine.log 中的错误信息
    pause
    exit /b 1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%ENGINE_PORT%.*LISTENING"') do (
    echo %%a> "logs\engine.pid"
)
echo   [OK] 引擎已监听 %ENGINE_PORT% 端口

REM [5/7] 验证引擎健康
echo [5/7] 验证引擎健康...
curl -s -o nul http://127.0.0.1:%ENGINE_PORT%/health
if errorlevel 1 (
    echo   [WARN] 引擎健康检查未通过，请查看日志
) else (
    echo   [OK] 引擎健康检查通过
)

REM [6/7] 打开前端页面
echo [6/7] 打开前端页面...
start "" "%~dp0..\frontend\index.html"

REM [7/7] 完成提示
echo.
echo ========================================
echo   工作量评估引擎已启动（后台运行）
echo ========================================
echo   引擎 API : http://127.0.0.1:%ENGINE_PORT%/health
echo   前端页面 : frontend\index.html（已自动打开）
echo   引擎日志 : logs\engine.log
echo.
echo   停止服务请双击 scripts\停止服务.bat
echo ========================================
echo.
pause >nul
exit /b 0
