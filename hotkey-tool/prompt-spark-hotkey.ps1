#Requires -Version 7.0
<#
.SYNOPSIS
    Prompt Spark Windows 全局热键工具。
.DESCRIPTION
    在任意 Windows 应用中选中文字后按 Ctrl+Alt+E（可改），
    本脚本会复制选中内容、调用 node cli/enhance.mjs 强化、把结果写回剪贴板，
    并弹出托盘提示“已强化，已复制，请 Ctrl+V 粘贴”。不会自动粘贴。
.PARAMETER Hotkey
    热键组合，默认 Ctrl+Alt+E。至少包含 Ctrl/Alt/Shift/Win 之一 + 一个主键。
.PARAMETER Level
    强化详细度：concise / standard / detailed，默认 standard。
.PARAMETER Session
    自定义 session.json 路径；默认 %APPDATA%\prompt-enhancer-plus-local\session.json。
.PARAMETER TimeoutMs
    CLI 请求超时毫秒数，默认 90000。
.NOTES
    仅支持 Windows + PowerShell 7（pwsh）。
    前置条件：先在项目根目录运行 npm run desktop，并保持其窗口开启。
#>
[CmdletBinding()]
param(
    [string]$Hotkey = 'Ctrl+Alt+E',
    [ValidateSet('concise', 'standard', 'detailed')]
    [string]$Level = 'standard',
    [string]$Session = '',
    [int]$TimeoutMs = 90000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:NodePath = $null
$script:CliPath = $null
$script:HotkeyWindow = $null
$script:TrayIcon = $null
$script:AppContext = $null
$script:HotkeyId = 1
$script:Busy = $false
$script:Stopping = $false
$script:Registered = $false
$script:Session = $Session
$script:Level = $Level
$script:TimeoutMs = $TimeoutMs

function Get-SessionPath {
    if (-not [string]::IsNullOrWhiteSpace($script:Session)) {
        return $script:Session
    }
    $appData = $env:APPDATA
    if ([string]::IsNullOrWhiteSpace($appData)) {
        $appData = Join-Path $env:USERPROFILE 'AppData\Roaming'
    }
    return Join-Path $appData 'prompt-enhancer-plus-local\session.json'
}

function Show-Balloon {
    param(
        [string]$Title,
        [string]$Message,
        [string]$Icon = 'Info'
    )
    Write-Host "[$Title] $Message"
    if ($null -eq $script:TrayIcon) { return }
    try {
        $script:TrayIcon.BalloonTipTitle = $Title
        $script:TrayIcon.BalloonTipText = $Message
        $script:TrayIcon.BalloonTipIcon = [System.Enum]::Parse([System.Windows.Forms.ToolTipIcon], $Icon)
        $script:TrayIcon.ShowBalloonTip(3000)
    }
    catch {
        Write-Host "[提示] 托盘气泡显示失败：$($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

function Stop-HotkeyApp {
    if ($script:Stopping) { return }
    $script:Stopping = $true

    if ($null -ne $script:HotkeyWindow -and $script:Registered) {
        try { $script:HotkeyWindow.Unregister($script:HotkeyId) } catch { }
        $script:Registered = $false
    }
    if ($null -ne $script:HotkeyWindow) {
        try { $script:HotkeyWindow.Dispose() } catch { }
        $script:HotkeyWindow = $null
    }
    if ($null -ne $script:TrayIcon) {
        try {
            $script:TrayIcon.Visible = $false
            $script:TrayIcon.Dispose()
        }
        catch { }
        $script:TrayIcon = $null
    }
    if ($null -ne $script:AppContext) {
        try { $script:AppContext.ExitThread() } catch { }
    }
    try { [System.Windows.Forms.Application]::ExitThread() } catch { }
}

function ConvertTo-HotkeySpec {
    param([Parameter(Mandatory = $true)][string]$Spec)

    $parts = @($Spec -split '\+' | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($parts.Count -lt 2) {
        throw "热键格式应为 Ctrl+Alt+E 之类（至少一个修饰键 + 一个主键），当前：$Spec"
    }

    $modifiers = [uint32]0
    $virtualKey = $null
    foreach ($part in $parts) {
        switch -Regex ($part) {
            '^(?i:ctrl|control)$' { $modifiers = $modifiers -bor [uint32]0x0002; continue }
            '^(?i:alt)$' { $modifiers = $modifiers -bor [uint32]0x0001; continue }
            '^(?i:shift)$' { $modifiers = $modifiers -bor [uint32]0x0004; continue }
            '^(?i:win|windows|super|meta)$' { $modifiers = $modifiers -bor [uint32]0x0008; continue }
            default {
                if ($null -ne $virtualKey) { throw "热键只能包含一个主键，当前：$Spec" }
                $keyName = $part
                if ($keyName.Length -eq 1) { $keyName = $keyName.ToUpperInvariant() }
                try {
                    $candidate = [System.Windows.Forms.Keys]$keyName
                }
                catch {
                    throw "无法识别热键主键：$part"
                }
                $virtualKey = [uint32]$candidate
                if ($virtualKey -eq 0) { throw "无法识别热键主键：$part" }
            }
        }
    }
    if ($null -eq $virtualKey) { throw "热键缺少主键：$Spec" }
    if ($modifiers -eq 0) { throw "热键至少需要 Ctrl/Alt/Shift/Win 中一个修饰键：$Spec" }

    return [pscustomobject]@{
        Modifiers  = [uint32]$modifiers
        VirtualKey = [uint32]$virtualKey
    }
}

function Invoke-PromptEnhance {
    $sessionPath = Get-SessionPath
    if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) {
        Show-Balloon -Title '提示词强化' -Message '未找到本地服务，请先运行 npm run desktop' -Icon Warning
        Write-Host "[提示] 未找到会话文件：$sessionPath" -ForegroundColor Yellow
        return
    }
    if (-not (Test-Path -LiteralPath $script:CliPath -PathType Leaf)) {
        throw "找不到 CLI：$($script:CliPath)"
    }

    # 1) 记住现有剪贴板，作为无选区时的兜底。
    $previous = ''
    try { $previous = [string](Get-Clipboard -Raw -ErrorAction Stop) } catch { $previous = '' }

    # 2) 模拟 Ctrl+C 复制当前前台窗口的选中内容。
    try {
        [System.Windows.Forms.SendKeys]::SendWait('^c')
    }
    catch {
        Write-Host "[提示] 模拟 Ctrl+C 失败：$($_.Exception.Message)" -ForegroundColor Yellow
    }
    Start-Sleep -Milliseconds 180

    $selected = ''
    try { $selected = [string](Get-Clipboard -Raw -ErrorAction Stop) } catch { $selected = '' }
    if ([string]::IsNullOrWhiteSpace($selected)) { $selected = $previous }
    if ([string]::IsNullOrWhiteSpace($selected)) {
        Show-Balloon -Title '提示词强化' -Message '没有检测到选中文字，剪贴板也为空。' -Icon Warning
        return
    }

    # 3) 调用 CLI；stdout 是强化结果，stderr 是错误信息。
    Show-Balloon -Title '提示词强化' -Message '正在强化，请稍候…' -Icon Info
    $arguments = @(
        $script:CliPath,
        '--text', $selected,
        '--level', $script:Level,
        '--session', $sessionPath,
        '--timeout', [string]$script:TimeoutMs
    )
    $output = & $script:NodePath @arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $message = ($output | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($message)) { $message = "CLI 退出码 $exitCode" }
        throw $message
    }

    $enhanced = (($output | Out-String) -replace "(`r`n|`n|`r)+$", '')
    if ([string]::IsNullOrWhiteSpace($enhanced)) {
        throw 'CLI 没有返回强化结果。'
    }

    # 4) 只写剪贴板 + 气泡提示，不自动粘贴（避免误发）。
    Set-Clipboard -Value $enhanced
    Show-Balloon -Title '提示词强化' -Message '已强化，已复制，请 Ctrl+V 粘贴' -Icon Info
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
try {
    if (-not $IsWindows) {
        throw '本工具仅支持 Windows。'
    }

    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw '未找到 node。请先安装 Node.js 18+ 并加入 PATH。'
    }
    $script:NodePath = $nodeCommand.Source
    $script:CliPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'cli\enhance.mjs'
    if (-not (Test-Path -LiteralPath $script:CliPath -PathType Leaf)) {
        throw "找不到 CLI：$($script:CliPath)"
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PromptSpark
{
    public static class NativeMethods
    {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        public delegate bool ConsoleCtrlDelegate(uint ctrlType);

        [DllImport("kernel32.dll")]
        public static extern bool SetConsoleCtrlHandler(ConsoleCtrlDelegate handler, bool add);
    }

    public sealed class HotkeyEventArgs : EventArgs
    {
        public int Id { get; private set; }
        public HotkeyEventArgs(int id) { Id = id; }
    }

    public sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        public const int WM_HOTKEY = 0x0312;
        private bool disposed;

        public event EventHandler<HotkeyEventArgs> HotkeyPressed;

        public HotkeyWindow()
        {
            CreateParams parameters = new CreateParams();
            parameters.Caption = "PromptSparkHotkeyWindow";
            parameters.Parent = new IntPtr(-3); // HWND_MESSAGE：仅消息窗口
            CreateHandle(parameters);
        }

        public bool Register(int id, uint modifiers, uint virtualKey)
        {
            // MOD_NOREPEAT (0x4000) 避免按住热键时重复触发。
            return NativeMethods.RegisterHotKey(Handle, id, modifiers | 0x4000u, virtualKey);
        }

        public void Unregister(int id)
        {
            if (Handle != IntPtr.Zero)
            {
                NativeMethods.UnregisterHotKey(Handle, id);
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WM_HOTKEY)
            {
                EventHandler<HotkeyEventArgs> handler = HotkeyPressed;
                if (handler != null)
                {
                    handler(this, new HotkeyEventArgs(message.WParam.ToInt32()));
                }
                return;
            }
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            if (!disposed)
            {
                disposed = true;
                DestroyHandle();
            }
        }
    }

    public static class ConsoleQuitHook
    {
        private static NativeMethods.ConsoleCtrlDelegate handler;

        public static void Install(uint threadId)
        {
            handler = delegate(uint ctrlType)
            {
                if (ctrlType == 0u || ctrlType == 1u)
                {
                    // CTRL_C_EVENT / CTRL_BREAK_EVENT：向消息循环线程投递 WM_QUIT。
                    NativeMethods.PostThreadMessage(threadId, 0x0012u, IntPtr.Zero, IntPtr.Zero);
                    return true;
                }
                return false;
            };
            NativeMethods.SetConsoleCtrlHandler(handler, true);
        }
    }
}
'@

    $references = @(
        [System.Windows.Forms.Form].Assembly.Location,
        [System.Drawing.SystemIcons].Assembly.Location
    )
    Add-Type -TypeDefinition $nativeSource -ReferencedAssemblies $references -ErrorAction Stop

    $hotkeySpec = ConvertTo-HotkeySpec -Spec $Hotkey

    $script:HotkeyWindow = New-Object PromptSpark.HotkeyWindow
    if (-not $script:HotkeyWindow.Register($script:HotkeyId, $hotkeySpec.Modifiers, $hotkeySpec.VirtualKey)) {
        $win32Error = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($win32Error -eq 1409) {
            throw "热键 $Hotkey 已被其它程序占用。请换一个组合，例如：start-hotkey.cmd -Hotkey `"Ctrl+Alt+Shift+E`""
        }
        throw "注册热键 $Hotkey 失败（Win32 错误码：$win32Error）。"
    }
    $script:Registered = $true

    $script:HotkeyWindow.add_HotkeyPressed({
        param($sender, $eventArgs)
        if ($script:Busy -or $script:Stopping) { return }
        $script:Busy = $true
        try {
            Invoke-PromptEnhance
        }
        catch {
            Show-Balloon -Title '提示词强化失败' -Message $_.Exception.Message -Icon Error
        }
        finally {
            $script:Busy = $false
        }
    })

    $script:TrayIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:TrayIcon.Icon = [System.Drawing.SystemIcons]::Application
    $script:TrayIcon.Text = "提示词强化热键（$Hotkey）"
    $script:TrayIcon.Visible = $true
    $trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
    $exitItem = $trayMenu.Items.Add('退出')
    $exitItem.add_Click({ Stop-HotkeyApp })
    $script:TrayIcon.ContextMenuStrip = $trayMenu

    $script:AppContext = New-Object System.Windows.Forms.ApplicationContext
    [PromptSpark.ConsoleQuitHook]::Install([PromptSpark.NativeMethods]::GetCurrentThreadId())

    Write-Host ''
    Write-Host '提示词强化 · Windows 全局热键工具' -ForegroundColor Cyan
    Write-Host "热键：$Hotkey    详细度：$Level"
    Write-Host '在任意应用中选中文字后按热键；结果会写入剪贴板，请手动 Ctrl+V 粘贴。'
    Write-Host '本工具不会自动粘贴。退出：Ctrl+C，或右键托盘图标选择“退出”。'
    $sessionPath = Get-SessionPath
    if (Test-Path -LiteralPath $sessionPath -PathType Leaf) {
        Write-Host "本地服务会话文件：$sessionPath" -ForegroundColor Green
    }
    else {
        Write-Host "未找到本地服务会话文件：$sessionPath" -ForegroundColor Yellow
        Write-Host '请先在项目根目录运行 npm run desktop。' -ForegroundColor Yellow
    }
    Write-Host ''

    [System.Windows.Forms.Application]::Run($script:AppContext)
}
catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Stop-HotkeyApp
}
