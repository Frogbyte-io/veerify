/**
 * OpenAI adapter (Responses API via fetch, no SDK).
 *
 * Docs used (checked 2026-10-10):
 * - Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create
 *   POST /v1/responses; usage = { input_tokens, output_tokens }
 * - Web search tool: https://developers.openai.com/api/docs/guides/tools-web-search
 *   tool `{ type: 'web_search', user_location: { type: 'approximate', country } }`;
 *   message output items hold `output_text` parts whose `annotations` include
 *   `{ type: 'url_citation', url, title }`.
 * - Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
 *   `text.format = { type: 'json_schema', name, schema, strict: true }`.
 *   Strict mode requires: root type `object`; `additionalProperties: false` on
 *   every object; EVERY property listed in `required` (model optional fields as a
 *   `['string','null']` type union); only the supported keyword subset. Refusals
 *   arrive as a `refusal` content part instead of output_text.
 * - Key validation: GET /v1/models
 */
import { LLM_MODELS } from './models'
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

const BASE_URL = 'https://api.openai.com'
/** Cost control: Responses API `max_tool_calls` caps built-in tool calls (searches are billed per call) */
const WEB_SEARCH_MAX_CALLS = 5

interface OpenAiContentPart {
  type: string
  text?: string
  refusal?: string
  annotations?: { type?: string; url?: string; title?: string }[]
}

interface OpenAiResponse {
  model?: string
  status?: string
  error?: { message?: string } | null
  incomplete_details?: { reason?: string } | null
  output?: { type: string; content?: OpenAiContentPart[] }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

function headers(apiKey: string) {
  return { authorization: `Bearer ${apiKey}` }
}

async function createResponse(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<OpenAiResponse> {
  const res = (await requestJson({
    provider: 'openai',
    url: `${BASE_URL}/v1/responses`,
    method: 'POST',
    headers: headers(apiKey),
    body: { ...body, store: false },
    apiKey,
    timeoutMs,
    signal,
  })) as OpenAiResponse
  if (res.status === 'failed' || res.error) {
    const msg = (res.error?.message ?? 'unknown').slice(0, 300)
    throw new LlmProviderError('openai', 'server', `openai response failed: ${msg}`)
  }
  return res
}

function parts(res: OpenAiResponse): OpenAiContentPart[] {
  return (res.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
}

function usageOf(res: OpenAiResponse) {
  return { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }
}

function searchCalls(res: OpenAiResponse): number {
  return (res.output ?? []).filter((o) => o.type === 'web_search_call').length
}

export const openaiProvider: LlmProvider = {
  id: 'openai',
  label: 'OpenAI',

  async validateKey(apiKey, signal) {
    try {
      await requestJson({
        provider: 'openai',
        url: `${BASE_URL}/v1/models`,
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
    const model = input.model ?? LLM_MODELS.openai.answer
    const tool: Record<string, unknown> = { type: 'web_search' }
    if (input.country) tool.user_location = { type: 'approximate', country: input.country }

    const res = await createResponse(
      input.apiKey,
      { model, input: input.prompt, tools: [tool], max_tool_calls: WEB_SEARCH_MAX_CALLS },
      ANSWER_TIMEOUT_MS,
      input.signal
    )

    if (res.status === 'incomplete') {
      throw new LlmProviderError(
        'openai',
        'bad_request',
        `Answer was truncated (${res.incomplete_details?.reason ?? 'incomplete'})`
      )
    }

    let text = ''
    const citations: LlmCitation[] = []
    const seen = new Set<string>()
    for (const part of parts(res)) {
      if (part.type === 'output_text') {
        text += part.text ?? ''
        for (const a of part.annotations ?? []) {
          if (a.type === 'url_citation') addCitation(citations, seen, a.url, a.title)
        }
      } else if (part.type === 'refusal') {
        throw new LlmProviderError('openai', 'bad_request', 'openai declined to answer (refusal)')
      }
    }
    return {
      text,
      citations,
      usage: { ...usageOf(res), webSearchRequests: searchCalls(res) },
      model: res.model ?? model,
    }
  },

  /**
   * `input.schema` must satisfy OpenAI strict mode: root `type: 'object'`,
   * `additionalProperties: false` on every object, all properties in `required`
   * (use `type: ['string', 'null']` for optional values).
   */
  async extractStructured<T>(input: ExtractStructuredInput): Promise<LlmStructuredResult<T>> {
    const model = input.model ?? LLM_MODELS.openai.extract
    const res = await createResponse(
      input.apiKey,
      {
        model,
        instructions: input.system,
        input: input.input,
        text: { format: { type: 'json_schema', name: input.schemaName, schema: input.schema, strict: true } },
      },
      EXTRACT_TIMEOUT_MS,
      input.signal
    )
    if (res.status === 'incomplete') {
      throw new LlmProviderError(
        'openai',
        'bad_request',
        `openai structured output incomplete (${res.incomplete_details?.reason ?? 'unknown'})`
      )
    }
    let raw = ''
    for (const part of parts(res)) {
      if (part.type === 'refusal') {
        throw new LlmProviderError('openai', 'bad_request', 'openai declined the extraction (refusal)')
      }
      if (part.type === 'output_text') raw += part.text ?? ''
    }
    let data: T
    try {
      data = JSON.parse(raw) as T
    } catch {
      throw new LlmProviderError('openai', 'server', 'openai returned invalid JSON for structured output')
    }
    return { data, usage: usageOf(res), model: res.model ?? model }
  },
}
