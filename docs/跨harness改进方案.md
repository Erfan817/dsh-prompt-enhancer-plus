# 提示词强化 · 跨 Harness 改进方案（设计稿 v1）

> 状态：**已实施（v1.6.0）**。实际交付：`desktop` 的 `/api/enhance` + `/api/health` + 会话发现文件、`vscode-extension/`（VS Code/Cursor）、`cli/enhance.mjs`、`hotkey-tool/`（Windows 全局热键）、`.claude/commands/enhance.md` + `claude-code/hooks/`、以及 `prompt-core.js` 的三档语义骨架输出。
> 目标 harness：VS Code、Cursor、dsh、Claude Code 桌面版、ChatGPT 桌面版。
> 目标体验：像 dsh 那样，在“输入框下方 / 输入区附近”一键强化。
> 目标质量：强化结果“对 AI 更友好（结构化、机器可解析）但仍对人可读”。

---

## 一、结论先行

麻烦的根源是「每个 harness 各做一套 UI」。正确做法是**一套内核 + 每个 harness 一层薄壳**：

- 内核：`prompt-core.js`（`enhancementSystem` / `inputFor` / `normalizeEnhancedText` / `resolveLevel` / `resolveMode` / `resolveFormat`）——纯函数、无宿主依赖，已存在。
- 统一服务：把 `desktop/server.mjs` 的本地服务扩展成稳定接口 `/api/enhance`（`127.0.0.1`，已有 token/同源/CSP 安全机制）。
- 各 harness 只做三件事：**取当前草稿 → POST 本地服务 → 回写输入框**。模型调用与 prompt 逻辑只写一次。

```
             ┌───────────────────────────────────────────────┐
             │  本地强化服务  127.0.0.1 (desktop/server.mjs)   │
             │  POST /api/enhance                            │
             │  { text, mode, level, personaId, context }     │
             │  ← 复用 prompt-core，无 UI 依赖                │
             └───────────────▲───────────────────────────────┘
        HTTP (localhost)     │
   ┌──────────┬──────────────┼───────────────┬────────────────┐
   │ dsh 插件 │ VS Code / Cursor│ Claude Code  │ ChatGPT 桌面版  │
   │ (原生按钮)│ 扩展(面板按钮) │ 斜杠命令+hook │ 全局热键中介    │
   └──────────┴──────────────┴───────────────┴────────────────┘
```

**统一接口约定**（在现有 `/api/generate` 基础上补 `level` 与 `context`）：

```
POST /api/enhance
  request : { text: string, mode?: 'general|system|task|concise',
              level?: 'concise|standard|detailed',
              personaId?: string, context?: string }
  response: { enhanced: string, format: 'plain|markdown', level: string,
              usage?: object, elapsedMs: number }
```

---

## 二、各 harness 的真实接入点与局限

> 说明：接入点是基于已知扩展机制的判断；实装前应对照各家最新官方文档核对具体 API 名称。当前环境 web 搜索不可用，未能在线复核。

### 2.1 dsh —— 原生标杆（已实现）
- 接入点：`conversation.input.left` slot，把按钮放进 composer 工具栏，就是“输入框下方按钮”的形态。
- 现状：三档 `level` + 项目感知已跑通（v1.5.0）；本项目唯一能把按钮做进原生输入框的 harness（自有宿主）。
- 局限：无。

### 2.2 VS Code —— 独立扩展，真按钮（面板/webview 等效“输入框下方”）
- 接入点：
  - `contributes.commands` 注册命令；`contributes.menus` 挂到 `editor/context`（右键）或 `editor/title`（标题栏）。
  - 若要“输入框下方”形态：`WebviewViewProvider` 放底部 Panel 或侧栏，面板内 textarea + 「✨强化」按钮；结果可「插入编辑器 / 复制 / 替换选区」。
  - 或状态栏按钮 → `showInputBox` 取文本 → 强化 → 替换选区。
- 取草稿：`editor.selection.getText()` / 整篇文档 / webview 内 textarea。
- 局限：这是独立扩展；无法给“其它扩展（如 Copilot）的 chat 输入框”加按钮（VS Code Chat API 有限，不能任意注入按钮到别家 UI）。

### 2.3 Cursor —— 复用 VS Code 扩展
- 接入点：Cursor 基于 VS Code，扩展机制兼容；同一 `.vsix` 可直接侧载，命令可挂到 Cursor chat 上下文菜单。
- 建议：不单独开发，复用 2.2 的扩展。
- 局限：Cursor AI Chat 面板私有，无公开 API 在其输入框内加按钮。

### 2.4 Claude Code（桌面版 / CLI）—— 斜杠命令 + hook + 热键
- 接入点：
  - 自定义 slash command：`.claude/commands/enhance.md`，定义 `/enhance`：读 `$ARGUMENTS`/选中文本 → 调本地服务 → 输出。
  - `UserPromptSubmit` hook：可在提交前自动强化（可选）。
  - 桌面版同样吃 `.claude/commands/` 与 `CLAUDE.md`。
