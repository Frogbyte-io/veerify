/**
 * Perplexity adapter (Agent API via fetch, no SDK).
 *
 * Docs used (checked 2026-10-10):
 * - Sonar Chat Completions support ended 2026-09-27 and was replaced by the Agent
 *   API: https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md
 *   so this adapter calls `POST https://api.perplexity.ai/v1/agent`.
 * - Quickstart / response shape: https://docs.perplexity.ai/docs/agent-api/quickstart.md
 *   body `{ model, input, instructions, tools: [{ type: 'web_search' }] }`; response has
 *   `output_text`, `output[]` (items of type `search_results` with `results[]`, and
 *   `message` items whose `output_text` parts may carry `url_citation` annotations),
 *   `usage { input_tokens, output_tokens, tool_calls_details.search_web.invocation }`.
 * - Structured output: https://docs.perplexity.ai/docs/agent-api/building-agents/shape-output.md
 *   `response_format: { type: 'json_schema', json_schema: { name, schema } }`; the JSON
 *   is read from `output_text`. The first request with a new schema can take 10-30s.
 * - Key validation: `GET /v1/models` (quickstart: "lowest-cost verification method").
 * - Pricing: https://docs.perplexity.ai/docs/getting-started/pricing.md
 *
 * Caveat: the docs pages fetched did not show an exact `web_search` country field,
 * so `country` is not sent.
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

const BASE_URL = 'https://api.perplexity.ai'

/** Agent API `max_output_tokens` (int, min 1; confirmed in the /v1/agent request reference). */
export const PERPLEXITY_ANSWER_MAX_OUTPUT_TOKENS = 2048
export const PERPLEXITY_EXTRACT_MAX_OUTPUT_TOKENS = 1024

interface PerplexityOutputItem {
  type: string
  results?: { url?: string; title?: string }[]
  content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[]
}

interface PerplexityResponse {
  model?: string
  status?: string
  error?: { message?: string } | null
  output_text?: string
  output?: PerplexityOutputItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    tool_calls_details?: { search_web?: { invocation?: number } }
  }
}

function headers(apiKey: string) {
  return { authorization: `Bearer ${apiKey}` }
}

async function createResponse(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PerplexityResponse> {
  const res = (await requestJson({
    provider: 'perplexity',
    url: `${BASE_URL}/v1/agent`,
    method: 'POST',
    headers: headers(apiKey),
    body,
    apiKey,
    timeoutMs,
    signal,
  })) as PerplexityResponse
  if (res.status === 'failed' || res.error) {
    const msg = (res.error?.message ?? 'unknown').split(apiKey).join('[redacted]').slice(0, 300)
    throw new LlmProviderError('perplexity', 'server', `perplexity response failed: ${msg}`)
  }
  return res
}

function textOf(res: PerplexityResponse): string {
  if (typeof res.output_text === 'string') return res.output_text
  return (res.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? '')
    .join('')
}

function usageOf(res: PerplexityResponse) {
  return { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }
}

/** Prefer sources cited inline; fall back to every search result the model saw. */
function citationsOf(res: PerplexityResponse): LlmCitation[] {
  const citations: LlmCitation[] = []
  const seen = new Set<string>()
  for (const item of res.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      for (const a of part.annotations ?? []) {
        if (a.type === 'url_citation') addCitation(citations, seen, a.url, a.title)
      }
    }
  }
  if (citations.length > 0) return citations
  for (const item of res.output ?? []) {
    if (item.type !== 'search_results') continue
    for (const r of item.results ?? []) addCitation(citations, seen, r.url, r.title)
  }
  return citations
}

export const perplexityProvider: LlmProvider = {
  id: 'perplexity',
  label: 'Perplexity',

  async validateKey(apiKey, signal) {
    try {
      await requestJson({
        provider: 'perplexity',
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
    const model = input.model ?? LLM_MODELS.perplexity.answer
    const res = await createResponse(
      input.apiKey,
      {
        model,
        input: input.prompt,
        tools: [{ type: 'web_search' }],
        max_output_tokens: PERPLEXITY_ANSWER_MAX_OUTPUT_TOKENS,
      },
      ANSWER_TIMEOUT_MS,
      input.signal
    )
    if (res.status === 'incomplete') {
      throw new LlmProviderError('perplexity', 'bad_request', 'Answer was truncated (incomplete)')
    }
    return {
      text: textOf(res),
      citations: citationsOf(res),
      usage: { ...usageOf(res), webSearchRequests: res.usage?.tool_calls_details?.search_web?.invocation ?? 0 },
      model: res.model ?? model,
    }
  },

  async extractStructured<T>(input: ExtractStructuredInput): Promise<LlmStructuredResult<T>> {
    const model = input.model ?? LLM_MODELS.perplexity.extract
    const res = await createResponse(
      input.apiKey,
      {
        model,
        instructions: input.system,
        input: input.input,
        max_output_tokens: PERPLEXITY_EXTRACT_MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_schema', json_schema: { name: input.schemaName, schema: input.schema } },
      },
      // the first use of a new schema can take 10-30s to prepare
      Math.max(EXTRACT_TIMEOUT_MS, 60_000),
      input.signal
    )
    if (res.status === 'incomplete') {
      throw new LlmProviderError('perplexity', 'bad_request', 'perplexity structured output incomplete')
    }
    let data: T
    try {
      data = JSON.parse(textOf(res)) as T
    } catch {
      throw new LlmProviderError('perplexity', 'server', 'perplexity returned invalid JSON for structured output')
    }
    return { data, usage: usageOf(res), model: res.model ?? model }
  },
}
