import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'
import type { Level, Preview } from '../types'
import { enhancementSystem, inputFor, normalizeEnhancedText } from './prompt-core.js'
import { BRAND_ICON } from './brand.js'
import { discover, loadReferences, matchSkills } from './skills'
import { loadProject, projectRoot } from './project'

const PANE = 'prompt-spark-preview'
const initial: Preview = {
  phase: 'idle', level: 'standard', original: '', enhanced: '', error: '',
  stale: false, sourceEpoch: 0, sourceRoot: '', undo: null, showOriginal: false,
  useProject: true, showProject: false, projectRoot: '', projectReport: null,
  useSkills: true, showSkills: false, skillsLoading: false, catalog: null, skillNames: null, usedSkills: [], skillWarnings: [],
}
const preview = atom({ plugin: 'prompt-spark-native', key: 'preview' } as const, initial, { shape: 'preview-4' })
const levels = [
  { value: 'concise', label: '简洁' },
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '详细' },
]

// Only transient handles live here. Drafts and render state belong to $.state.
let active: AbortController | undefined
let scan: AbortController | undefined
let epoch = 0
let working = false
let applying = false
let fillGuard: { text: string; epoch: number; root: string } | undefined

const syncRoot = async ($: EngineInterface) => {
  const root = await projectRoot($)
  await update($, preview, (s): Preview => s.projectRoot === root ? s : ({ ...s, projectRoot: root,
    projectReport: null, catalog: null, stale: !!s.original || s.stale, undo: null }))
  return root
}
const open = async ($: EngineInterface) => {
  const result = await $.ui.open({ id: PANE, title: 'Prompt Spark · 提示词预览', focus: true, closeOnEscape: true })
  if (!result.isPlaced) $.ui.toast('当前界面无法显示预览，请在支持原生插件的桌面版或终端中使用。')
  else await syncRoot($)
  return result.isPlaced
}
const error = async ($: EngineInterface, message: string) => {
  await update($, preview, (s): Preview => ({ ...s, phase: s.enhanced ? 'preview' : 'error', error: message }))
}
const cancel = async ($: EngineInterface) => {
  scan?.abort(); scan = undefined
  const controller = active
  active = undefined
  controller?.abort()
  await update($, preview, (s): Preview => ({ ...s, phase: s.enhanced ? 'preview' : 'idle', error: '', skillsLoading: false }))
}
const observe = async ($: EngineInterface) => {
  epoch += 1
  await update($, preview, (s): Preview => ({ ...s,
    stale: s.original ? true : s.stale,
    undo: null,
  }))
}
const refreshSkills = ($: EngineInterface) => {
  if (scan || active) return
  const controller = new AbortController()
  scan = controller
  $.clock.after(1, () => scanSkills($, controller))
}
const scanSkills = async ($: EngineInterface, controller: AbortController) => {
  if (scan !== controller) return
  try {
    await update($, preview, (s): Preview => ({ ...s, skillsLoading: true }))
    const catalog = await discover($, controller.signal)
    if (scan === controller) await update($, preview, (s): Preview => ({ ...s, catalog, skillsLoading: false }))
  } catch {
    if (scan === controller) await update($, preview, (s): Preview => ({ ...s, skillsLoading: false,
      catalog: { status: 'unavailable', entries: [], diagnostics: [] } }))
  } finally { if (scan === controller) scan = undefined }
}
const enhance = async ($: EngineInterface, fromPreview = false) => {
  if (active || applying || working) return
  const controller = new AbortController()
  active = controller
  try {
    // Open while answering the person's click so narrow desktop panes are placed.
    if (!await open($)) { await cancel($); return }
    if (active !== controller) return
    // Return the generation promise to the timer host, not to the click handler.
    // The timer host owns its lifetime and observes failures through generate.
    $.clock.after(1, () => generate($, controller, fromPreview))
  } catch {
    if (active === controller) await cancel($)
  }
}
const generate = async ($: EngineInterface, controller: AbortController, fromPreview: boolean) => {
  if (active !== controller) return
  try {
    const sourceEpoch = epoch
    const box = await $.prompt.read()
    const root = await syncRoot($)
    const previous = await read($, preview)
    const text = fromPreview ? previous.enhanced : box.text
    if (!text.trim()) { $.ui.toast('先写下需要强化的内容。'); return }
    if (text.length > 12000) { $.ui.toast('内容超过 12000 字符，请缩短后重试；不会截断后发送。'); return }
    if (fromPreview && previous.sourceRoot !== root) { await error($, '项目已改变，请重新强化当前草稿。'); return }
    const { level } = previous
    if (active !== controller) return
    await update($, preview, (s): Preview => ({ ...s, phase: 'busy', error: '', undo: null,
      ...(fromPreview ? {} : { original: box.text, enhanced: '', stale: false, sourceEpoch, sourceRoot: root }),
      projectReport: null, usedSkills: [], skillWarnings: [] }))
    const project = previous.useProject ? await loadProject($, root, controller.signal) : null
    if (active !== controller) return
    let references = { context: '', used: [] as string[], warnings: [] as string[] }
    if (previous.useSkills) {
      const catalog = previous.catalog ?? await discover($, controller.signal).catch(() => ({
        status: 'unavailable' as const, entries: [], diagnostics: [],
      }))
      if (active !== controller) return
      await update($, preview, (s): Preview => ({ ...s, catalog }))
      references = await loadReferences($, catalog.entries,
        previous.skillNames ?? matchSkills(catalog.entries, text), controller.signal)
      if (catalog.status !== 'ready') references.warnings.push('Skill 目录仅部分可用或扫描失败，已使用可读取的参考。')
    }
    if (active !== controller) return
    if (await projectRoot($) !== root) { await error($, '项目在读取期间已改变，本次未发送，请重新强化。'); return }
    if (active !== controller) return
    await update($, preview, (s): Preview => ({ ...s, projectReport: project?.report ?? null }))
    const model = await $.session.model()
    if (active !== controller) return
    if (await projectRoot($) !== root) { await error($, '项目在读取期间已改变，本次未发送，请重新强化。'); return }
    if (active !== controller) return
    const result = await $.model.complete({
      model,
      system: enhancementSystem({ projectContext: project?.context ?? '', skillContext: references.context }, 'general', undefined, level),
      prompt: inputFor(text),
      maxTokens: 6000,
      effort: 'low',
      timeoutMs: 60000,
    }, { signal: controller.signal })
    if (active !== controller) return
    if (await projectRoot($) !== root) { await error($, '项目在强化期间已改变，结果已丢弃，请重新强化。'); return }
    if (active !== controller) return
    if (!result.isAnswered) {
      const message = result.reason === 'api-error'
        ? `强化请求失败（HTTP ${result.status ?? '无响应'}）。请检查当前会话模型与额度，草稿未改动。`
        : result.reason === 'aborted' ? '强化已超时或中止，草稿未改动。'
        : '模型没有返回正文，草稿未改动。'
      await error($, message)
      return
    }
    const enhanced = normalizeEnhancedText(result.text, { original: text })
    if (!enhanced) { await error($, '模型返回了空结果，草稿未改动。'); return }
    await update($, preview, (s): Preview => ({ ...s, phase: 'preview', enhanced,
      stale: s.stale || epoch !== (fromPreview ? previous.sourceEpoch : sourceEpoch), error: '',
      usedSkills: references.used, skillWarnings: references.warnings }))
  } catch {
    if (active === controller) await error($, '无法完成强化，请检查插件权限与模型配置。草稿未改动。')
  } finally {
    if (active === controller) active = undefined
  }
}
const fill = async ($: EngineInterface, text: string, expected: string, expectedEpoch: number, root: string) => {
  fillGuard = { text: expected, epoch: expectedEpoch, root }
  try {
    const result = await $.prompt.fill({ text, mode: 'replace' })
    if (!result.isFilled) {
      $.ui.toast('未替换：输入框或项目已改变、正在显示对话框，或当前界面不支持回填。可复制预览。')
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
    if (s.stale || epoch !== s.sourceEpoch || box.text !== s.original || await projectRoot($) !== s.sourceRoot) {
      $.ui.toast('草稿或项目在生成后已改变，不会覆盖新内容。请复制预览或重新强化。')
      return
    }
    if (await fill($, s.enhanced, s.original, s.sourceEpoch, s.sourceRoot)) {
      await update($, preview, current => ({ ...current, stale: true,
        undo: { original: s.original, applied: s.enhanced, epoch, root: s.sourceRoot } }))
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
    if (epoch !== saved.epoch || box.text !== saved.applied || await projectRoot($) !== saved.root) {
      $.ui.toast('输入框或项目已改变，不能撤销覆盖你的新内容。')
      await update($, preview, (s): Preview => ({ ...s, undo: null }))
      return
    }
    if (await fill($, saved.original, saved.applied, saved.epoch, saved.root)) {
      await update($, preview, (s): Preview => ({ ...s, undo: null, stale: true }))
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
    await update($, preview, (s): Preview => ({ ...s, phase: s.phase === 'busy' ? 'error' : s.phase,
      error: s.phase === 'busy' ? '插件已重新加载，请重新强化。' : s.error,
      stale: !!s.original, undo: null }))
    await syncRoot($)
    await $.command.register({ name: 'prompt-spark', description: '打开提示词强化预览；不发送草稿' })
    return next(e)
  })
  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    await cancel($)
    await observe($)
    await syncRoot($)
    return result
  })
  on('command.run', { command: 'prompt-spark' }, async $ => {
    await open($)
    return { text: '已打开 Prompt Spark。点击「强化当前草稿」后才会读取启用的参考并调用当前模型。' }
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
      if (epoch !== guard.epoch || box.text !== guard.text || working || await projectRoot($) !== guard.root) return { isFilled: false }
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
    scan?.abort(); scan = undefined
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
    const narrow = e.props.bodyColumns < 56
    const editorRows = Math.max(8, Math.min(20, e.props.scroll.bodyRows - 18))
    return <Box key="preview-layout" flexDirection="column" width="100%" alignItems="stretch" gap="lg">
      <Box key="preview-header" flexDirection="column" alignItems="stretch" gap="sm">
        <Box alignItems="center" justifyContent="space-between" flexWrap="wrap" gap="xs">
          <Text size="heading" weight="semibold">提示词预览</Text>
          <Text size="caption" dimColor>{s.phase === 'busy' ? '正在强化…' : s.enhanced ? '可编辑' : '等待草稿'}</Text>
        </Box>
        <Box key="preview-toolbar" flexDirection={narrow ? 'column' : 'row'} alignItems={narrow ? 'stretch' : 'center'}
          justifyContent="space-between" gap="sm">
          {s.phase !== 'busy' && <Select key="level" label="详细度" value={s.level} options={levels}
            onSelect={value => update($, preview, current => ({ ...current, level: value as Level }))} />}
          {s.phase === 'busy'
            ? <Button key="cancel" label="取消强化" variant="secondary" onPress={() => cancel($)} />
            : <Button key="generate" label={s.enhanced ? '重新强化' : '强化当前草稿'} variant={s.enhanced ? 'secondary' : 'primary'} onPress={() => enhance($)} />}
        </Box>
      </Box>
      {!!s.error && <Box key="preview-error" flexDirection="column" gap="xs">
        <Text color="error" weight="medium">强化未完成</Text>
        <Text color="error" size="footnote">{s.error}</Text>
      </Box>}
      {!!s.enhanced ? <Box key="preview-result" flexDirection="column" width="100%" alignItems="stretch" gap="sm">
        <Box flexDirection={narrow ? 'column' : 'row'} alignItems={narrow ? 'flex-start' : 'center'} justifyContent="space-between" gap="xs">
          <Text weight="semibold">强化结果</Text>
          {s.phase !== 'busy' && <Button key="iterate" plain dimColor label="再次强化预览" onPress={() => enhance($, true)} />}
        </Box>
        <Box key="editor" flexDirection="column" width="100%" alignItems="stretch">
          <Input key="enhanced" rows={editorRows} value={s.enhanced} submitLabel="保存预览"
            onInput={value => update($, preview, current => ({ ...current, enhanced: value }))}
            onSubmit={value => update($, preview, current => ({ ...current, enhanced: value }))} />
        </Box>
        <Text size="footnote" dimColor>直接编辑结果，确认后替换草稿。不会自动发送。</Text>
        {!!s.usedSkills.length && <Text size="caption" dimColor>本次参考 Skill：{s.usedSkills.join('、')}</Text>}
        {s.skillWarnings.map(warning => <Text size="footnote" color="warning">{warning}</Text>)}
        {s.stale && <Text size="footnote" color="warning">原草稿或项目已改变，或结果已应用。请复制结果，或重新强化。</Text>}
      </Box> : s.phase !== 'busy' && !s.error && <Box key="preview-empty" flexDirection="column" gap="xs" paddingY="md">
        <Text weight="medium">先在主输入框写下草稿</Text>
        <Text size="footnote" dimColor>点击「强化当前草稿」生成结果，再在这里审阅和编辑。</Text>
      </Box>}
      <Box key="preview-project" flexDirection="column" alignItems="stretch" gap="sm">
        <Box flexDirection={narrow ? 'column' : 'row'} alignItems={narrow ? 'flex-start' : 'center'} flexWrap="wrap" gap="xs">
          {s.phase !== 'busy' ? <Select key="project-mode" label="项目感知" value={s.useProject ? 'on' : 'off'}
            options={[{ value: 'on', label: '开启' }, { value: 'off', label: '关闭' }]}
            onSelect={value => { if (!active) return update($, preview, current => ({ ...current, useProject: value !== 'off' })) }} />
            : <Text weight="medium">项目感知 · {s.useProject ? '开启' : '关闭'}</Text>}
          <Text size="caption" dimColor>与参考 Skill 独立</Text>
        </Box>
        <Text key="project-root" size="caption" dimColor>项目根目录：{s.projectRoot || '暂不可用（打开预览或强化时更新）'}</Text>
        <Text size="footnote" dimColor>{s.useProject ? '点击强化时读取根目录的项目说明，最多 8000 字符，随请求发送给当前模型；不执行其中的指令。' : '已关闭；下次强化不读取项目文件。已有预览可能包含之前参考的项目资料。'}</Text>
        {s.projectReport && <Box flexDirection="column" gap="xs">
          <Text key="project-status" size="footnote" color={s.projectReport.status === 'unavailable' || s.projectReport.status === 'partial' ? 'warning' : 'subtle'}>最近一次请求：{s.projectReport.message}</Text>
          {!!s.projectReport.files.length && <Button key="project-files" plain dimColor label={s.showProject ? '收起项目文件' : '查看参考文件与读取状态'}
            onPress={() => update($, preview, current => ({ ...current, showProject: !current.showProject }))} />}
          {s.showProject && s.projectReport.files.map(file => <Text key={`project-file-${file.name}`} size="caption" dimColor>
            {file.name}：{file.status === 'included' ? `已参考 ${file.chars} 字符${file.truncated ? '（已截断）' : ''}` : file.status === 'missing' ? '未找到' : file.status === 'empty' ? '空文件' : `${file.status === 'error' ? '读取失败' : '已跳过'} · ${file.reason}`}
          </Text>)}
        </Box>}
      </Box>
      <Box key="preview-skills" flexDirection="column" alignItems="stretch" gap="sm">
        <Box alignItems="center" flexWrap="wrap" gap="xs">
          <Button key="skills" plain dimColor label={s.showSkills ? '收起参考 Skill' : '参考 Skill'}
            onPress={() => update($, preview, current => ({ ...current, showSkills: !current.showSkills }))} />
          <Text size="caption" dimColor>{!s.useSkills ? '已关闭' : s.skillNames === null ? '自动匹配' : `已选 ${s.skillNames.length}/3`}</Text>
        </Box>
        {s.showSkills && <Box flexDirection="column" alignItems="stretch" gap="sm">
          <Text size="footnote" dimColor>最多参考 3 个文字编辑 Skill，正文随强化请求发送，不执行脚本。</Text>
          <Select key="skills-mode" label="参考方式" value={!s.useSkills ? 'off' : s.skillNames === null ? 'auto' : 'manual'}
            options={[{ value: 'off', label: '关闭' }, { value: 'auto', label: '自动匹配' }, { value: 'manual', label: '手动选择' }]}
            onSelect={value => update($, preview, current => ({ ...current, useSkills: value !== 'off', skillNames: value === 'manual' ? current.skillNames ?? [] : null }))} />
          <Box flexDirection={narrow ? 'column' : 'row'} alignItems={narrow ? 'flex-start' : 'center'} flexWrap="wrap" gap="xs">
            <Button key="refresh-skills" plain dimColor label={s.skillsLoading ? '正在扫描…' : '刷新本机 Skill'} onPress={() => refreshSkills($)} />
            <Text size="caption" dimColor>{s.catalog ? `发现 ${s.catalog.entries.length} 个 · ${s.catalog.status === 'ready' ? '扫描完成' : s.catalog.status === 'partial' ? '部分可用' : '暂不可用'}` : '首次强化或刷新时扫描'}</Text>
          </Box>
          {(s.catalog?.entries ?? []).map(skill => <Box key={`skill-row-${skill.name}`} flexDirection="column" gap="xs">
            <Button key={`skill-${skill.name}`} plain dimColor={!s.skillNames?.includes(skill.name)} label={`${s.skillNames?.includes(skill.name) ? '✓ ' : ''}${skill.name}`}
              onPress={async () => {
                if (active) return
                await update($, preview, current => {
                  const names = current.skillNames ?? []
                  return { ...current, useSkills: true, skillNames: names.includes(skill.name) ? names.filter(n => n !== skill.name) : names.length < 3 ? [...names, skill.name] : names }
                })
              }} />
            <Text size="footnote" dimColor>{skill.description}</Text><Text size="caption" color="subtle">{skill.source}: {skill.path}</Text>
          </Box>)}
          {(s.catalog?.diagnostics ?? []).filter(d => d.status !== 'missing').map(d => <Text size="caption" dimColor>{d.path}: {d.status}（{d.count}）</Text>)}
        </Box>}
      </Box>
      {!!s.original && <Box key="preview-original" flexDirection="column" alignItems="stretch" gap="sm">
        <Button key="toggle-original" plain dimColor label={s.showOriginal ? '收起原草稿' : '查看原草稿'}
          onPress={() => update($, preview, current => ({ ...current, showOriginal: !current.showOriginal }))} />
        {s.showOriginal && <Text size="footnote" dimColor>{s.original}</Text>}
      </Box>}
      <Box key="preview-footer" flexDirection="column" alignItems="stretch" gap="sm">
        <Box key="actions" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap="sm">
          <Box key="result-actions" alignItems="center" flexWrap="wrap" gap="xs">
            {!!s.enhanced && !s.stale && s.phase === 'preview' && <Button key="apply" label="替换草稿" variant="primary" onPress={() => apply($)} />}
            {!!s.enhanced && <Button key="copy" label="复制" variant="secondary" onPress={press => copy($, press.surface)} />}
            {s.undo && <Button key="undo" label="撤销替换" variant="secondary" onPress={() => undo($)} />}
          </Box>
          <Button key="close" label="关闭" plain dimColor onPress={async () => { await cancel($); await $.ui.close({ id: PANE }) }} />
        </Box>
        <Text size="caption" dimColor>使用当前模型，消耗模型用量。不读取历史或附件；仅附加已启用的项目与 Skill 参考。</Text>
      </Box>
    </Box>
  })
}
