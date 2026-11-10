param(
  [Parameter(Mandatory=$true)][string]$TargetExecutable,
  [Parameter(Mandatory=$true)][string]$BackendExecutable,
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [switch]$Check, [switch]$Probe
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$refs = @('System.Windows.Forms','System.Drawing','System.Web.Extensions','System.Core',
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.AutomationIdentifier].Assembly.Location,
  [System.Windows.Rect].Assembly.Location)
$code = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Overlay.cs'), [Text.Encoding]::UTF8)
Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
if ($Check) { [PromptSpark.OverlayApp]::SelfTest(); exit }
if ($Probe) { [PromptSpark.OverlayApp]::Probe($TargetExecutable); exit }
[PromptSpark.OverlayApp]::Run($TargetExecutable,$BackendExecutable,$NodeExecutable,(Join-Path $PSScriptRoot 'enhance.mjs'),$runtimeDir)
