/**
 * LLM provider contract for the marketing module (AI visibility).
 *
 * Teams bring their own keys: every call takes the team's decrypted API key as
 * an argument and adapters never store it. Adapters use `fetch` directly — no
 * provider SDKs.
 */

export type LlmProviderId = 'anthropic' | 'openai'

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  /** Billed web search calls (answers only); optional so existing callers stay valid */
  webSearchRequests?: number
}

export interface LlmCitation {
  url: string
  title?: string
}

export interface LlmAnswer {
  /** Final answer text shown to the end user */
  text: string
  /** Sources the model cited via its web search tool, de-duplicated by URL */
  citations: LlmCitation[]
  usage: LlmUsage
  /** Model ID the provider reports it actually used */
  model: string
}

export interface LlmStructuredResult<T> {
  data: T
  usage: LlmUsage
  model: string
}

export type LlmErrorKind = 'auth' | 'rate_limit' | 'bad_request' | 'server' | 'network' | 'timeout' | 'quota'

/**
 * Thrown by adapters for every provider failure. `kind === 'auth'` means the
 * team's key is invalid or revoked: callers mark the credential invalid and
 * pause runs for that provider. `kind === 'quota'` means the account is out of
 * credit/quota (not retryable, key is fine).
 */
export class LlmProviderError extends Error {
  constructor(
    readonly provider: LlmProviderId,
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LlmProviderError'
  }
}

export interface KeyValidationResult {
  ok: boolean
  /** Present when `ok` is false */
  kind?: LlmErrorKind
  message?: string
}

export interface AnswerWithSearchInput {
  apiKey: string
  prompt: string
  /** Defaults to the provider's answer model from `models.ts` */
  model?: string
  /** Optional ISO country/locale hint for the search tool, e.g. 'US' */
  country?: string
  signal?: AbortSignal
}

export interface ExtractStructuredInput {
  apiKey: string
  /** Instructions for the extraction */
  system: string
  /** Text to extract from */
  input: string
  /** JSON Schema (draft 2020-12 subset) the output must satisfy */
  schema: Record<string, unknown>
  schemaName: string
  /** Defaults to the provider's small extraction model from `models.ts` */
  model?: string
  signal?: AbortSignal
}

export interface LlmProvider {
  id: LlmProviderId
  label: string
  /** One cheap call (e.g. list models) to check the key works */
  validateKey(apiKey: string, signal?: AbortSignal): Promise<KeyValidationResult>
  /** Answer a user prompt the way the consumer assistant would, with web search enabled */
  answerWithSearch(input: AnswerWithSearchInput): Promise<LlmAnswer>
  /** Return JSON matching `schema` (parsed, not validated beyond JSON.parse) */
  extractStructured<T>(input: ExtractStructuredInput): Promise<LlmStructuredResult<T>>
}
