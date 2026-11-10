import { test, expect, mock } from 'claude-code/testing'
import type { On, ModelCompleteInput, ModelCompleteResult } from 'claude-code'

const PLUGIN = 'prompt-spark-native'
const usage = { input_tokens: 12, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = {
  plugin: PLUGIN, component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6,
    bodyColumns: 90, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const
const PANE = {
  plugin: PLUGIN, component: 'Pane', requestId: 'prompt-spark-preview',
  props: { title: 'Prompt Spark', isFocused: true, bodyColumns: 80,
    placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function host(on: On, respond?: (e: ModelCompleteInput) => Promise<ModelCompleteResult> | ModelCompleteResult) {
  const clock = mock.clock(on)
  const h = { clock, text: '帮我做导出 CSV，不改数据结构。', requests: [] as ModelCompleteInput[],
    fills: [] as string[], copied: '', toasts: [] as string[], failFill: false, submissions: 0, canPlace: true }
  on('prompt.read', () => ({ value: { text: h.text, cursor: h.text.length } }))
  on('prompt.fill', (_, e) => {
    if (h.failFill) return { isFilled: false }
    h.text = e.text
    h.fills.push(e.text)
    return { isFilled: true }
  })
  on('session.cwd', () => ({ value: '/project' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('session.model', () => ({ value: 'test-session-model' }))
  on('model.complete', async (_, e) => {
    h.requests.push(e)
    return { value: respond ? await respond(e) : { isAnswered: true, text: 'Task: 导出 CSV。\nConstraints: 不改数据结构。', usage } }
  })
  on('ui.open', () => ({ value: h.canPlace ? { isPlaced: true } : { isPlaced: false, reason: 'no-surface' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => { h.toasts.push(e.text); return { value: undefined } })
  on('ui.copy', (_, e) => { h.copied = e.text; return { value: { isCopied: true } } })
  on('command.register', () => ({ value: { command: 'prompt-spark' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', () => { h.submissions += 1; return { drop: 'test stops real turn' } })
  return h
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: preview, edit, apply, copy and undo without submitting`, async ($, on) => {
    const h = host(on)
    const original = h.text
    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'enhance' })
    await h.clock.advance(1)
    expect(h.requests.length).toBe(1)
    expect(h.requests[0]?.model).toBe('test-session-model')
    expect(h.requests[0]?.system).toContain('Non-negotiable rewrite rules')
    expect(h.requests[0]?.prompt).toContain(original)
    expect(h.text).toBe(original)
    const pane = await $.ui.mount({ ...PANE, surface })
    await pane.input({ key: 'enhanced', text: 'Task: 用户编辑后的结果。', kind: 'change' })
    await pane.press({ key: 'copy' })
    expect(h.copied).toBe('Task: 用户编辑后的结果。')
    await pane.press({ key: 'apply' })
    expect(h.text).toBe('Task: 用户编辑后的结果。')
    await pane.press({ key: 'undo' })
    expect(h.text).toBe(original)
    expect(h.submissions).toBe(0)
    await band.unmount(); await pane.unmount()
  })
}

test('copy stays available but changed drafts cannot be overwritten', async ($, on) => {
  const h = host(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  h.text = '新草稿'
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'apply' })
  expect(h.text).toBe('新草稿')
  expect(h.fills.length).toBe(0)
  await pane.press({ key: 'copy' })
  expect(h.copied).toContain('Task:')
})

test('empty and overlong drafts never call the model', async ($, on) => {
  const h = host(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  h.text = '   '
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  h.text = '字'.repeat(12001)
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  expect(h.requests.length).toBe(0)
  expect(h.fills.length).toBe(0)
})

test('model API failure leaves the draft intact and shows an error', async ($, on) => {
  const h = host(on, () => ({ isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage }))
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const original = h.text
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text', text: /HTTP 429/ }))?.text).toContain('429')
  expect(await pane.find({ key: 'apply' })).toBeUndefined()
  expect(h.text).toBe(original)
})

test('detail selection uses the same shared prompt core', async ($, on) => {
  const h = host(on)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.select({ key: 'level', value: 'detailed' })
  await pane.press({ key: 'generate' })
  await h.clock.advance(1)
  expect(h.requests[0]?.system).toContain('Length/expansion level: detailed')
})

test('host refusing fill never claims replacement or creates undo', async ($, on) => {
  const h = host(on)
  const original = h.text
  h.failFill = true
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'apply' })
  expect(h.text).toBe(original)
  expect(await pane.find({ key: 'undo' })).toBeUndefined()
})

test('no enhancement starts while a main turn is displayed as running', async ($, on) => {
  const h = host(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, isWorking: true } })
  expect(await band.find({ key: 'enhance' })).toBeUndefined()
  expect(h.requests.length).toBe(0)
})

test('cancel discards even a late successful response and permits another request', async ($, on) => {
  let first = true
  const h = host(on, async () => {
    if (first) {
      first = false
      const busy = await $.ui.mount({ ...BAND, surface: 'desktop' })
      await busy.press({ key: 'cancel' })
      await busy.unmount()
      return { isAnswered: true, text: 'Task: 不应出现的过期结果', usage }
    }
    return { isAnswered: true, text: 'Task: 新结果', usage }
  })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'enhanced' })).toBeUndefined()
  expect(h.fills.length).toBe(0)
  await pane.press({ key: 'generate' })
  await h.clock.advance(1)
  expect(h.requests.length).toBe(2)
  expect(await pane.find({ key: 'apply' })).toBeDefined()
})

test('closing preview cancels in-flight work', async ($, on) => {
  const h = host(on, async () => {
    await $.ui.close({ id: 'prompt-spark-preview' })
    return { isAnswered: true, text: 'Task: 迟到的结果', usage }
  })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'enhanced' })).toBeUndefined()
})

test('empty model output is an error, not an applicable result', async ($, on) => {
  const h = host(on, () => ({ isAnswered: true, text: '  ', usage }))
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text', text: /空结果/ }))?.text).toContain('空结果')
  expect(await pane.find({ key: 'apply' })).toBeUndefined()
})

test('a second click during a request cannot start another model call', async ($, on) => {
  const h = host(on, async () => {
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await pane.find({ key: 'generate' })).toBeUndefined()
    await pane.unmount()
    return { isAnswered: true, text: 'Task: 结果', usage }
  })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  expect(h.requests.length).toBe(1)
})

test('submitted drafts lose replacement authority even when their text is identical', async ($, on) => {
  const h = host(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  await $.prompt.submit({ text: h.text })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'apply' })).toBeUndefined()
  expect(h.fills.length).toBe(0)
})

test('changed drafts also prevent undo from overwriting new input', async ($, on) => {
  const h = host(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'apply' })
  h.text = '替换之后继续写的新内容'
  await pane.press({ key: 'undo' })
  expect(h.text).toBe('替换之后继续写的新内容')
  expect(h.fills.length).toBe(1)
})

test('no model request is made if the host cannot place a preview', async ($, on) => {
  const h = host(on)
  h.canPlace = false
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  expect(h.requests.length).toBe(0)
})

test('a reloaded worker does not retain replace or undo authority', async ($, on) => {
  const h = host(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  await h.clock.advance(1)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'apply' })).toBeUndefined()
  expect(await pane.find({ key: 'undo' })).toBeUndefined()
  expect(h.fills.length).toBe(0)
})
