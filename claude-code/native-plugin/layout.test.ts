import { test, expect, mock } from 'claude-code/testing'
import { BRAND_ICON } from './hooks/brand.js'

const BAND = {
  plugin: 'prompt-spark-native', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6,
    bodyColumns: 42, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const
const PANE = {
  plugin: 'prompt-spark-native', component: 'Pane', requestId: 'prompt-spark-preview',
  props: { title: 'Prompt Spark', isFocused: true, bodyColumns: 42,
    placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: full-width editor has a separate heading and collapsible original`, async ($, on) => {
    const clock = mock.clock(on)
    on('prompt.read', () => ({ value: { text: '原始草稿', cursor: 4 } }))
    on('session.model', () => ({ value: 'test' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', () => ({ value: { isAnswered: true, text: 'Task: 强化结果', usage } }))
    const band = await $.ui.mount({ ...BAND, surface })
    if (surface === 'desktop') {
      const icon = await band.find({ type: 'Svg' })
      expect(icon?.props.source).toBe(BRAND_ICON)
      expect(icon?.props.width).toBe(24)
    }
    expect((await band.find({ key: 'enhance' }))?.props.label).toBe('强化')
    await band.press({ key: 'enhance' })
    await clock.advance(1)
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: '强化结果' }))?.text).toBe('强化结果')
    const editor = await pane.find({ key: 'enhanced' })
    expect(editor?.props.label).toBeUndefined()
    expect(editor?.props.rows).toBe(16)
    const wrapper = await pane.find({ key: 'editor' })
    expect(wrapper?.props.width).toBe('100%')
    expect(wrapper?.props.flexDirection).toBe('column')
    expect(await pane.find({ type: 'Text', text: '原始草稿' })).toBeUndefined()
    await pane.press({ key: 'toggle-original' })
    expect((await pane.find({ type: 'Text', text: '原始草稿' }))?.text).toBe('原始草稿')
    await pane.press({ key: 'toggle-original' })
    expect(await pane.find({ type: 'Text', text: '原始草稿' })).toBeUndefined()
  })
}

test('the press returns before a model request, and closing cancels queued work', async ($, on) => {
  const clock = mock.clock(on)
  let requests = 0
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '测试草稿', cursor: 4 } }))
  on('session.model', () => ({ value: 'test' }))
  on('model.complete', () => { requests += 1; return { value: { isAnswered: true, text: 'Task: 测试', usage } } })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'enhance' })
  expect(requests).toBe(0)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'close' })
  await clock.advance(1)
  expect(requests).toBe(0)
})
