# Prompt Spark（提示词强化）· VS Code / Cursor 扩展

把「提示词强化」做成编辑器里的真按钮：底部面板输入草稿 → 一键强化 → 复制或插入编辑器；也可以用命令/快捷键直接强化当前选中的文本。

扩展本身不调用模型，只作为薄客户端调用本仓库的 **本地强化服务**（`desktop/server.mjs` 的 `POST /api/enhance`）。模型与 prompt 逻辑只在仓库里维护一份。

---

## 前置条件（必须先启动本地服务）

在仓库根目录（`D:\插件\dsh-prompt-enhancer-plus`）运行：

```bash
npm run desktop
```

服务只监听 `127.0.0.1`，启动后会在以下位置写入会话发现文件 `session.json`（包含 `origin` 与 `token`）：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\prompt-enhancer-plus-local\session.json` |
| macOS | `~/Library/Application Support/prompt-enhancer-plus-local/session.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/prompt-enhancer-plus-local/session.json` |

> 扩展每次调用都会重新读取该文件，所以本地服务重启（token 轮换）后无需重载扩展。
> 服务未启动时会提示：**请先运行 `npm run desktop` 启动本地服务**。

---

## 安装 / 侧载

### 方式一：打包 VSIX（推荐）

```bash
cd vscode-extension
npx @vscode/vsce package
```

得到 `prompt-spark-vscode-1.0.0.vsix` 后：

- VS Code：命令面板 → `Extensions: Install from VSIX...` → 选择该文件；或
  ```bash
  code --install-extension prompt-spark-vscode-1.0.0.vsix
  ```
- Cursor：命令面板 → `Extensions: Install from VSIX...` → 选择该文件；或
  ```bash
  cursor --install-extension prompt-spark-vscode-1.0.0.vsix
  ```

### 方式二：复制目录（免打包）

把整个 `vscode-extension` 目录复制为扩展目录：

- Windows：`%USERPROFILE%\.vscode\extensions\prompt-spark-vscode-1.0.0`
- macOS / Linux：`~/.vscode/extensions/prompt-spark-vscode-1.0.0`

然后重启编辑器。

### 开发调试

用 VS Code 打开 `vscode-extension` 目录，按 `F5` 启动 Extension Development Host。

---

## Cursor 兼容性

- Cursor 基于 VS Code，扩展 API 与 `package.json` 贡献点（commands / keybindings / viewsContainers.panel / views）完全兼容；**同一份 VSIX 可直接侧载**，不需要单独构建。
- `engines.vscode` 为 `^1.80.0`，覆盖 Cursor 常见的 VS Code 内核版本。
- 扩展只用标准 VS Code API（`window.registerWebviewViewProvider`、`commands.registerCommand`、`WorkspaceEdit`、`env.clipboard` 等），不依赖 VS Code 专有或 Cursor 私有 API，因此两端行为一致。
- 限制：Cursor 的 AI Chat 面板是私有的，无法把按钮注入其输入框；请使用本扩展的底部面板，或先用快捷键强化文本再粘贴到 Cursor Chat。

---

## 命令与快捷键

| 命令 | 标题 | 快捷键 |
| --- | --- | --- |
| `promptSpark.enhanceSelection` | 强化选中文本 | `Ctrl+Alt+E`（macOS：`Cmd+Alt+E`） |
| `promptSpark.enhanceInput` | 输入并强化（弹输入框，结果插入光标处） | — |
| `promptSpark.openPanel` | 打开提示词强化面板 | — |

另外，在编辑器右键菜单中选中文字后也有「强化选中文本」。

### 底部面板

命令面板执行 `Prompt Spark: 打开提示词强化面板`，或点击底部 Panel 中的「提示词强化」视图：

1. 输入/粘贴提示词草稿；
2. 选择「详细度」（简洁 / 标准 / 详细）与「方式」（通用 / 系统提示 / 任务 / 精简）；
3. 点「✨ 强化」；
4. 结果可「复制」或「插入编辑器」（插入到当前光标处）。

> 面板里的请求通过 `webview.postMessage` 交给扩展主进程，再由主进程请求本地服务。**webview 内不会直接 fetch 本地服务**——本地服务有 Origin/CSP 校验，跨源会被拦截。

---

## 限制

- 必须保持 `npm run desktop` 的终端窗口运行；服务关闭后扩展会请求失败并提示。
- 这是独立扩展：无法给 Copilot / Cursor Chat 等**其它扩展的输入框**注入按钮（VS Code Chat API 不支持任意 UI 注入）。
- 本地服务强制校验 `Host` / `Origin` / `Authorization`；扩展只连接回环地址（`127.0.0.1` / `localhost`），不会把 token 发往远端。
- `Ctrl+Alt+E` 可能与其它扩展/输入法冲突；可在 VS Code「键盘快捷方式」里搜索 `promptSpark.enhanceSelection` 改键。
- 强化质量与长度取决于本地服务配置的模型与 `level` 档位；超时时间为 90 秒。

---

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 提示「请先运行 npm run desktop 启动本地服务」 | 在仓库根目录运行 `npm run desktop`，保持终端不关 |
| 提示「未找到本地服务会话文件」 | 确认 `session.json` 位于上表对应目录；本地服务需已成功启动 |
| 提示「本机会话凭据无效」 | 本地服务已重启，token 已轮换；扩展会重新读取，若仍失败请重启编辑器窗口 |
| 请求超时 | 检查网络/模型配置，或缩短输入；服务端为单请求串行，勿并发 |
