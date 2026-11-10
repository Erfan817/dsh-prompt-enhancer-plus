# 云端 CI

GitHub Actions 工作流：`.github/workflows/ci.yml`。

## 何时运行

- 对 `main` 新建或更新 PR 时运行；
- 推送到 `main` 时运行；
- 可在 Actions 页面手动触发（工作流合并进默认分支后可用）。

并发更新同一 PR 会取消旧一轮检查，避免重复消耗资源。每个任务最多运行 15 分钟。

## 检查范围

| 任务 | 环境与检查 |
| --- | --- |
| Regression | Ubuntu / Windows × Node 22 / 24，运行 `npm test`（包括 Codex 插件包、共享规则、MCP 传输和模拟宿主面板交互检查）、原生规则及品牌资源一致性检查、不打开浏览器的服务 smoke test、npm 打包内容检查 |
| Native plugin | Windows + Node 24，安装固定的 `@anthropic-ai/claude-code@2.1.319`，运行 `claude:validate` 和 `claude:test` |

Windows Regression 还会编译 Codex 悬浮组件并检查预览、关闭再开、编辑保留和
撤销保护状态，不需要安装 Codex，不连接模型，也不读写其他应用的输入框。

原生测试引擎版本取自已经通过本地插件测试的 CLI 版本，并已确认 npm 存在该版本。它仍需在首次 GitHub runner 上确认；若云端发行版不支持 function hooks，任务会明确失败，不会跳过后假报成功。不自动更新为 latest，不使用 `continue-on-error`。

所有测试使用模拟模型，不配置 Anthropic API Key、登录凭据或其他 repository secrets，不调用真实模型。工作流仅授予 `contents: read`，不发布包、不部署、不自动合并。使用 `pull_request` 而非 `pull_request_target`，checkout 不保留凭据，Actions 固定到 commit SHA。

项目依赖使用 lockfile 和 `npm ci --ignore-scripts`，跳过生命周期脚本。唯一例外是固定版本的 Claude Code 测试引擎：必须运行其 postinstall，把平台二进制链接/复制到命令入口，否则 `claude --version` 就会报 native binary not installed。测试会执行仓库代码，来自不可信贡献者的工作流运行仍应按 GitHub 的审批提示处理。

## 本地与云端分工

本地优先只跑改动涉及的针对性测试及 `git diff --check`，完整回归交给 PR。必要时本地运行：

```bash
npm run ci:package
```

```bash
npm run claude:test
```

CI 不验证实际桌面绘制、真实全局热键、真实模型响应质量，也不覆盖 macOS 或严格 TypeScript 检查。这些不应因绿色 CI 被宣称已经验证。

## PR 合并

在 PR 的 Checks 中查看所有任务。只有任务成功才算该范围的测试通过；Pending / Skipped 不等于通过。仅添加工作流不会自动开启分支保护或禁止手动合并；仓库管理员若要求强制检查，可另行在 ruleset 中将此工作流的任务设为必需。此改动不更改仓库保护设置。
