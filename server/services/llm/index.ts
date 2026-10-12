import { anthropicProvider } from './anthropic'
import { openaiProvider } from './openai'
import type { LlmProvider, LlmProviderId } from './types'

const PROVIDERS: Record<LlmProviderId, LlmProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
}

export const LLM_PROVIDERS: { id: LlmProviderId; label: string }[] = Object.values(PROVIDERS).map(({ id, label }) => ({
  id,
  label,
}))

export function getLlmProvider(id: LlmProviderId): LlmProvider {
  const provider = PROVIDERS[id]
  if (!provider) throw new Error(`Unknown LLM provider: ${id}`)
  return provider
}

export { LLM_MODELS } from './models'
export * from './types'
