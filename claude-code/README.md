# Claude Code 集成（Prompt Spark）

## 原生插件（推荐，需宿主支持 function hooks）

新增 [`native-plugin/`](native-plugin/README.md)：输入区品牌图标旁「强化」→ 可编辑预览 → 确认替换草稿，可复制、取消和撤销，不自动发送。复用根目录 `prompt-core.js`，通过宿主 `$.model.complete` 调用当前会话模型，不需要 Electron、本机 HTTP 服务、CLI 中介或额外 API Key；调用仍按宿主凭据计量。

这是原生 function hooks 插件，不是 Skill。开发依据本环境生成的 Claude Code 2.1.321 early-access 接口；需要宿主支持 `hooks.modules`、`AbovePrompt`、`$.prompt.read/fill` 和 `$.model.complete`，不能保证所有版本或桌面部署都支持。验证通过不等同于已在真实桌面 Composer 完成端到端测试。安装、使用和能力边界见 [原生插件指南](native-plugin/README.md)。

0.2.0 同步 DSH 的文字编辑 Skill 参考、本机约定目录发现、手选最多三个和预览内连续强化。参考作为数据发送至当前模型，不执行脚本；原生插件不依赖 DSH 注册表。失败/取消保留预览，原草稿变化后仍禁止覆盖。

从源码在交互式终端试用（不修改全局配置）：

```bash
claude --plugin-dir ./claude-code/native-plugin
```

同步规则、验证及模拟测试：

```bash
npm run claude:build
```

```bash
npm run claude:validate
```

```bash
npm run claude:test
```

## 旧版本接入（可选，仍依赖本机服务）

以下命令／传统 `UserPromptSubmit` hook 保留兼容，不是新原生插件的前置条件。传统命令 hook 没有原生按钮能力，不能与新的 function hooks 接口混淆。

本仓库提供：

| 文件 | 用途 |
| --- | --- |
| `../.claude/commands/enhance.md` | `/enhance` 斜杠命令模板 |
| `hooks/user-prompt-submit.mjs` | 可选 hook：提交前把强化版作为附加上下文提供给模型 |
| `settings.example.json` | hook 的配置示例 |

前置条件：本地服务已启动（在仓库根目录运行 `npm run desktop`，它会在 `%APPDATA%/prompt-enhancer-plus-local/session.json` 写入本地地址与令牌）。

## 安装 `/enhance`

把本仓库的 `.claude/commands/enhance.md` 复制到下面任一位置：

- 项目级：`<你的项目>/.claude/commands/enhance.md`
- 用户级：`~/.claude/commands/enhance.md`

如果仓库不在 `D:/插件/dsh-prompt-enhancer-plus`，编辑命令里的默认路径，或设置环境变量 `PROMPT_SPARK_CLI` 指向 `cli/enhance.mjs` 的绝对路径。

使用：

```
/enhance 帮我做一个导出 CSV 的功能，要能选字段
```

命令会调用 `cli/enhance.mjs`，把结构化后的提示词返回给当前会话。

## 可选 hook（自动附加，不替换原文）

`hooks/user-prompt-submit.mjs` 读取 Claude Code 的 `UserPromptSubmit` 事件，把**强化版**作为附加上下文提供给模型。注意：hook 的输出是**附加**信息，Claude Code 不允许 hook 直接替换用户原文，因此它不会改写你输入框里的文字——这是平台限制，不是本工具的缺陷。

在项目 `.claude/settings.json` 加入（或合并）：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"D:/插件/dsh-prompt-enhancer-plus/claude-code/hooks/user-prompt-submit.mjs\"" }
        ]
      }
    ]
  }
}
```

设置 `PROMPT_SPARK_HOOK=1` 才会真正调用模型，否则 hook 立即退出（避免每次提交都产生费用）。

## 更接近“一键”的替代方案

如果宿主不支持原生 function hooks，可选旧热键组合（并非原生集成）：

1. 保持 `npm run desktop` 的本地服务运行；
2. 用 `hotkey-tool/` 的全局热键（Ctrl+Alt+E）：在任意输入框选中文字 → 强化 → 写回剪贴板；
3. 回到 Claude Code 粘贴。

这是平台能力边界内体验最接近 dsh 的方式。
