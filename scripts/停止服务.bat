
@echo off
chcp 936 >nul 2>&1
REM 工作量评估工具停止脚本：PID 文件优先，端口扫描 + 命令行签名兜底
cd /d "%~dp0.."
setlocal enabledelayedexpansion

set "ENGINE_PORT=8020"

echo ========================================
echo   正在停止工作量评估引擎...
echo ========================================

set KILLED=0

REM [1/4] 通过 PID 文件停止
echo [1/4] 清理引擎进程...
if exist "logs\engine.pid" (
    for /f "tokens=*" %%a in (logs\engine.pid) do (
        taskkill /F /T /PID %%a >nul 2>&1
        if not errorlevel 1 (
            echo   [OK] 引擎进程已停止（PID %%a）
            set KILLED=1
        )
    )
    del "logs\engine.pid" >nul 2>&1
)

REM [2/4] 端口扫描兜底
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%ENGINE_PORT%.*LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
    if not errorlevel 1 (
        echo   [OK] 已通过端口 %ENGINE_PORT% 停止引擎
        set KILLED=1
    )
)

REM [3/4] 命令行签名精准停止（仅 ./server.py 的 python，不影响其它 python）
for /f "tokens=2 delims=," %%p in ('wmic process where "name='python.exe' and CommandLine like '%%server.py%%'" get ProcessId /format:csv 2^>nul ^| findstr /r "[0-9]"') do (
    taskkill /F /T /PID %%p >nul 2>&1
    if not errorlevel 1 (
        echo   [OK] 已按命令行签名停止引擎
        set KILLED=1
    )
)

if "!KILLED!"=="0" (
    echo   [SKIP] 未发现正在运行的引擎进程
)

timeout /t 1 >nul 2>&1

REM [4/4] 验证端口释放
echo [4/4] 验证端口释放...
set PORT_FREE=1
netstat -aon | findstr ":%ENGINE_PORT%.*LISTENING" >nul 2>&1
if not errorlevel 1 set PORT_FREE=0
if "!PORT_FREE!"=="1" (
    echo   [OK] 端口 %ENGINE_PORT% 已释放
) else (
    echo   [WARN] 端口仍被占用，可手动终止占用进程
)
echo.
echo ========================================
echo   工作量评估引擎已停止
echo ========================================
timeout /t 2 >nul 2>&1
exit /b 0
