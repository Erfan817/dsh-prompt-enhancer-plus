export type Level = 'concise' | 'standard' | 'detailed'
export type Preview = {
  phase: 'idle' | 'busy' | 'preview' | 'error'
  level: Level
  original: string
  enhanced: string
  error: string
  stale: boolean
  sourceEpoch: number
  showOriginal: boolean
  undo: { original: string; applied: string; epoch: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-spark-native': { preview: Shaped<Preview> }
  }
}