- “一键”替代：将 `/enhance` 绑快捷键；或用外壳脚本（抓剪贴板→强化→回写）配 Raycast/Alfred。
- 局限：桌面版闭源 UI，无法在输入框旁加自定义按钮；斜杠命令/热键是官方允许路径。

### 2.5 ChatGPT 桌面版 —— 系统级中介（无扩展 API）
- 硬限制：ChatGPT 桌面 App 不开放插件/UI 扩展。
- 可达方案：系统托盘 + 全局热键小工具（Windows：托盘常驻 + 全局热键，如 `Ctrl+Alt+E`）：取前台输入框/剪贴板 → POST 本地服务 → 回写剪贴板/自动粘贴 → 用户回车。可用 AutoHotkey / PowerToys / 自写 Node+qoffi。
- 局限：不是“ChatGPT 的按钮”，而是系统层任意 App 生效的中介；对 ChatGPT 桌面版这几乎是唯一现实路径。

### 2.6 汇总表
| Harness | 原生输入框加按钮 | 最现实方案 | 工作量 |
|---|---|---|---|
| dsh | ✅ | 已实现，加风格/项目感知 | 完成 |
| VS Code | ❌（面板等效） | 本地扩展：底部 webview + 命令按钮 | 中 |
| Cursor | ❌ | 复用 VS Code 扩展 | 低 |
| Claude Code 桌面/CLI | ❌ | `.claude/commands/enhance.md` + hook + 热键 | 低 |
| ChatGPT 桌面 | ❌ | 全局热键小工具 | 中 |

**通用替代公式**：全局热键 + 选区/剪贴板往返。一个常驻本地服务 + 一个热键壳，任何 App 都能“就地强化”，逼近 dsh 体验。

---

## 三、让输出“对 AI 更友好、仍对人可读”

> 下游是“另一个 AI 要执行”，需要**结构化、显式、可解析**；同时别退化成机器垃圾。

### 3.1 prompt 改法（改 `prompt-core.js` 的 base 与 `LEVEL_PROMPTS`）
把“自然段落”改成“**机器可解析的语义骨架 + 人可读的自然句**”：

强制轻量结构锚点（语义分节，非 Markdown 模板）：
```
Task: <一句话最终目标>
Context: <仅当有>
Requirements: <编号，可逐条解析>
Acceptance criteria: <可验证的完成条件>
Constraints: <边界/禁止项>
```
- 标签行 → AI 解析稳定；句子用自然语言 → 人可读。
- 把隐含约束**显式化**为可判定句（“不得修改 X”“必须兼容 stack”“只输出 Y”）。
- 保持 `inputFor` 的任务数据隔离与“项目上下文不原样抄入”规则。

### 3.2 三档落地（复用现有 `level`）
- `concise`：仅 `Task + Requirements` 最短骨架。
- `standard`：`Task / Requirements / Acceptance / Constraints` 四段骨架，每段自然句。
- `detailed`：再加 `Context / Failure cases / Compatibility`，分节更细。

### 3.3 平衡点旋钮
| 维度 | 太偏 AI（机器味） | 太偏人（含糊） | 建议默认 |
|---|---|---|---|
| 结构 | 纯 JSON/YAML | 散段落无锚点 | 标签行骨架 + 自然句 |
| 长度 | 越短越丢信息 | 堆砌套话 | 按 level、与原文字数成比例 |
| 显式度 | 每句 if/then | 靠 AI 猜 | 约束/验收显式，其余自然 |

建议插件新增「输出风格」开关：自然 / 结构化（默认结构化轻量版）= 结构给 AI，措辞给人。

---

## 四、建议落地顺序（确认后执行）
1. 扩展 `desktop/server.mjs` 的 `/api/enhance`（补 `level`/`context`），稳定成本机接口。
2. 优先做两个收益最大项：
   - **VS Code/Cursor 扩展**（一份代码两端通用）：底部 webview 面板「强化」按钮 + 命令入口。
   - **全局热键小工具**（覆盖 Claude Code 桌面版、ChatGPT 桌面版）：选区→强化→回写。
3. Claude Code 斜杠命令：`.claude/commands/enhance.md`（+ 可选 hook）。
4. dsh 同步“结构化输出”改法，保持原生标杆。
5. 全程复用 `prompt-core.js`：三档与风格改一处、全体生效。

---

## 五、待用户决策
- 先实现哪块？（建议：VS Code/Cursor 扩展 + 全局热键脚本）
- “输出风格”默认是否用「结构化轻量版」？
- Claude Code 是否需要 `UserPromptSubmit` 自动 hook（提交前自动强化）还是仅手动 `/enhance`？
