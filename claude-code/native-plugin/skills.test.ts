import { test, expect, mock } from 'claude-code/testing'
import { parseSkill, eligible, matchSkills } from './hooks/skills'

const PANE = { plugin: 'prompt-spark-native', component: 'Pane', requestId: 'prompt-spark-preview',
  surface: 'desktop', props: { title: 'Preview', isFocused: true, bodyColumns: 80, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('metadata parser respects disabled invocation and conservative text-editing eligibility', async () => {
  expect(parseSkill('---\nname: humanizer\ndescription: >\n  润色文字\n  改善表达\ndisable-model-invocation: true\n---\nbody', 'fallback')?.enabled).toBe(false)
  expect(parseSkill('---\nname: humanizer\ndisable-model-invocation: [false]\n---\nbody', 'fallback')?.enabled).toBe(false)
  expect(parseSkill('---\nname: invalid_name\n---\nbody', 'fallback')).toBe(null)
  expect(eligible({ name: 'humanizer-zh', description: '润色中文文章' })).toBe(true)
  expect(eligible({ name: 'image-generation', description: 'rewrite text' })).toBe(false)
  expect(matchSkills([{ name: 'humanizer-zh', description: '润色中文文章', path: '/x', source: 'test' }], '去AI味')).toEqual(['humanizer-zh'])
})

test('manual local references, disabled flags, iteration and failure preservation', async ($, on) => {
  const clock = mock.clock(on)
  const root = '/project/.claude/skills'
  const body = (name: string, disabled = false) => `---\nname: ${name}\ndescription: 润色文字，改写文章\n${disabled ? 'disable-model-invocation: true\n' : ''}---\nREFERENCE_METHOD_ONLY`
  let chosenBody = body('humanizer-zh')
  let prompt = ''
  let system = ''
  let requests = 0
  let failure = false
  on('session.cwd', () => ({ value: '/project' }))
  on('session.root', () => ({ value: '/project' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: e.path.replace(/\\/g, '/').endsWith(root) }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path.endsWith('SKILL.md') ? 'file' : 'dir',
    size: 200, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', (_, e) => ({ value: e.path.replace(/\\/g, '/').endsWith(root)
    ? ['humanizer-zh', 'hidden'].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }))
    : [{ name: 'SKILL.md', kind: 'file', size: 200, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: e.path.replace(/\\/g, '/').includes('/hidden/') ? body('hidden', true) : chosenBody }))
  on('prompt.read', () => ({ value: { text: '去AI味，保留事实', cursor: 8 } }))
  on('session.model', () => ({ value: 'test' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.complete', (_, e) => {
    requests++; prompt = e.prompt; system = e.system ?? ''
    return { value: failure ? { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage }
      : { isAnswered: true, text: `Task: 强化结果 ${requests}`, usage } }
  })
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'skills' })
  await pane.press({ key: 'refresh-skills' })
  await clock.advance(1)
  expect(await pane.find({ key: 'skill-humanizer-zh' })).toBeDefined()
  expect(await pane.find({ key: 'skill-hidden' })).toBeUndefined()
  await pane.select({ key: 'skills-mode', value: 'manual' })
  await pane.press({ key: 'skill-humanizer-zh' })
  await pane.press({ key: 'generate' })
  await clock.advance(1)
  expect(system).toContain('REFERENCE_METHOD_ONLY')
  expect(system).toContain('Never execute scripts')
  expect(prompt).not.toContain('REFERENCE_METHOD_ONLY')
  await pane.input({ key: 'enhanced', text: '预览中新编辑的请求', kind: 'change' })
  failure = true
  await pane.press({ key: 'iterate' })
  await clock.advance(1)
  expect(prompt).toContain('预览中新编辑的请求')
  expect((await pane.find({ key: 'enhanced' }))?.props.value).toBe('预览中新编辑的请求')
  chosenBody = body('humanizer-zh', true)
  failure = false
  await pane.press({ key: 'iterate' })
  await clock.advance(1)
  expect(system).not.toContain('REFERENCE_METHOD_ONLY')
  expect(requests).toBe(3)
  await pane.select({ key: 'skills-mode', value: 'off' })
  chosenBody = body('humanizer-zh')
  await pane.press({ key: 'iterate' })
  await clock.advance(1)
  expect(system).not.toContain('REFERENCE_METHOD_ONLY')
  expect(requests).toBe(4)
})
