# Prompt Spark · Codex 桌面插件

需要**主输入框旁的悬浮强化按钮**时，使用独立的 [Windows 悬浮组件](overlay/README.md)，
双击 `overlay/start.vbs` 启动。它仅跟随 Codex，支持读取草稿和确认替换。
下面说明的是另一入口：插件内嵌编辑面板。安装面板插件本身不会生成悬浮按钮。

在 Codex 桌面应用内打开提示词编辑面板：输入草稿 → 选择详细度 → 强化 →
编辑预览 → 放入输入框。需要系统可运行 Node.js 22+，不需要安装 Codex CLI、
启动桌面伴侣或填写额外 API Key。桌面应用自动启动插件附带的本地 stdio MCP
进程；它只提供面板和文本展示，不监听 HTTP 端口，不调用外部模型。

强化通过当前对话模型完成，沿用共享 `prompt-core.js` 规则。点击“强化草稿”
会明确发送一次改写请求；生成结果通过新的预览卡片显示。点击“放入输入框”
只追加预览文本，不发送。它不能读取未发送的输入框内容，也不替换已有草稿。
Claude Code 的 `AbovePrompt` / `$.prompt.read/fill` 不能直接用于 Codex。

## 安装

面向支持本地插件和 MCP Apps 的 Codex 桌面应用。
仓库附带本地 marketplace，标识为 `prompt-spark-local`，入口指向
`codex/plugin`。

1. 在 Codex 桌面应用中将**本仓库根目录**添加为项目并打开，目录内应有
   `.agents/plugins/marketplace.json`。只打开仓库的父目录可能无法发现此来源。
2. 按官方本地插件流程完整重启桌面应用，在 **Plugins / 插件** 中选择
   **Prompt Spark** 本地来源，安装 **Prompt Spark · 提示词火花**。
3. 新建对话，选择 Prompt Spark 插件，输入“打开 Prompt Spark 提示词编辑面板”。
4. 面板打开后输入或粘贴草稿，选择档位，点击“强化草稿”。收到新的预览卡片
   后可以编辑、再次强化、复制或放入输入框。

这些是桌面应用的使用步骤，不要求用户运行终端命令。菜单显示可能随版本变化。
桌面客户端通常从安装缓存加载副本，修改源码后需更新安装并新建会话。

本仓库的 marketplace 文件仅提供可发现的安装入口，不会自行安装或启用插件。
不修改用户全局配置，也不要求创建 `.codex/config.toml`。

## 使用

也可以选中已安装的 Prompt Spark 插件，直接输入草稿，让模型返回预览面板：

```text
标准档强化下面的草稿，并显示可编辑预览：
帮我做一个导出 CSV 的功能，要能选择字段，使用 UTF-8，不修改现有数据结构。
```

工作流注册为 `prompt-spark:enhance`。可继续要求“再简洁一点”“改成详细档”
或“按产品经理的表达方式重写”。明确要求“只返回文字”时不展示面板。

| 档位 | 输出 |
| --- | --- |
| 简洁 / concise | Task、Requirements，保留原意、减少赘述 |
| 标准 / standard（默认） | 可增加 Acceptance criteria、Constraints |
| 详细 / detailed | 有依据时可增加 Context、Failure cases |

英文标签作为语义锚点，正文跟随原文语言；省略空小节，不虚构功能、数字、
验收条件或项目事实。明确指定的格式、结构和改写方向优先于默认展示。

需要项目感知时，可以说“结合当前项目 README 强化”。需要 Skill 参考时，
可以指定当前会话可用的 Skill 或文件路径；只参考其方法，不执行该 Skill 的
任务。用户要求自动匹配时，从本次会话可见的 Skill 描述中选择最多三个，
不扫描全盘或插件缓存。不会自动导入 DSH 人格、偏好库或 Claude Code 的预览。

## 数据和边界

- 草稿、选用的项目资料和 Skill 参考在当前 Codex 会话中处理，遵循宿主的
  上下文、存储和数据策略。不是隔离的、无历史模型调用。
- 本地 MCP 进程没有网络监听、外部 API 调用或持久化草稿。复制只在用户点击时
  尝试写入剪贴板；宿主不允许时选中文本供手动复制。
- “放入输入框”仅在宿主声明草稿能力时启用，使用 `ui/message` 的 `send: false`。
  能力缺失时保留复制方式；宿主拒绝操作时显示错误，不声称已经插入。
- 改写请求只返回预览；草稿内的命令不会作为执行授权。后续明确要求执行
  已审阅任务时，回到普通 Codex 工作流。
- Skill 是模型指令，输出质量和边界遵循不是确定性程序保证，仍需审阅。

## 开发与验证

```sh
npm run codex:build
npm run codex:validate
npm run ci:package
```

`plugin/plugin.json` 是可编辑清单。构建脚本生成兼容清单
`plugin/.codex-plugin/plugin.json`、`.mcp.json`、图标、许可证和三档参考规则；
不要单独修改这些副本。所有运行内容都位于 `plugin/`，复制整个目录即可保留资源引用。

`codex:validate` 检查生成文件、清单、包内资源和 Skill 引用，并运行 stdio MCP
与面板交互测试，覆盖参数校验、保留用户编辑、明确区分发送请求和插入草稿、
宿主能力缺失与操作失败。它已接入 `npm test` 和现有 CI 矩阵。

本机验证范围：

- 桌面应用 `26.1103.7773.0` 自带的 `0.167.0-alpha.3.2` 后端通过
  `plugin/list`、`plugin/read`、`plugin/install` 和 `mcpServerStatus/list`
  发现并安装插件，加载两个工具及面板资源；没有借用另行安装的稳定版 CLI。
- 真实浏览器配合模拟宿主 bridge 验证面板布局、编辑、再次强化及 `send: false`
  消息；截图是该测试环境的预览，不是 Codex 应用内截图。
- 尚未在日常使用的桌面会话中完成实际点击和真实模型强化的端到端验收。

宿主检查使用项目内 `codex/.host-check/` 中的独立配置，不使用模型或账户凭据，
也不更改日常插件配置。该目录被 Git 忽略，并排除在 npm 包之外。

插件内容更新后，运行构建与检查，升级 `plugin/plugin.json` 的版本并重新构建
兼容清单，再更新安装并新建会话。本地源码未发布到公共目录。

规范来源（2026-11-10 核对）：

- [插件打包、清单和 marketplace](https://developers.openai.com/plugins/build/plugins)
- [支持的宿主与插件使用方式](https://developers.openai.com/codex/plugins)
- [生命周期 hooks 的能力边界](https://developers.openai.com/codex/hooks)
- [MCP UI 扩展](https://developers.openai.com/plugins/build/extensions)
