# Prompt Spark 全局热键工具（Windows）

在**任意 Windows 应用**（Claude Code 桌面版、ChatGPT 桌面版、浏览器、IDE、聊天软件等）的输入框中选中文字，按 `Ctrl+Alt+E`，即可调用本机的提示词强化服务：

```
选中文字 → 模拟 Ctrl+C → 调用本地 /api/enhance → 结果写回剪贴板 → 托盘气泡提示
```

然后回到输入框按 `Ctrl+V` 粘贴。**本工具不会自动粘贴**（避免误发送、覆盖内容或触发不可撤销的操作）。

> **仅支持 Windows 10/11 + PowerShell 7 + Node.js 18+。** macOS/Linux 用户请直接使用 `node cli/enhance.mjs` 配合系统快捷键。

---

## 前置条件

1. **Node.js 18+**：`node --version` 能输出版本号。
2. **PowerShell 7（pwsh）**：`pwsh --version` 能输出版本号。Windows 自带的 `powershell.exe` 5.1 不受支持，请安装 [PowerShell 7](https://aka.ms/powershell)。
3. **本机强化服务已启动**：在项目根目录运行 `npm run desktop`，并保持窗口开启。
   服务启动后会生成发现文件：
   `%APPDATA%\prompt-enhancer-plus-local\session.json`
   其中包含 `{ origin, token, pid, version, startedAt }`，CLI/热键工具靠它找到本地服务。
4. **项目依赖已安装**：在项目根目录执行过 `npm install`。

---

## 启动

双击 `start-hotkey.cmd`，或在 PowerShell 7 中执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -Sta -File .\hotkey-tool\prompt-spark-hotkey.ps1
```

可选参数（直接传给 `start-hotkey.cmd` 或 `.ps1`）：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-Hotkey` | `Ctrl+Alt+E` | 热键组合，如 `Ctrl+Alt+Shift+E`、`Ctrl+Win+E` |
| `-Level` | `standard` | 强化详细度：`concise` / `standard` / `detailed` |
| `-Session` | `%APPDATA%\prompt-enhancer-plus-local\session.json` | 自定义发现文件路径 |
| `-TimeoutMs` | `90000` | CLI 请求超时（毫秒） |

示例：

```bat
start-hotkey.cmd -Hotkey "Ctrl+Alt+Shift+E" -Level detailed
```

---

## 使用

1. 确保 `npm run desktop` 正在另一个窗口运行。
2. 双击 `start-hotkey.cmd` 启动热键工具，看到“热键：Ctrl+Alt+E”即注册成功；窗口可最小化，但不要关闭。
3. 在任意应用输入框中**选中要强化的文字**。
4. 按 `Ctrl+Alt+E`：
   - 脚本先向当前前台窗口发送 `Ctrl+C` 复制选中内容；
   - 若选中内容为空，则使用当前剪贴板中的现有文本；
   - 调用 `node cli/enhance.mjs` 请求本机 `/api/enhance`；
   - 成功后把强化结果写回剪贴板，并弹出托盘气泡：**“已强化，已复制，请 Ctrl+V 粘贴”**。
5. 回到目标输入框，按 `Ctrl+V` 粘贴。

> ⚠️ 不会自动粘贴。是否粘贴、粘贴到哪里，完全由你决定。

退出方式：

- 在热键工具的控制台按 `Ctrl+C`；
- 或右键任务栏托盘区的图标，选择“退出”。

退出时会注销全局热键并清理托盘图标。

---

## 热键冲突处理

`RegisterHotKey` 返回 Win32 错误码 **1409** 表示该热键已被其它程序注册。此时脚本会提示：

> 热键 Ctrl+Alt+E 已被其它程序占用。请换一个组合……

处理方式：

1. 换一个组合后重新启动，例如：
   ```bat
   start-hotkey.cmd -Hotkey "Ctrl+Alt+Shift+E"
   ```
2. 常见占用全局热键的软件：PowerToys、输入法、QQ/微信、截图工具、IDE、显卡驱动面板等。可先退出对应软件或改其快捷键。
3. 热键格式：至少一个修饰键（`Ctrl` / `Alt` / `Shift` / `Win`）+ 一个主键（`A`-`Z`、`0`-`9`、`F1`-`F24`、`Space` 等）。

---

## 局限与注意事项

- **仅 Windows**：实现依赖 `user32.dll` 的 `RegisterHotKey`、WinForms 托盘图标和 `clip.exe`。
- **不自动粘贴**：只写剪贴板并提示，避免误操作。
- **管理员权限窗口**：Windows 的 UIPI 限制会阻止普通权限进程向管理员权限窗口发送 `SendKeys`。如果目标应用以管理员身份运行，请同样以管理员身份运行本工具（右键 `start-hotkey.cmd` → 以管理员身份运行）。
- **部分应用不响应 SendKeys**：游戏、远程桌面、部分安全软件屏蔽模拟按键时，可先手动 `Ctrl+C` 复制文字，再按热键（脚本检测到空选区时会直接使用剪贴板现有内容）。
- **托盘气泡**：依赖 Windows 通知设置；若看不到气泡，请查看热键工具控制台输出。
- **安全**：`session.json` 含本机服务随机 token，只用于 `127.0.0.1` 本地请求；请勿把该文件分享给他人。CLI 也会拒绝非本机 origin，避免 token 被发送到外部地址。
- **模型耗时**：强化请求由模型服务完成，可能需要数秒到数十秒；默认超时 90 秒，可用 `-TimeoutMs` 调整。

---

## 故障排查

| 现象 | 处理 |
|---|---|
| 提示“未找到本地服务，请先运行 npm run desktop” | 先启动 `npm run desktop`；确认 `%APPDATA%\prompt-enhancer-plus-local\session.json` 存在 |
| 提示“未找到 node” | 安装 Node.js 18+ 并加入 `PATH`，重新打开终端/资源管理器 |
| 按热键无反应 | 查看控制台报错；确认热键未被其它软件占用（换 `-Hotkey` 组合）；确认脚本窗口仍在运行 |
| 提示热键被占用（1409） | 按上一节换组合 |
| 双击 `start-hotkey.cmd` 一闪而过 | 在 PowerShell 中手动运行脚本查看错误；确认已安装 PowerShell 7 |
| 剪贴板内容没有变化 | 目标应用可能禁止模拟复制；先手动复制文字再按热键 |
| 托盘气泡不显示 | 检查系统通知设置；控制台仍会输出结果提示 |

---

## 文件说明

| 文件 | 说明 |
|---|---|
| `prompt-spark-hotkey.ps1` | PowerShell 7 热键主程序（注册热键、复制、调用 CLI、写剪贴板、托盘提示） |
| `start-hotkey.cmd` | 启动脚本（`pwsh -NoProfile -Sta -ExecutionPolicy Bypass -File`） |
| `test-cli.mjs` | CLI 自动化测试：临时假 HTTP 服务 + 临时 `session.json`，直接 import `cli/client.mjs` 验证请求头/请求体/错误处理 |
| `../cli/enhance.mjs` | 通用 CLI 主程序（`--text`/stdin、`--level`、`--mode`、`--format`、`--context-file`、`--copy`、`--json`、`--timeout`） |
| `../cli/client.mjs` | 可复用客户端逻辑：`resolveSessionPath` / `readSession` / `requestEnhance` / `copyToClipboard` |

### CLI 单独使用示例

```powershell
# 直接传文本
node cli/enhance.mjs --text "帮我写一份周报" --level detailed

# 从剪贴板/管道读取，并把结果复制回剪贴板
Get-Clipboard | node cli/enhance.mjs --copy

# 输出完整 JSON（含 usage / elapsedMs），适合脚本处理
node cli/enhance.mjs --text "..." --json

# 附带项目上下文文件
node cli/enhance.mjs --text "..." --context-file AGENTS.md
```

运行测试：

```powershell
node hotkey-tool/test-cli.mjs
```
