import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLlmProvider, LLM_MODELS, LlmProviderError } from '../server/services/llm'
import { estimateCostUsdMicros } from '../server/services/llm/models'

const KEY = 'AIzaSyTESTSECRET1234567890abcdef'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return {
    url: url as string,
    init: init as RequestInit,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  }
}

const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
const p = getLlmProvider('gemini')
const extractInput = { apiKey: KEY, system: 's', input: 'i', schema, schemaName: 'n' }

describe('gemini', () => {
  it('sends the google_search request and parses text, citations and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        modelVersion: 'gemini-3.8-flash',
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Acme ' }, { text: 'rocks.' }, { text: 'hidden', thought: true }] },
            groundingMetadata: {
              webSearchQueries: ['q1', 'q2'],
              groundingChunks: [
                { web: { uri: 'https://a.com', title: 'A' } },
                { web: { uri: 'https://a.com', title: 'dup' } },
                { web: { uri: 'https://b.com' } },
                {},
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          thoughtsTokenCount: 4,
          toolUsePromptTokenCount: 3,
        },
      })
    )
    const res = await p.answerWithSearch({ apiKey: KEY, prompt: 'best tool?' })
    const call = lastCall()
    expect(call.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODELS.gemini.answer}:generateContent`
    )
    expect(call.url).not.toContain(KEY)
    expect(call.headers['x-goog-api-key']).toBe(KEY)
    expect(call.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'best tool?' }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 4096 },
    })
    expect(res).toEqual({
      text: 'Acme rocks.',
      citations: [{ url: 'https://a.com', title: 'A' }, { url: 'https://b.com' }],
      usage: { inputTokens: 13, outputTokens: 9, webSearchRequests: 2 },
      model: 'gemini-3.8-flash',
    })
  })

  it('reports zero searches when the model did not ground', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hi' }] } }] })
    )
    const res = await p.answerWithSearch({ apiKey: KEY, prompt: 'q' })
    expect(res.usage.webSearchRequests).toBe(0)
    expect(res.citations).toEqual([])
    expect(res.model).toBe(LLM_MODELS.gemini.answer)
  })

  it('maps blocked prompts, empty candidates and safety finishes to bad_request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }))
    expect((await p.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)).kind).toBe('bad_request')
    fetchMock.mockResolvedValueOnce(jsonResponse({ candidates: [] }))
    expect((await p.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)).kind).toBe('bad_request')
    fetchMock.mockResolvedValueOnce(jsonResponse({ candidates: [{ finishReason: 'SAFETY' }] }))
    expect((await p.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)).kind).toBe('bad_request')
  })

  it('extractStructured uses a JSON schema without tools and parses output', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        modelVersion: 'gemini-3.1-flash-lite',
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":"x"}' }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
      })
    )
    const res = await p.extractStructured<{ a: string }>({
      apiKey: KEY,
      system: 'sys',
      input: 'in',
      schema,
      schemaName: 'thing',
    })
    const call = lastCall()
    expect(call.url).toContain(`/models/${LLM_MODELS.gemini.extract}:generateContent`)
    expect(call.body).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'in' }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 2048 },
    })
    expect(res).toEqual({
      data: { a: 'x' },
      usage: { inputTokens: 4, outputTokens: 2 },
      model: 'gemini-3.1-flash-lite',
    })
  })

  it('extractStructured rejects invalid JSON and truncated output', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'nope' }] } }] })
    )
    expect((await p.extractStructured(extractInput).catch((e) => e)).kind).toBe('server')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a"' }] } }] })
    )
    expect((await p.extractStructured(extractInput).catch((e) => e)).kind).toBe('bad_request')
  })

  it('validateKey lists models with the header key and reports failures key-free', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
    await expect(p.validateKey(KEY)).resolves.toEqual({ ok: true })
    const call = lastCall()
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1')
    expect(call.headers['x-goog-api-key']).toBe(KEY)
    fetchMock.mockResolvedValueOnce(new Response(`API key not valid ${KEY}`, { status: 400 }))
    const bad = await p.validateKey(KEY)
    expect(bad.ok).toBe(false)
    expect(bad).toMatchObject({ kind: 'auth' })
    expect(bad.message).not.toContain(KEY)
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }))
    await expect(p.validateKey(KEY)).resolves.toMatchObject({ ok: false, kind: 'auth' })
  })

  it('estimates cost with the per-query grounding fee', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, webSearchRequests: 3 }
    expect(estimateCostUsdMicros('gemini', 'gemini-3.8-flash', null, usage)).toBe(750_000 + 42_000)
  })
})

describe('gemini error mapping', () => {
  const call = () => p.answerWithSearch({ apiKey: KEY, prompt: 'q' })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'bad_request'],
    [404, 'bad_request'],
    [500, 'server'],
    [503, 'server'],
  ])('status %i -> %s, truncated and key-free', async (status, kind) => {
    fetchMock.mockResolvedValueOnce(new Response(`${KEY} ${'x'.repeat(1000)} echoed key ${KEY}`, { status }))
    const err = await call().catch((e) => e)
    expect(err).toBeInstanceOf(LlmProviderError)
    expect(err.kind).toBe(kind)
    expect(err.status).toBe(status)
    expect(err.provider).toBe('gemini')
    expect(err.message).not.toContain(KEY)
    expect(err.message.length).toBeLessThan(400)
  })

  it('maps HTTP 400 API_KEY_INVALID to auth but leaves other 400s as bad_request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' },
        },
        400
      )
    )
    expect((await call().catch((e) => e)).kind).toBe('auth')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 400, details: [{ reason: 'API_KEY_INVALID' }] } }, 400)
    )
    expect((await call().catch((e) => e)).kind).toBe('auth')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 400, message: 'Bad schema' } }, 400))
    expect((await call().catch((e) => e)).kind).toBe('bad_request')
  })

  it('maps exhausted quota to quota', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 429, message: 'You exceeded your current quota, please check your billing' } }, 429)
    )
    expect((await call().catch((e) => e)).kind).toBe('quota')
  })

  it('maps fetch failure to network without leaking the key', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${KEY}`))
    const err = await call().catch((e) => e)
    expect(err.kind).toBe('network')
    expect(err.message).not.toContain(KEY)
  })

  it('maps caller abort to timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        })
    )
    const ac = new AbortController()
    const pending = p.answerWithSearch({ apiKey: KEY, prompt: 'q', signal: ac.signal }).catch((e) => e)
    ac.abort()
    const err = await pending
    expect(err.kind).toBe('timeout')
    expect(err.message).not.toContain(KEY)
  })

  it('applies the default timeout', async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.abort(new DOMException('timeout', 'TimeoutError')))
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) =>
      init.signal!.aborted ? Promise.reject(new DOMException('timeout', 'TimeoutError')) : new Promise(() => {})
    )
    const err = await call().catch((e) => e)
    expect(timeoutSpy).toHaveBeenCalledWith(90_000)
    expect(err.kind).toBe('timeout')
    timeoutSpy.mockRestore()
  })
})
