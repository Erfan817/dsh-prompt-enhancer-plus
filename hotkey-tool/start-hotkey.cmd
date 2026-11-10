@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where pwsh >nul 2>nul
if errorlevel 1 (
    echo 未找到 PowerShell 7（pwsh）。请先安装：https://aka.ms/powershell
    echo 安装后重新双击本文件。
    pause
    exit /b 1
)

echo 正在启动 Prompt Spark 全局热键工具...
echo 保持此窗口开启；按 Ctrl+C 或右键托盘图标选择“退出”可结束。
echo.
rem -Sta：单线程公寓启动，确保 SendKeys/剪贴板在 WinForms 消息循环下稳定。
pwsh -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0prompt-spark-hotkey.ps1" %*

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo 热键工具已退出（代码 %EXIT_CODE%）。
    pause
)
exit /b %EXIT_CODE%
