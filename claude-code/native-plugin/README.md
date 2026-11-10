# Prompt Spark · Claude Code 原生插件

在输入区上方点击品牌图标旁的「强化」，用当前会话选择的模型生成可编辑预览，确认后「替换草稿」。不会自动发送，不读取其他应用、剪贴板历史、项目文件或会话历史。不需要 Electron、本机 HTTP 服务、CLI 中介或单独填写 API Key。模型调用使用宿主客户端及凭据，按宿主账户或供应商规则计量，不承诺免费或特定订阅覆盖。

这是 function hooks 原生插件，不是 Skill。需要支持 `hooks.modules`、`AbovePrompt`、`$.prompt.read/fill`、`$.model.complete` 的 Claude Code 构建。开发依据当前环境生成的 2.1.321 early-access 类型；不是所有同名版本或所有桌面部署都保证提供这些接口。不支持时不要退回 DOM 注入或自动发送。

## 使用

1. 启用插件后，输入区上方会显示 Prompt Spark。若宿主询问是否启用此会话生成的 mods，请自行确认；未启用时不会出现按钮。
2. 在主输入框写草稿，点击品牌图标旁的「强化」。这是一次额外模型请求；只发送这份草稿和共享强化规则，不发送本次会话历史或附件。
3. 在预览中选择简洁、标准或详细档，重新强化以应用新档位。可编辑结果；预览框回车只保存编辑，不发送任务。
4. 点击「替换草稿」或「复制」。原输入框改变、提交过任务或插件重载后，旧预览不能覆盖草稿。替换后未继续编辑或提交时可以撤销。
5. 「取消强化」、关闭按钮、宿主自带关闭标记／Esc 都会中止请求；也有 60 秒超时。通过「预览」可重新打开。结果编辑区全宽展示，原草稿默认收起，点击「查看原草稿」展开。

`/prompt-spark` 仅打开面板，不调用模型。主要入口是原生按钮，不依赖项目中的 `/enhance` 命令。运行中的主任务会暂停强化入口；请求期间继续编辑不会被结果覆盖。输入超过 12000 字符会拒绝发送，不会静默截断。预览暂存在会话内存，不写偏好库或外部文件；宿主本身的会话恢复／存储策略仍由宿主决定。

## 从源码开发

在一个交互式终端启动：

```bash
claude --plugin-dir /absolute/path/to/prompt-spark-native
```

桌面 Code 会话可使用宿主支持的插件安装流程。开发时也可由用户在启动桌面应用前设置 `CLAUDE_CODE_PLUGIN_DIRS` 指向此文件夹（Windows 多个路径以分号分隔），然后完整重启桌面应用。插件不会自行更改用户设置或环境变量。

## 验证

```bash
claude plugin validate /absolute/path/to/prompt-spark-native
```

```bash
claude plugin test /absolute/path/to/prompt-spark-native
```

测试使用宿主测试引擎和模拟模型响应，不产生真实模型费用，也不等同于桌面画面的端到端验证。共享规则来自仓库根 `prompt-core.js`，由仓库的构建脚本同步到 `hooks/prompt-core.js`；品牌 SVG 来自 README 引用的根 `icon.svg`，同步到 `hooks/brand.js`，不要单独维护副本。生成经独立计时器调度，不占用点击处理器等待模型返回，避免点击事件的 10 秒预算超时。

MIT. Prompt Spark native composer plugin. Read the draft, request one tool-free completion through the host, review and explicitly apply. No background service, no hidden submissions, no conversation-history forwarding. Requires the early-access function hooks API rather than classic command hooks.
