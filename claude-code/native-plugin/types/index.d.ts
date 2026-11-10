export type Level = 'concise' | 'standard' | 'detailed'
export type SkillEntry = { name: string; description: string; path: string; source: string }
export type SkillCatalog = { status: 'ready' | 'partial' | 'unavailable'; entries: SkillEntry[]; diagnostics: { path: string; status: string; count: number }[] }
export type Preview = {
  phase: 'idle' | 'busy' | 'preview' | 'error'
  level: Level
  original: string
  enhanced: string
  error: string
  stale: boolean
  sourceEpoch: number
  showOriginal: boolean
  useSkills: boolean
  showSkills: boolean
  skillsLoading: boolean
  catalog: SkillCatalog | null
  skillNames: string[] | null
  usedSkills: string[]
  skillWarnings: string[]
  undo: { original: string; applied: string; epoch: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-spark-native': { preview: Shaped<Preview> }
  }
}
