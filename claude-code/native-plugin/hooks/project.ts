import type { EngineInterface } from 'claude-code'
import type { ProjectFile, ProjectReport } from '../types'

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.zh.md', 'package.json']
const PER_FILE = 6000
const TOTAL = 8000
const MAX_BYTES = PER_FILE * 8
const check = (signal: AbortSignal) => { if (signal.aborted) throw new Error('cancelled') }

// No path library or Node in a function hook. Accept local absolute roots only;
// never turn an unavailable project into the plugin's or process's directory.
const localPath = (value: string): string | undefined => {
  const path = value.replace(/\\/g, '/')
  if (!path || /[\u0000-\u001f]/.test(path) || path.startsWith('//') || !/^(?:[a-z]:\/|\/)/i.test(path)) return
  const tail = /^[a-z]:/i.test(path) ? path.slice(2) : path
  if (tail.includes(':') || tail.split('/').some(part => part === '.' || part === '..')) return
  return path.replace(/\/+$/, '') || '/'
}
const identity = (path: string) => /^[a-z]:/i.test(path) ? path.toLowerCase() : path
const join = (root: string, name: string) => `${root === '/' ? '' : root}/${name}`

export async function projectRoot($: EngineInterface) {
  try { return await $.session.root() } catch { return '' }
}

export async function loadProject($: EngineInterface, root: string, signal: AbortSignal): Promise<{ context: string; report: ProjectReport }> {
  const report: ProjectReport = { root, status: 'unavailable', files: [], message: '' }
  const unavailable = (message: string) => { report.message = message; return { context: '', report } }
  check(signal)
  const requested = localPath(root)
  if (!requested) return unavailable('未取得可用的本机项目根目录；本次不附加项目资料。')
  let canonical: string
  try {
    const stat = await $.fs.stat(root, { resolve: true })
    check(signal)
    const real = stat.realPath && localPath(stat.realPath)
    if (stat.kind !== 'dir' || !real) return unavailable('项目根目录不可用或不是本机目录；本次不附加项目资料。')
    canonical = real
  } catch {
    check(signal)
    return unavailable('无法读取项目根目录，请检查宿主权限；本次不附加项目资料。')
  }
  const parts: string[] = []
  let total = 0
  for (const name of CANDIDATES) {
    check(signal)
    const file: ProjectFile = { name, status: 'missing', chars: 0, truncated: false, reason: '' }
    report.files.push(file)
    if (total >= TOTAL) { file.status = 'skipped'; file.reason = '已达总字符上限'; continue }
    try {
      const path = join(canonical, name)
      const exists = await $.fs.exists(path)
      check(signal)
      if (!exists) continue
      const stat = await $.fs.stat(path, { resolve: true })
      check(signal)
      const real = stat.realPath && localPath(stat.realPath)
      if (stat.isLink || stat.kind !== 'file' || !real || identity(real) !== identity(path)) {
        file.status = 'skipped'; file.reason = '不是普通项目文件，或链接指向其他位置'; continue
      }
      if (!Number.isFinite(stat.size) || stat.size < 0 || stat.size > MAX_BYTES) {
        file.status = 'skipped'; file.reason = '文件超过 48000 字节或大小不可用'; continue
      }
      // Read the checked canonical location, not a link spelling of the root.
      const text = await $.fs.read(real)
      check(signal)
      if (new TextEncoder().encode(text).length > MAX_BYTES || text.includes('\u0000')) {
        file.status = 'skipped'; file.reason = '文件过大或不是纯文本'; continue
      }
      const content = text.trim()
      if (!content) { file.status = 'empty'; continue }
      const body = content.slice(0, Math.min(PER_FILE, TOTAL - total))
      file.status = 'included'; file.chars = body.length; file.truncated = body.length < content.length
      total += body.length
      parts.push(`### ${name}\n${body}`)
    } catch {
      check(signal)
      file.status = 'error'; file.reason = '读取失败或权限不足'
    }
  }
  const incomplete = report.files.some(file => file.status === 'error' || file.status === 'skipped' || file.truncated)
  report.status = parts.length ? incomplete ? 'partial' : 'ready' : incomplete ? 'unavailable' : 'empty'
  report.message = parts.length ? `已参考 ${parts.length} 个文件，共 ${total} 字符${incomplete ? '（部分内容未纳入）' : ''}。`
    : incomplete ? '项目资料不可用；本次未附加项目内容。' : '当前项目没有可参考的说明文件；本次仅强化草稿。'
  return { context: parts.join('\n\n'), report }
}
