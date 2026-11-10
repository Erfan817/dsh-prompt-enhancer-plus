#Requires -Version 7.0
[CmdletBinding()]
param([switch]$Check, [switch]$Probe)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
[void][IO.Directory]::CreateDirectory($runtimeDir)
$env:TEMP = $runtimeDir
$env:TMP = $runtimeDir
$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$runner = Join-Path $PSScriptRoot 'run.ps1'
# Model/window-independent checks also run on Windows CI without Codex installed.
if ($Check) {
  & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -Sta -File $runner -TargetExecutable $windowsPowerShell -BackendExecutable $windowsPowerShell -NodeExecutable (Get-Command node -ErrorAction Stop).Source -Check
  exit $LASTEXITCODE
}
$gui = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.Path -match '\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$'
} | Select-Object -First 1
if (-not $gui) { throw '请先打开 Codex 桌面应用。' }
$engine = Get-Process -Name codex -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -like "$env:LOCALAPPDATA\OpenAI\Codex\bin\*\codex.exe"
} | Select-Object -First 1 -ExpandProperty Path
if (-not $engine) { $engine = Join-Path (Split-Path $gui.Path) 'resources\codex.exe' }
if (-not (Test-Path -LiteralPath $engine)) { throw '未找到 Codex 桌面模型组件。' }
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-Sta','-File',$runner,
  '-TargetExecutable',$gui.Path,'-BackendExecutable',$engine,'-NodeExecutable',$nodeExe)
if ($Probe) { $arguments += '-Probe' }
if ($Probe) { & $windowsPowerShell @arguments; exit $LASTEXITCODE }
# Pass each argument quoted for Windows PowerShell's process command line; paths cannot contain quotes.
$quotedArguments = $arguments | ForEach-Object { '"' + $_ + '"' }
$child = Start-Process -FilePath $windowsPowerShell -ArgumentList $quotedArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Write-Output "Prompt Spark Codex 悬浮按钮已启动，进程 $($child.Id)。切回 Codex 后显示；右键按钮可退出。"
