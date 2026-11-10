#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot 'runtime\overlay.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output 'Codex 悬浮按钮未运行。'; exit }
$overlayProcessId = [int](Get-Content -LiteralPath $pidPath)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $overlayProcessId"
$expectedScript = Join-Path $PSScriptRoot 'run.ps1'
if (-not $process) { Remove-Item -LiteralPath $pidPath; Write-Output '已清理过期运行标记。'; exit }
if ($process.Name -ne 'powershell.exe' -or -not $process.CommandLine.Contains($expectedScript)) {
  throw '运行标记与悬浮组件进程不一致，未结束任何进程。'
}
# The verified root is this adapter, not Codex or another application's host.
& (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $overlayProcessId /T /F
if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath $pidPath -ErrorAction SilentlyContinue }
