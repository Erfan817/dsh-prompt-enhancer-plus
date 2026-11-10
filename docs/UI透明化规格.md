# UI 透明化规格（玻璃质感 · 中等强度）

> 状态：**已实施**（2026-11-10）。
> 适用范围（已确认）：DSH Web GUI（`@local/dsh-glass-ui` 客户端主题插件）、Prompt Spark 桌面伴侣窗口（`desktop/styles.css`）、VS Code / Cursor 扩展面板（`vscode-extension/extension.js` 内联样式）。
> 风格：中等玻璃（Medium Glass）。控件与文字保持不透明。

---

## 1. 总体原则

1. **只让"背景层"透明**：应用底色、面板、侧栏、导航栏、对话框外壳可以使用半透明与背景模糊；文字、图标、输入框、按钮、代码块保持不透明。
2. **分层递减透明度**：越靠近内容、越需要聚焦的层越不透明。背景最低，对话框最高。
3. **亮色比暗色更实**：浅色主题下深色文字更容易被透出的内容干扰，亮色主题的不透明度整体比暗色高 6–10 个百分点。
4. **可降级**：不支持 `backdrop-filter` 或用户开启"减少透明/高对比"时，自动回退为接近实色。
5. **可读性优先**：任何透明调整不得把正文对比度降到 WCAG AA（4.5:1）以下。

## 2. 分层透明度规格

| 层级 | 元素 | 亮色主题 | 暗色主题 | 模糊 |
| --- | --- | --- | --- | --- |
| L0 应用底色 | 窗口/页面背景 | 78% | 72% | blur(14px) saturate(1.1) |
| L1 主面板 | 主内容区、侧栏、导航栏 | 84–86% | 78–82% | 同上 |
| L2 次级面板 | 卡片、选项条、列表容器 | 88–90% | 84–86% | 同上 |
| L3 浮层 | 对话框、弹出菜单、下拉层 | 92–94% | 90–92% | blur(16px) saturate(1.15) |
| L4 内容层 | 输入框、按钮、代码块、表格 | 100% | 100% | 无 |
| L5 文字层 | 所有文字、图标、边框 | 100% | 100% | 无 |

**说明**：百分比为该层背景色的不透明度（alpha），其余部分透出下层；数值是设计目标，实施时用主题色混入透明计算，不直接写死灰色。

### 2.1 颜色计算方式

统一用 `color-mix` 从现有主题色派生，保持色相不变：

```css
/* 亮色 */
--glass-bg-base:    color-mix(in srgb, <原背景色> 78%, transparent);
--glass-bg-layer-1: color-mix(in srgb, <原背景色> 86%, transparent);
--glass-bg-layer-2: color-mix(in srgb, <原背景色> 90%, transparent);
--glass-bg-overlay: color-mix(in srgb, <原背景色> 94%, transparent);

/* 暗色 */
--glass-bg-base:    color-mix(in srgb, <原背景色> 72%, transparent);
--glass-bg-layer-1: color-mix(in srgb, <原背景色> 82%, transparent);
--glass-bg-layer-2: color-mix(in srgb, <原背景色> 86%, transparent);
--glass-bg-overlay: color-mix(in srgb, <原背景色> 92%, transparent);
```

边框统一加一层 `1px` 半透明高光：亮色 `rgba(255,255,255,.55)`、暗色 `rgba(255,255,255,.12)`；阴影保持原有层级阴影，不叠加透明度。

## 3. 各界面实施映射

### 3.1 DSH Web GUI

DSH 的主题 token 位于 `--dsw-alias-*` 与 `--dsw-specific-*`，且规定每个 token 必须同时提供亮色与暗色值。实现方式：

1. 通过客户端 UI 插件的 `ctx.theme.overrideTokens(source, tokens)` 覆盖以下 token（不修改内置主题注册表，只叠加覆盖层）：

| Token | 亮色值 | 暗色值 |
| --- | --- | --- |
| `--dsw-alias-bg-base` | `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 78%, transparent)` | `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 72%, transparent)` |
| `--dsw-alias-bg-layer-1` | `...bluish-00 86%` | `...bluish-875 82%` |
| `--dsw-alias-bg-layer-2` | `...bluish-00 90%` | `...bluish-850 86%` |
| `--dsw-alias-bg-overlay` | `...bluish-150 94%` | `...bluish-700 92%` |
| `--dsw-specific-sidebar-fill` | `...bluish-50 84%` | `...bluish-900 80%` |

2. 将 `--dsw-menu-backdrop-filter` 调整为 `blur(16px) saturate(1.15)`（菜单层也会随之更玻璃）。
3. 主界面容器（侧栏、主面板）的 `backdrop-filter` 需要在实施时按实际 DOM 类名补充；**不得凭猜测写选择器**，应先读取当前页面的实际结构再落地。
4. 文字 token（`--dsw-alias-label-primary` / `-secondary`）、状态色、边框色保持原值，不参与透明覆盖。
5. 该实现应封装为一个小型客户端 UI 插件；安装后需要重启才能加载新的 Host/Client 生成。

### 3.2 Prompt Spark 桌面伴侣窗口

