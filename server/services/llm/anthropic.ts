/**
 * Anthropic adapter (Messages API via fetch, no SDK).
 *
 * Docs used (checked 2026-10-10):
 * - Messages / headers: https://platform.claude.com/docs/en/api/messages
 *   (`x-api-key`, `anthropic-version: 2023-06-01`)
 * - Web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 *   tool type `web_search_20260209` (see models.ts), name `web_search`,
 *   `allowed_callers: ['direct']` so no code-execution/dynamic filtering is used.
 *   Citations: text blocks carry `citations[]` of `web_search_result_location`.
 *   `pause_turn` is continued by resending the assistant turn. Usage also reports
 *   `server_tool_use.web_search_requests`, which does not fit LlmUsage (tokens
 *   only), so it is not reported.
 * - Structured outputs (GA, no beta header):
 *   https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 *   `output_config.format = { type: 'json_schema', schema }`; JSON comes back as
 *   text. Schema limits: no recursion, no numeric/string constraints,
 *   `additionalProperties` must be false on objects.
 * - Key validation: GET /v1/models
 */
import { ANTHROPIC_WEB_SEARCH_TOOL_TYPE, LLM_MODELS } from './models'
import {
  addCitation,
  ANSWER_TIMEOUT_MS,
  EXTRACT_TIMEOUT_MS,
  requestJson,
  VALIDATE_TIMEOUT_MS,
  validateResult,
} from './http'
import {
  LlmProviderError,
  type AnswerWithSearchInput,
  type ExtractStructuredInput,
  type LlmAnswer,
  type LlmCitation,
  type LlmProvider,
  type LlmStructuredResult,
} from './types'

const BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const ANSWER_MAX_TOKENS = 4096
const EXTRACT_MAX_TOKENS = 4096
/** Max times a `pause_turn` is continued before giving up */
const MAX_PAUSE_CONTINUATIONS = 4

interface AnthropicBlock {
  type: string
  text?: string
  citations?: { type?: string; url?: string; title?: string }[] | null
  [k: string]: unknown
}

interface AnthropicResponse {
  model?: string
  content?: AnthropicBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

function headers(apiKey: string) {
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
}

function post(apiKey: string, body: unknown, timeoutMs: number, signal?: AbortSignal) {
  return requestJson({
    provider: 'anthropic',
    url: `${BASE_URL}/v1/messages`,
    method: 'POST',
    headers: headers(apiKey),
    body,
    apiKey,
    timeoutMs,
    signal,
  }) as Promise<AnthropicResponse>
}

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',

  async validateKey(apiKey, signal) {
    try {
      await requestJson({
        provider: 'anthropic',
        url: `${BASE_URL}/v1/models?limit=1`,
        method: 'GET',
        headers: headers(apiKey),
        apiKey,
        timeoutMs: VALIDATE_TIMEOUT_MS,
        signal,
      })
      return { ok: true }
    } catch (err) {
      return validateResult(err)
    }
  },

  async answerWithSearch(input: AnswerWithSearchInput): Promise<LlmAnswer> {
    const model = input.model ?? LLM_MODELS.anthropic.answer
    const tool: Record<string, unknown> = {
      type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
      name: 'web_search',
      allowed_callers: ['direct'],
    }
    if (input.country) tool.user_location = { type: 'approximate', country: input.country }

    const messages: unknown[] = [{ role: 'user', content: input.prompt }]
    let text = ''
    const citations: LlmCitation[] = []
    const seen = new Set<string>()
    const usage = { inputTokens: 0, outputTokens: 0 }
    let reportedModel = model

    for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
      const res = await post(
        input.apiKey,
        { model, max_tokens: ANSWER_MAX_TOKENS, messages, tools: [tool] },
        ANSWER_TIMEOUT_MS,
        input.signal
      )
      const content = Array.isArray(res.content) ? res.content : []
      usage.inputTokens += res.usage?.input_tokens ?? 0
      usage.outputTokens += res.usage?.output_tokens ?? 0
      if (res.model) reportedModel = res.model

      for (const block of content) {
        if (block.type !== 'text') continue
        text += block.text ?? ''
        for (const c of block.citations ?? []) {
          if (c.type === 'web_search_result_location') addCitation(citations, seen, c.url, c.title)
        }
      }

      if (res.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content })
        continue
      }
      if (res.stop_reason === 'refusal') {
        throw new LlmProviderError('anthropic', 'bad_request', 'anthropic declined to answer (refusal)')
      }
      return { text, citations, usage, model: reportedModel }
    }
    throw new LlmProviderError('anthropic', 'server', 'anthropic search turn kept pausing; giving up')
  },

  async extractStructured<T>(input: ExtractStructuredInput): Promise<LlmStructuredResult<T>> {
    const model = input.model ?? LLM_MODELS.anthropic.extract
    const res = await post(
      input.apiKey,
      {
        model,
        max_tokens: EXTRACT_MAX_TOKENS,
        system: input.system,
        messages: [{ role: 'user', content: input.input }],
        output_config: { format: { type: 'json_schema', schema: input.schema } },
      },
      EXTRACT_TIMEOUT_MS,
      input.signal
    )
    if (res.stop_reason === 'refusal') {
      throw new LlmProviderError('anthropic', 'bad_request', 'anthropic declined the extraction (refusal)')
    }
    if (res.stop_reason === 'max_tokens') {
      throw new LlmProviderError('anthropic', 'bad_request', 'anthropic structured output truncated (max_tokens)')
    }
    const raw = (res.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    let data: T
    try {
      data = JSON.parse(raw) as T
    } catch {
      throw new LlmProviderError('anthropic', 'server', 'anthropic returned invalid JSON for structured output')
    }
    return {
      data,
      usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
      model: res.model ?? model,
    }
  },
}
