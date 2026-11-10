import { test, expect, mock } from 'claude-code/testing'

const PANE = { plugin: 'prompt-spark-native', component: 'Pane', requestId: 'prompt-spark-preview',
  surface: 'desktop', props: { title: 'Preview', isFocused: true, bodyColumns: 80, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('references honor total budgets and never load resource scripts', async ($, on) => {
  const clock = mock.clock(on)
  const root = '/project/.claude/skills'
  const names = ['humanizer-a', 'humanizer-b', 'humanizer-c', 'humanizer-d']
  let system = ''
  let reads = 0
  on('session.cwd', () => ({ value: '/project' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: e.path.replace(/\\/g, '/').endsWith(root) }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path.endsWith('SKILL.md') ? 'file' : 'dir', size: 30000, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', (_, e) => ({ value: e.path.replace(/\\/g, '/').endsWith(root)
    ? names.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }))
    : [{ name: 'SKILL.md', kind: 'file', size: 30000, mtimeMs: 0, isLink: false },
       { name: 'scripts', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => {
    reads++
    const name = e.path.replace(/\\/g, '/').split('/').at(-2)!
    return { value: `---\nname: ${name}\ndescription: 润色文字\n---\n${'字'.repeat(9000)}` }
  })
  on('prompt.read', () => ({ value: { text: names.join(' '), cursor: 0 } }))
  on('session.model', () => ({ value: 'test' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', (_, e) => { system = e.system ?? ''; return { value: { isAnswered: true, text: 'Task: 结果', usage } } })
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'generate' })
  await clock.advance(1)
  expect(system).toContain('"name":"humanizer-a"')
  expect(system).toContain('"name":"humanizer-b"')
  expect(system).not.toContain('"name":"humanizer-c"')
  expect(system).toContain('"truncated":true')
  expect(reads).toBe(6) // four discovery reads plus two selected references, no scripts
})