文件：`desktop/styles.css`。把现有不透明变量替换为带 alpha 的分层变量（保留原色值作为基底）：

```css
:root {
  --page: rgba(255,255,255,.78);
  --surface: rgba(246,247,249,.86);
  --overlay: rgba(255,255,255,.94);
  --glass: blur(14px) saturate(1.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: rgba(26,26,27,.72);
    --surface: rgba(35,36,39,.82);
    --overlay: rgba(30,31,34,.92);
  }
}
body { background: var(--page); }
.app-header, .app-footer { background: color-mix(in srgb, var(--page) 86%, transparent); backdrop-filter: var(--glass); }
dialog { background: var(--overlay); backdrop-filter: var(--glass); }
```

保持不变：
- `.field input, .field textarea, .field select` 使用实色 `--surface`（不透明）。
- `button`、`.primary`、`.secondary` 保持实色。
- `.text-editor` 透明背景只用于承载正文的 textarea；其所在容器必须是实色或足够不透明的面板（建议 `.document` 用 L1 的 86% 面板底色）。
- 所有文字颜色 `--text` / `--muted` 保持不透明。

### 3.3 VS Code / Cursor 扩展面板

文件：`vscode-extension/extension.js` 的内联 `<style>`。采用与宿主主题变量联动的方式：

```css
:root {
  --ps-bg: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
  --ps-panel: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 86%, transparent);
  --ps-overlay: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 94%, transparent);
  --ps-glass: blur(14px) saturate(1.1);
}
body { background: var(--ps-bg); }
.ps-panel { background: var(--ps-panel); backdrop-filter: var(--ps-glass); }
.ps-card, .ps-result { background: var(--ps-overlay); }
textarea, input, button, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
```

注意：VS Code webview 的主题变量由宿主注入；不要使用固定十六进制颜色，否则亮/暗主题切换会失真。

## 4. 可读性与可操作性保障

| 项目 | 要求 |
| --- | --- |
| 正文对比度 | 与最终合成背景 ≥ 4.5:1（WCAG AA）；大字号 ≥ 3:1 |
| 文字颜色 | 一律使用不透明色；禁止对文字 token 设 alpha |
| 输入控件 | 输入框、按钮、下拉框、菜单项背景必须不透明（L4） |
| 代码块/长文 | 承载代码、表格、长段落的容器使用不透明或 ≥ 96% 底色 |
| 焦点态 | 键盘焦点环 ≥ 2px，且在透明背景上仍清晰可见 |
| 悬停态 | 用实色叠加，不用透明度变化表达状态 |
| 模糊降级 | `@supports not (backdrop-filter: blur(1px))` 时把 L0–L3 的不透明度提升到 92–96% |
| 用户偏好 | 支持 `prefers-reduced-transparency: reduce` 与 `prefers-contrast: more` 时关闭透明与模糊 |
| 缩放 | 100% / 125% / 150% 下不出现文字被背景干扰或控件错位 |

## 5. 验收清单

- [ ] 亮色主题：应用背景、面板、侧栏、对话框均为半透明；文字与输入框不透明。
- [ ] 暗色主题：同一套层级关系成立，且整体比亮色更透（按规格 +6–10%）。
- [ ] 对话框在复杂背景上仍能清晰阅读；打开/关闭无闪烁。
- [ ] 输入框聚焦、按钮 hover、菜单展开状态可辨识。
- [ ] 代码块与长文本区域没有背景干扰。
- [ ] 不支持 blur 的宿主自动回退为高不透明度。
- [ ] 系统开启"减少透明/高对比"时透明效果关闭。
- [ ] 100% / 125% / 150% 缩放下布局与对比度正常。
- [ ] 三个界面（DSH、桌面伴侣、VS Code/Cursor 面板）风格一致但不互相耦合。

## 6. 风险与回滚

| 风险 | 处理 |
| --- | --- |
| 透明导致小字号文字发灰 | 提高该层不透明度或加实色文字阴影；优先保可读性 |
| 背景模糊性能开销 | 只对顶层容器使用 `backdrop-filter`，避免深层嵌套叠加 |
| 主题色被写死 | 统一用 `color-mix` + 主题变量派生，禁止固定 hex |
| 宿主不支持 `color-mix` | 提供 `rgba()` 回退值（按规格中的 alpha 计算） |
| DSH 插件影响全局 | 以独立 UI 插件形式安装，可随时禁用或卸载；不修改内置主题注册表 |
| 需要回滚 | 桌面与扩展改 CSS 变量即可恢复；DSH 在插件管理器禁用该插件 |

---

## 7. 实施顺序建议

1. **Prompt Spark 桌面伴侣**（改动最小、可立即验证）：`desktop/styles.css`。
2. **VS Code / Cursor 扩展**：`vscode-extension/extension.js` 内联样式。
3. **DSH Web GUI**：先读取实际 DOM 结构确认容器类名，再写 UI 插件；安装后重启验证。

> 本规格中的透明度数值是设计目标；实施后需按第 5 节在真实界面逐项验收，不能仅凭代码或截图推断通过。
