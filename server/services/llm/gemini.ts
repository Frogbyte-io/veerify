/**
 * Google Gemini adapter (generateContent via fetch, no SDK).
 *
 * Docs used (checked 2026-10-10):
 * - Models and IDs: https://ai.google.dev/gemini-api/docs/models
 * - Search grounding: https://ai.google.dev/gemini-api/docs/google-search
 *   tool `{ google_search: {} }`; Gemini 3+ bills per executed search query
 *   ($14 per 1,000). Pricing: https://ai.google.dev/gemini-api/docs/pricing
 * - Structured output: https://ai.google.dev/gemini-api/docs/structured-output
 *   (combining grounding with a JSON schema is a Gemini 3 preview feature, so
 *   answers use grounding with plain text and extraction uses a schema with no tools).
 * - REST: `POST /v1beta/models/{model}:generateContent`, auth header `x-goog-api-key`
 *   (never the `?key=` query, which would end up in URLs and logs);
 *   key validation `GET /v1beta/models?pageSize=1` (https://ai.google.dev/api/models).
 *
 * Caveat: the current guides document the newer Interactions API; the camelCase
 * generateContent fields used here (`generationConfig.responseMimeType`,
 * `responseJsonSchema`, `candidates[].groundingMetadata.groundingChunks[].web`,
 * `webSearchQueries`, `usageMetadata`) come from the generateContent reference and
 * could not be re-confirmed field by field on 2026-10-10.
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

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiResponse {
  modelVersion?: string
  promptFeedback?: { blockReason?: string }
  candidates?: {
    finishReason?: string
    content?: { parts?: { text?: string; thought?: boolean }[] }
    groundingMetadata?: {
      webSearchQueries?: string[]
      groundingChunks?: { web?: { uri?: string; title?: string } }[]
    }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    toolUsePromptTokenCount?: number
  }
}

function headers(apiKey: string) {
  return { 'x-goog-api-key': apiKey }
}

async function generate(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<GeminiResponse> {
  const res = (await requestJson({
    provider: 'gemini',
    url: `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    method: 'POST',
    headers: headers(apiKey),
    body,
    apiKey,
    timeoutMs,
    signal,
  })) as GeminiResponse
  if (res.promptFeedback?.blockReason) {
    throw new LlmProviderError('gemini', 'bad_request', `gemini blocked the prompt (${res.promptFeedback.blockReason})`)
  }
  return res
}

function textOf(res: GeminiResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? []
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
}

/** Thinking tokens are billed as output; tool-use prompt tokens as input. */
function usageOf(res: GeminiResponse) {
  const u = res.usageMetadata
  return {
    inputTokens: (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0),
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  }
}

export const geminiProvider: LlmProvider = {
  id: 'gemini',
  label: 'Google Gemini',

  async validateKey(apiKey, signal) {
    try {
      await requestJson({
        provider: 'gemini',
        url: `${BASE_URL}/models?pageSize=1`,
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
    const model = input.model ?? LLM_MODELS.gemini.answer
    const res = await generate(
      input.apiKey,
      model,
      { contents: [{ role: 'user', parts: [{ text: input.prompt }] }], tools: [{ google_search: {} }] },
      ANSWER_TIMEOUT_MS,
      input.signal
    )
    const candidate = res.candidates?.[0]
    if (!candidate) throw new LlmProviderError('gemini', 'bad_request', 'gemini returned no answer')
    if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      throw new LlmProviderError('gemini', 'bad_request', `gemini declined to answer (${candidate.finishReason})`)
    }
    const citations: LlmCitation[] = []
    const seen = new Set<string>()
    for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
      addCitation(citations, seen, chunk.web?.uri, chunk.web?.title)
    }
    return {
      text: textOf(res),
      citations,
      usage: { ...usageOf(res), webSearchRequests: candidate.groundingMetadata?.webSearchQueries?.length ?? 0 },
      model: res.modelVersion ?? model,
    }
  },

  async extractStructured<T>(input: ExtractStructuredInput): Promise<LlmStructuredResult<T>> {
    const model = input.model ?? LLM_MODELS.gemini.extract
    const res = await generate(
      input.apiKey,
      model,
      {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.input }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: input.schema },
      },
      EXTRACT_TIMEOUT_MS,
      input.signal
    )
    const candidate = res.candidates?.[0]
    if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
      throw new LlmProviderError(
        'gemini',
        'bad_request',
        `gemini structured output incomplete (${candidate?.finishReason ?? 'no candidate'})`
      )
    }
    let data: T
    try {
      data = JSON.parse(textOf(res)) as T
    } catch {
      throw new LlmProviderError('gemini', 'server', 'gemini returned invalid JSON for structured output')
    }
    return { data, usage: usageOf(res), model: res.modelVersion ?? model }
  },
}
