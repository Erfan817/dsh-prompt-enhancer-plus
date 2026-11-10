# Claude Code 集成（Prompt Spark）

Claude Code 桌面版 / CLI **没有公开的 UI 扩展 API**，无法像 dsh 那样在输入框下方加按钮。官方允许的等价路径是**自定义斜杠命令**（以及可选的 hook）。

本目录提供：

| 文件 | 用途 |
| --- | --- |
| `commands/enhance.md` | `/enhance` 斜杠命令模板 |
| `hooks/user-prompt-submit.mjs` | 可选 hook：提交前把强化版作为附加上下文提供给模型 |
| `settings.example.json` | hook 的配置示例 |

前置条件：本地服务已启动（在仓库根目录运行 `npm run desktop`，它会在 `%APPDATA%/prompt-enhancer-plus-local/session.json` 写入本地地址与令牌）。

## 安装 `/enhance`

把 `commands/enhance.md` 复制到下面任一位置：

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

Claude Code 桌面版无法加按钮，推荐组合：

1. 保持 `npm run desktop` 的本地服务运行；
2. 用 `hotkey-tool/` 的全局热键（Ctrl+Alt+E）：在任意输入框选中文字 → 强化 → 写回剪贴板；
3. 回到 Claude Code 粘贴。

这是平台能力边界内体验最接近 dsh 的方式。
