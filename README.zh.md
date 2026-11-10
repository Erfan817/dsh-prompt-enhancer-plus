# Prompt Spark · 提示词火花

本文件为中文摘要；完整安装、API 与开发说明请参阅 [`README.md`](README.md)。

## 纯中文版

### 为什么是 Prompt Spark

大多数提示词工具只是让提示词“读起来更顺”。Prompt Spark 追求的是**可执行**：结果既结构化到下游模型能稳定解析，又自然到人可以直接阅读。

一个核心，多个入口：DeepSeek Harness 的原生输入框按钮、兼容构建的 Claude Code 原生插件（输入区按钮、预览和回填）、Codex 的桌面编辑面板、VS Code / Cursor 的底部面板，以及任意软件的全局热键。不会自动发送强化结果。

### 功能亮点

- **机器可解析骨架**：输出 `Task:`、`Requirements:`、`Acceptance criteria:`、`Constraints:`，详细档再加 `Context:` / `Failure cases:`；纯文本，不是 Markdown 或 JSON。
- **三档详细度**：`简洁` 只润色，`标准` 适度补充结构（默认），`详细` 展开边界与验收标准。
- **项目感知（DSH）**：读取会话工作区里的 `AGENTS.md`、`CLAUDE.md`、`README.md`、`README.zh.md` 和 `package.json` 作为参考数据。
- **可复用人格**：保存产品、工程、写作、极简等“怎么改写”的方向。
- **可编辑预览**：替换草稿前可全文审阅和修改；提供五条最近记录与十秒撤销。
- **跨 harness**：DSH 原生按钮、Claude Code 原生插件（桌面版与终端）、Codex 桌面编辑面板、VS Code/Cursor 面板、Windows 全局热键和 CLI 共用规则。

### 快速开始

#### DSH

通过 DSH 插件管理器安装源码目录，然后重启 DSH。写下草稿，点击输入框工具栏的 **强化提示词**，审阅后选择 **替换草稿** 或 **复制**。

#### 从编辑中学习（仅 DSH）

首次强化 → 手动编辑预览或已替换的输入框 → 再次强化 → 推断可复用习惯 → 用户审阅并确认保存。建议可编辑，默认保存到当前工作目录对应的项目，也可选择会话或配置档全局；立即及以后适用的强化都会使用它。取消不保存；不保存继续则沿用已有方向。该功能不改变主助手，也不影响桌面伴侣等其他适配器。

所有不同方向均保守视为可能冲突，须明确保留或覆盖。同范围同键规则会被替换，跨范围规则保留，仅在新规则适用的上下文内覆盖；项目/会话覆盖不会删除其他上下文依赖的全局/项目记忆。删除覆盖规则可能恢复旧方向。面板详情中的「已保存偏好」显示生效与被覆盖状态并支持删除；工具可列出、删除，不能确认学习。

清空、发送、大幅替换草稿或打开历史记录会丢弃学习基线。连续性判断是启发式，不能保证区分所有新任务，请拒绝无关建议并检查敏感信息。基线和建议仅在主机内存保留约 30 分钟；工作目录改变或重启后需重新强化。推断会额外消耗模型 token。

#### 桌面伴侣

旧 VS Code/Cursor、CLI、热键及 `/enhance` 入口需要本机服务；DSH 和 Claude Code 原生插件不需要。保持终端运行；用窗口里的「退出」或 `Ctrl+C` 关闭。

```sh
npm install --ignore-scripts
npm run desktop
```

Windows 也可双击 `启动通用窗口.cmd`。服务只绑定随机 `127.0.0.1` 端口，并在 `%APPDATA%/prompt-enhancer-plus-local/session.json` 写入本机地址与随机令牌。

#### VS Code / Cursor

```sh
cd vscode-extension
npx @vscode/vsce package --allow-missing-repository
code --install-extension prompt-spark-vscode-1.0.0.vsix
cursor --install-extension prompt-spark-vscode-1.0.0.vsix
```

打开「提示词强化」底部面板输入草稿并点击「✨ 强化」。编辑器选中文字后按 `Ctrl+Alt+E` 可替换选区；macOS 使用 `Cmd+Alt+E`。

#### Claude Code

推荐原生 [`claude-code/native-plugin`](claude-code/native-plugin/README.md)：输入区上方按钮 → 可编辑预览 → 确认替换，不自动发送。使用宿主当前模型和凭据，不依赖桌面伴侣、HTTP 服务或额外 API Key，但仍消耗模型用量。桌面版会话可使用宿主插件安装流程；开发时也可在启动前设置 `CLAUDE_CODE_PLUGIN_DIRS` 指向插件目录并完整重启桌面应用。需要支持 function hooks 的构建，详见 [Claude Code 指南](claude-code/README.md)。

原生插件 0.2.0 增加本机文字编辑 Skill 的自动匹配/手选，以及「再次强化预览」。参考内容会发送给当前模型，不执行 Skill 脚本；失败或取消保留预览，原草稿变化后不可覆盖。

旧 `/enhance` 命令和可选 `UserPromptSubmit` hook 保留兼容，仍依赖本机服务；传统 hook 只能追加上下文，不能替换原文。

#### Codex

可安装的 [`codex/plugin`](codex/README.md) 提供桌面编辑面板和三档强化。打开本仓库项目并完整重启桌面应用，在 **Plugins / 插件 → Prompt Spark 本地来源** 安装，新建对话后输入“打开 Prompt Spark 提示词编辑面板”。需要 Node.js 22+，无需安装 Codex CLI、手动启动桌面伴侣或额外 API Key。

