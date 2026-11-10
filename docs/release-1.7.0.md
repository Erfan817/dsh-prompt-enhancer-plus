# Prompt Spark 1.7.0

## 新增 · Added

- DSH 支持“首次强化 → 手动修改 → 再次强化”的偏好学习流程，同时支持预览内编辑及替换到输入框后的连续编辑。
- 从修改中提取可复用的强化方向，展示给用户审阅、编辑并确认后才保存；不自动把任务正文保存为人格。
- 记忆范围支持当前会话、项目和全局（当前 DSH 配置档），默认按工作目录保存到项目。
- 确认保存的偏好立即用于本次强化，并自动用于适用范围内后续强化。
- 不同方向采用保守冲突确认策略。局部覆盖保留其他范围的记忆，删除覆盖规则可恢复原方向。
- 提供已保存偏好的查看、状态显示和删除操作。

## 修复与验证 · Fixes and validation

- 防止取消、发送、草稿变化及旧请求造成过期结果应用；通过版本检查处理并发保存。
- 防止旧列表响应覆盖删除后的偏好列表，并在版本冲突后刷新。
- 修复 Windows CRLF 换行符下的客户端测试兼容问题。
- 全部 10 组自动化测试通过；已校验 npm 包包含偏好模块、语言资源、图标及适配器文件。

## 使用说明与边界 · Usage and limits

强化后手动修改，再次点击“强化”，审阅建议、选择范围，然后点击“确认保存并强化”。也可选择不保存而继续强化。

偏好识别使用当前模型，可能消耗额外 token。连续编辑识别为启发式判断；建议需由用户检查，不相关或敏感内容不要保存。学习基线约保留 30 分钟，清空、发送、重启或工作目录变化后可能需要重新强化。此学习确认流程位于 DSH；其他适配器保留现有功能。本版本不声称已完成真实模型及浏览器全流程视觉验收。

DSH can now learn reusable enhancement preferences from manual edits, with mandatory user review, selectable session/project/profile-global scope, immediate application, scope-local conflict overrides, and preference management. All ten automated test suites pass. Review inferred directions before saving; task continuity remains heuristic.
