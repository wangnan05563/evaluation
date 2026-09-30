# -*- coding: utf-8 -*-
# 生成 scripts\清理发布目录.bat（GBK + CRLF，cmd 可正确解析）
import io

BAT = r'''@echo off
chcp 936 >nul 2>&1
REM 清理 release 发布目录：结束占用 -> 删除 release -> 重建空目录
REM release 下所有内容均由 构建打包.bat 重新生成，可随时清理
REM 用法: scripts\清理发布目录.bat [-NoPause]
cd /d "%~dp0.."
setlocal enabledelayedexpansion

set "PY_EXE=python"
if defined WE_PYTHON set "PY_EXE=%WE_PYTHON%"

echo ========================================
echo   清理 release 发布目录
echo ========================================

echo [1/3] 结束占用进程...
taskkill /F /T /IM "工作量评估工具.exe" >nul 2>&1
taskkill /F /T /IM "electron.exe" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8020.*LISTENING"') do taskkill /F /T /PID %%a >nul 2>&1
timeout /t 1 >nul 2>&1
echo   [OK] 已结束引擎与桌面壳进程

echo [2/3] 删除 release 目录...
set "CLEAN_OK=1"
if exist "release" rd /s /q "release" >nul 2>&1
if exist "release" set "CLEAN_OK=0"
if "!CLEAN_OK!"=="1" goto :rebuild

echo   [WARN] release 删除不完整，正在定位占用进程...
"%PY_EXE%" "scripts\_rm_locks.py" "release" 2>nul
echo   [HINT] 结束上面列出的进程后重跑本脚本
goto :finish

:rebuild
if not exist "release" mkdir "release"
echo   [OK] release 已清空并重建

:finish
echo [3/3] 完成
if not "%1"=="-NoPause" pause >nul
exit /b 0
'''

P = r"D:\code\otherProjects\27_Evaluation\scripts\清理发布目录.bat"
data = BAT.replace("\n", "\r\n")
with io.open(P, "w", encoding="gbk", newline="") as f:
    f.write(data)
print("written:", P, len(data), "bytes")
