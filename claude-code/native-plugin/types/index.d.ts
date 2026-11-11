export type Level = 'concise' | 'standard' | 'detailed'
export type SkillEntry = { name: string; description: string; path: string; source: string }
export type SkillCatalog = { status: 'ready' | 'partial' | 'unavailable'; entries: SkillEntry[]; diagnostics: { path: string; status: string; count: number }[] }
export type ProjectFile = {
  name: string
  status: 'included' | 'missing' | 'empty' | 'skipped' | 'error'
  chars: number
  truncated: boolean
  reason: string
}
export type ProjectReport = {
  root: string
  status: 'ready' | 'partial' | 'empty' | 'unavailable'
  files: ProjectFile[]
  message: string
}
export type Preview = {
  phase: 'idle' | 'busy' | 'preview' | 'error'
  level: Level
  original: string
  enhanced: string
  error: string
  stale: boolean
  sourceEpoch: number
  sourceRoot: string
  showOriginal: boolean
  useProject: boolean
  showProject: boolean
  projectRoot: string
  projectReport: ProjectReport | null
  useSkills: boolean
  showSkills: boolean
  skillsLoading: boolean
  catalog: SkillCatalog | null
  skillNames: string[] | null
  usedSkills: string[]
  skillWarnings: string[]
  undo: { original: string; applied: string; epoch: number; root: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-spark-native': { preview: Shaped<Preview> }
  }
}