面板支持编辑草稿、三档选择、可编辑预览、再次强化、复制和放入输入框。点击强化会明确发送一次改写请求；放入输入框只追加结果，不发送、不覆盖已有草稿。支持指定项目资料和 Skill 参考，遵循当前对话的上下文和存储策略。实际桌面端到端验收范围见 [Codex 指南](codex/README.md)。

#### 任意软件（Windows）

运行 `hotkey-tool\start-hotkey.cmd`。选中文字后按 `Ctrl+Alt+E`，强化结果会写回剪贴板；工具不会自动粘贴。

#### CLI

```sh
echo "帮我做一个导出 CSV 的功能" | node cli/enhance.mjs --level detailed
node cli/enhance.mjs --text "..." --context-file AGENTS.md --copy
```

标准输出仅包含强化后的文本；`--json` 可输出完整结果对象。

### 三档输出

```text
简洁
Task: 做一个导出 CSV 的功能。
Requirements: 1. 可选择导出字段；2. 支持 UTF-8。

标准
Task: 做一个导出 CSV 的功能。
Requirements: 1. 可选择导出字段；2. 支持 UTF-8。
Acceptance criteria: 导出文件可在 Excel 中打开，字段与选择一致。
Constraints: 不修改现有数据结构。

详细
Task: 做一个导出 CSV 的功能。
Context: 现有系统已支持列表筛选，导出应复用筛选结果。
Requirements: 1. 可选择导出字段；2. 支持 UTF-8；3. 大数据量分批写入。
Acceptance criteria: 文件可在 Excel 中打开；字段与选择一致；10 万行内不超时。
Constraints: 不修改现有数据结构；不新增第三方依赖。
Failure cases: 无数据时导出空文件并提示；字段全不选时禁用导出。
```

标签固定用英文作为机器锚点，正文跟随用户语言；空小节省略；除非原文要求，否则不输出 JSON/YAML/XML；条目数量与原请求成比例。

### 本机 API

`npm run desktop` 同时提供：

```text
POST /api/enhance   { text, mode?, level?, format?, personaId?, direction?, context? }
POST /api/health    → { ready: true, version }
```

每个 API 请求都需要 `session.json` 中的 Bearer 令牌、匹配的 `Origin` 与 `Host: 127.0.0.1:<port>`。服务不开放 CORS，也不监听局域网；`context` 上限 8000 字符，未知 `level` 回退 `standard`。

### 提示词强化速度

强化使用**当前 DSH 会话选择的 provider/model**，不静默切换供应商；辅助请求默认尝试模型支持的最低推理档（优先 `off`），超时为 30 秒。若仍超时，请检查当前路由额度、模型是否只返回 reasoning 而没有正文，以及推理强度是否过高。当前安装路由曾返回 WorkBuddy Credits exhausted（429）；这类额度错误需要在账户或模型路由侧处理，改写提示词本身不能解决。

### Skill 感知（DSH）

强化面板侧栏的「参考 Skill」默认开启，与项目感知独立。插件通过 DSH Skill 注册表读取当前会话与工作目录可见、允许模型调用的 Skill，按名称、描述和触发条件与草稿的关键词匹配；最多加载三个相关 Skill 正文，每个最多 6000 字符，总计最多 12000 字符。预览显示参考名称、来源和截断/不可用状态。没有匹配时沿用普通强化，不额外调用模型进行选择。

例如草稿提到 AI 漫剧或去 AI 味，已登记的 Skill 描述也包含相应词语时，会把相关方法作为改写参考。此版本是关键词匹配，不保证理解同义词；不会扫描任意下载目录，不会自动安装 Skill，也不会执行脚本或读取 Skill 引用的附属文件。Skill 内容会随本次强化请求发送至所选模型。桌面伴侣和其他适配器暂未接入 Skill 发现。更新已有 DSH 插件后需重启 DSH 并刷新页面。

### 项目感知

DSH Host 按顺序读取 `AGENTS.md`、`CLAUDE.md`、`README.md`、`README.zh.md`、`package.json`，作为“仅参考数据”写入 system 提示词，不写入用户任务消息。每文件最多 6000 字符、总计最多 8000 字符；文件缺失或不可读时静默跳过。

### 隐私与边界

- 不读取其他软件的输入框、剪贴板历史、凭据或登录信息。
- 只有用户明确触发强化时，草稿和方向才发送到配置的模型 API。
- 本机服务只监听回环地址，校验 `Host`、`Origin` 和随机令牌。
- VS Code 扩展不是 Marketplace 发布版，需本地构建 VSIX；Cursor AI Chat 是私有界面，不能注入按钮。
- Windows 热键工具要求 PowerShell 7，且不会自动粘贴。
- Claude Code hook 只能附加上下文，不能替换提交原文。
- 结构化输出由模型指令约束，不是确定性解析器，模型可能偶尔偏离。

### 开发与验证

```sh
npm install --ignore-scripts
npm test
npm run desktop:smoke
npm pack --dry-run
```

`npm test` 运行十四套无需 Electron、无需真实模型的测试：核心、Host、人格、偏好、Client、项目上下文与等级、桌面 UI、桌面服务 API 与安全、VS Code 客户端、CLI，以及 Codex 插件包、MCP 传输、模拟宿主面板交互和 Windows 悬浮组件状态。

### 许可证

MIT © Erfan817
