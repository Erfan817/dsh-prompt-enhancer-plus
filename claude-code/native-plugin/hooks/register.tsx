import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'
import type { Level, Preview } from '../types'
import { enhancementSystem, inputFor, normalizeEnhancedText } from './prompt-core.js'
import { BRAND_ICON } from './brand.js'

const PANE = 'prompt-spark-preview'
const initial: Preview = {
  phase: 'idle', level: 'standard', original: '', enhanced: '', error: '',
  stale: false, sourceEpoch: 0, undo: null, showOriginal: false,
}
const preview = atom({ plugin: 'prompt-spark-native', key: 'preview' } as const, initial, { shape: 'preview-2' })
const levels = [
  { value: 'concise', label: '简洁' },
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '详细' },
]

// Only transient handles live here. Drafts and render state belong to $.state.
let active: AbortController | undefined
let epoch = 0
let working = false
let applying = false
let fillGuard: { text: string; epoch: number } | undefined

const open = async ($: EngineInterface) => {
  const result = await $.ui.open({ id: PANE, title: 'Prompt Spark · 提示词预览', focus: true, closeOnEscape: true })
  if (!result.isPlaced) $.ui.toast('当前界面无法显示预览，请在支持原生插件的桌面版或终端中使用。')
  return result.isPlaced
}
const error = async ($: EngineInterface, message: string) => {
  await update($, preview, s => ({ ...s, phase: 'error', error: message }))
}
const cancel = async ($: EngineInterface) => {
  const controller = active
  active = undefined
  controller?.abort()
  await update($, preview, s => ({ ...s, phase: s.enhanced ? 'preview' : 'idle', error: '' }))
}
const observe = async ($: EngineInterface) => {
  epoch += 1
  await update($, preview, s => ({ ...s,
    stale: s.original ? true : s.stale,
    undo: null,
  }))
}
const enhance = async ($: EngineInterface) => {
  if (active || applying || working) return
  const controller = new AbortController()
  active = controller
  try {
    // Open while answering the person's click so narrow desktop panes are placed.
    if (!await open($)) { await cancel($); return }
    if (active !== controller) return
    // Return the generation promise to the timer host, not to the click handler.
    // The timer host owns its lifetime and observes failures through generate.
    $.clock.after(1, () => generate($, controller))
  } catch {
    if (active === controller) await cancel($)
  }
}
const generate = async ($: EngineInterface, controller: AbortController) => {
  if (active !== controller) return
  try {
    const sourceEpoch = epoch
    const box = await $.prompt.read()
    if (!box.text.trim()) { $.ui.toast('先在输入框写下需要强化的草稿。'); return }
    if (box.text.length > 12000) { $.ui.toast('草稿超过 12000 字符，请缩短后重试；不会截断后发送。'); return }
    const { level } = await read($, preview)
    if (active !== controller) return
    await update($, preview, s => ({ ...s, phase: 'busy', original: box.text,
      enhanced: '', error: '', stale: false, sourceEpoch, undo: null }))
    if (active !== controller) return
    const model = await $.session.model()
    const result = await $.model.complete({
      model,
      system: enhancementSystem({}, 'general', undefined, level),
      prompt: inputFor(box.text),
      maxTokens: 6000,
      effort: 'low',
      timeoutMs: 60000,
    }, { signal: controller.signal })
    if (active !== controller) return
    if (!result.isAnswered) {
      const message = result.reason === 'api-error'
        ? `强化请求失败（HTTP ${result.status ?? '无响应'}）。请检查当前会话模型与额度，草稿未改动。`
        : result.reason === 'aborted' ? '强化已超时或中止，草稿未改动。'
        : '模型没有返回正文，草稿未改动。'
      await error($, message)
      return
    }
    const enhanced = normalizeEnhancedText(result.text, { original: box.text })
    if (!enhanced) { await error($, '模型返回了空结果，草稿未改动。'); return }
    await update($, preview, s => ({ ...s, phase: 'preview', enhanced,
      stale: s.stale || epoch !== sourceEpoch, error: '' }))
  } catch {
    if (active === controller) await error($, '无法完成强化，请检查插件权限与模型配置。草稿未改动。')
  } finally {
    if (active === controller) active = undefined
  }
}
const fill = async ($: EngineInterface, text: string, expected: string, expectedEpoch: number) => {
  fillGuard = { text: expected, epoch: expectedEpoch }
  try {
    const result = await $.prompt.fill({ text, mode: 'replace' })
    if (!result.isFilled) {
      $.ui.toast('未替换：输入框已改变、正在显示对话框，或当前界面不支持回填。可复制预览。')
      return false
    }
    if (result.text !== text) {
      $.ui.toast('宿主调整了回填内容，请检查输入框。')
      return false
    }
    return true
  } finally { fillGuard = undefined }
}
const apply = async ($: EngineInterface) => {
  if (active || applying || working) return
  applying = true
  try {
    const s = await read($, preview)
    if (s.phase !== 'preview' || !s.enhanced.trim()) return
    const box = await $.prompt.read()
    if (s.stale || epoch !== s.sourceEpoch || box.text !== s.original) {
      $.ui.toast('草稿在生成后已改变，不会覆盖新内容。请复制预览或重新强化。')
      return
    }
    if (await fill($, s.enhanced, s.original, s.sourceEpoch)) {
      await update($, preview, current => ({ ...current, stale: true,
        undo: { original: s.original, applied: s.enhanced, epoch } }))
      $.ui.toast('已替换草稿，尚未发送。可以撤销。')
    }
  } finally { applying = false }
}
const undo = async ($: EngineInterface) => {
  if (active || applying || working) return
  applying = true
  try {
    const { undo: saved } = await read($, preview)
    if (!saved) return
    const box = await $.prompt.read()
    if (epoch !== saved.epoch || box.text !== saved.applied) {
      $.ui.toast('输入框已改变，不能撤销覆盖你的新内容。')
      await update($, preview, s => ({ ...s, undo: null }))
      return
    }
    if (await fill($, saved.original, saved.applied, saved.epoch)) {
      await update($, preview, s => ({ ...s, undo: null, stale: true }))
      $.ui.toast('已恢复原草稿，尚未发送。')
    }
  } finally { applying = false }
}
const copy = async ($: EngineInterface, surface: RenderSurface) => {
  const s = await read($, preview)
  if (!s.enhanced.trim()) return
  const result = await $.ui.copy({ text: s.enhanced, surface })
  $.ui.toast(result.isCopied ? '已复制预览。' : '复制不可用，请在预览中手动选择并复制。')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A reload aborts the worker's pending call, but session state survives.
    await update($, preview, s => ({ ...s, phase: s.phase === 'busy' ? 'error' : s.phase,
      error: s.phase === 'busy' ? '插件已重新加载，请重新强化。' : s.error,
      stale: !!s.original, undo: null }))
    await $.command.register({ name: 'prompt-spark', description: '打开提示词强化预览；不发送草稿' })
    return next(e)
  })
  on('command.run', { command: 'prompt-spark' }, async $ => {
    await open($)
    return { text: '已打开 Prompt Spark。点击「强化当前草稿」后才会调用当前模型。' }
  })
  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    if (result.text !== e.text) await observe($)
    return result
  })
  on('prompt.change', async ($, e, next) => { await observe($); return next(e) })
  on('prompt.submit', async ($, e, next) => {
    await cancel($)
    await observe($)
    return next(e)
  })
  on('prompt.fill', { origin: { kind: 'plugin', name: 'prompt-spark-native' } }, async ($, e, next) => {
    const guard = fillGuard
    if (guard) {
      const box = await $.prompt.read()
      if (epoch !== guard.epoch || box.text !== guard.text || working) return { isFilled: false }
    }
    return next(e)
  }).catch(() => ({ isFilled: false }))
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await cancel($)
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) { working = true; await cancel($); await observe($) }
    return next(e)
  })
  on('turn.complete', (_, e, next) => { if (!e.agentId) working = false; return next(e) })
  on('session.end', async ($, e, next) => {
    await cancel($)
    await update($, preview, () => ({ ...initial }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, preview)
    const { Box, Text, Button } = $.ui.resolve(e)
    let icon = null
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      icon = <Svg source={BRAND_ICON} alt="Prompt Spark" width={24} height={24} />
    }
    return <Box alignItems="center" gap="xs" flexWrap="wrap">
      {icon}
      {!e.props.isWorking && s.phase !== 'busy'
        ? <Button key="enhance" label="强化" variant="primary" onPress={() => enhance($)} />
        : <Text dimColor>{s.phase === 'busy' ? '强化中…' : '等待任务完成'}</Text>}
      <Button key="preview" label="预览" plain onPress={() => open($)} />
      {s.phase === 'busy' && <Button key="cancel" label="取消" onPress={() => cancel($)} />}
      {s.undo && !e.props.isWorking && <Button key="undo" label="撤销替换" onPress={() => undo($)} />}
    </Box>
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, preview)
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    return <Box flexDirection="column" width="100%" alignItems="stretch" gap="md">
      <Box alignItems="center" justifyContent="space-between" flexWrap="wrap" gap="sm">
        {s.phase !== 'busy' && <Select key="level" label="详细度" value={s.level} options={levels}
          onSelect={value => update($, preview, current => ({ ...current, level: value as Level }))} />}
        {s.phase === 'busy'
          ? <Box alignItems="center" gap="sm"><Text>正在强化…</Text><Button key="cancel" label="取消" onPress={() => cancel($)} /></Box>
          : <Button key="generate" label={s.enhanced ? '重新强化' : '强化当前草稿'} onPress={() => enhance($)} />}
      </Box>
      {!!s.error && <Text>{s.error}</Text>}
      {!!s.enhanced ? <Box flexDirection="column" width="100%" alignItems="stretch" gap="xs">
        <Text bold>强化结果</Text>
        <Box key="editor" flexDirection="column" width="100%" alignItems="stretch">
          <Input key="enhanced" rows={16} value={s.enhanced} submitLabel="保存预览"
            onInput={value => update($, preview, current => ({ ...current, enhanced: value }))}
            onSubmit={value => update($, preview, current => ({ ...current, enhanced: value }))} />
        </Box>
        <Text dimColor>可以直接编辑，确认后替换。不会自动发送。</Text>
        {s.stale && <Text>原草稿已改变或结果已应用。请复制结果，或重新强化。</Text>}
      </Box> : s.phase !== 'busy' && !s.error && <Text dimColor>在主输入框写下草稿，再点击强化。生成后可在这里编辑。</Text>}
      {!!s.original && <Box flexDirection="column" gap="xs">
        <Button key="toggle-original" plain label={s.showOriginal ? '收起原草稿' : '查看原草稿'}
          onPress={() => update($, preview, current => ({ ...current, showOriginal: !current.showOriginal }))} />
        {s.showOriginal && <Text dimColor>{s.original}</Text>}
      </Box>}
      <Box key="actions" alignItems="center" flexWrap="wrap" gap="sm">
        {!!s.enhanced && !s.stale && s.phase === 'preview' && <Button key="apply" label="替换草稿" variant="primary" onPress={() => apply($)} />}
        {!!s.enhanced && <Button key="copy" label="复制" onPress={press => copy($, press.surface)} />}
        {s.undo && <Button key="undo" label="撤销替换" onPress={() => undo($)} />}
        <Button key="close" label="关闭" plain onPress={async () => { await cancel($); await $.ui.close({ id: PANE }) }} />
      </Box>
      <Text dimColor>使用当前模型 · 消耗模型用量 · 不读取历史或附件</Text>
    </Box>
  })
}
