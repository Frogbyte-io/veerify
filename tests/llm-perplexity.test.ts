import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLlmProvider, LLM_MODELS, LlmProviderError } from '../server/services/llm'
import { estimateCostUsdMicros } from '../server/services/llm/models'

const KEY = 'pplx-test-SECRETKEY1234567890'

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
const p = getLlmProvider('perplexity')

describe('perplexity', () => {
  it('sends the web search request and parses text, citations and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'perplexity/sonar',
        status: 'completed',
        output: [
          { type: 'search_results', queries: ['q'], results: [{ url: 'https://seen.com', title: 'Seen' }] },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Acme is good.',
                annotations: [
                  { type: 'url_citation', url: 'https://a.com', title: 'A' },
                  { type: 'url_citation', url: 'https://a.com', title: 'dup' },
                  { type: 'url_citation', url: 'https://b.com' },
                ],
              },
            ],
          },
        ],
        output_text: 'Acme is good.',
        usage: { input_tokens: 12, output_tokens: 7, tool_calls_details: { search_web: { invocation: 2 } } },
      })
    )
    const res = await p.answerWithSearch({ apiKey: KEY, prompt: 'best tool?' })
    const call = lastCall()
    expect(call.url).toBe('https://api.perplexity.ai/v1/agent')
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(call.body).toEqual({
      model: LLM_MODELS.perplexity.answer,
      input: 'best tool?',
      tools: [{ type: 'web_search' }],
      max_output_tokens: 2048,
    })
    expect(res).toEqual({
      text: 'Acme is good.',
      citations: [{ url: 'https://a.com', title: 'A' }, { url: 'https://b.com' }],
      usage: { inputTokens: 12, outputTokens: 7, webSearchRequests: 2 },
      model: 'perplexity/sonar',
    })
  })

  it('falls back to deduped search results when nothing is cited inline', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        output: [
          {
            type: 'search_results',
            results: [{ url: 'https://s.com', title: 'S' }, { url: 'https://s.com' }, { url: 'https://t.com' }],
          },
        ],
        output_text: 'text',
      })
    )
    const res = await p.answerWithSearch({ apiKey: KEY, prompt: 'q' })
    expect(res.citations).toEqual([{ url: 'https://s.com', title: 'S' }, { url: 'https://t.com' }])
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0, webSearchRequests: 0 })
    expect(res.model).toBe(LLM_MODELS.perplexity.answer)
  })

  it('throws bad_request for incomplete answers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'incomplete', output_text: 'cut' }))
    expect((await p.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)).kind).toBe('bad_request')
  })

  it('maps a failed response to server without leaking the key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'failed', error: { message: `boom ${KEY}` } }))
    const err = await p.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)
    expect(err.kind).toBe('server')
    expect(err.message).not.toContain(KEY)
  })

  it('extractStructured sends response_format json_schema and parses output', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'perplexity/sonar',
        output_text: '{"a":"x"}',
        usage: { input_tokens: 3, output_tokens: 2 },
      })
    )
    const res = await p.extractStructured<{ a: string }>({
      apiKey: KEY,
      system: 'sys',
      input: 'in',
      schema,
      schemaName: 'thing',
    })
    expect(lastCall().body).toEqual({
      model: LLM_MODELS.perplexity.extract,
      instructions: 'sys',
      input: 'in',
      max_output_tokens: 1024,
      response_format: { type: 'json_schema', json_schema: { name: 'thing', schema } },
    })
    expect(res).toEqual({ data: { a: 'x' }, usage: { inputTokens: 3, outputTokens: 2 }, model: 'perplexity/sonar' })
  })

  it('extractStructured rejects invalid JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ output_text: 'not json' }))
    const err = await p
      .extractStructured({ apiKey: KEY, system: 's', input: 'i', schema, schemaName: 'n' })
      .catch((e) => e)
    expect(err).toBeInstanceOf(LlmProviderError)
    expect(err.kind).toBe('server')
  })

  it('validateKey lists models and reports auth failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(p.validateKey(KEY)).resolves.toEqual({ ok: true })
    expect(lastCall().url).toBe('https://api.perplexity.ai/v1/models')
    expect(lastCall().init.method).toBe('GET')
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }))
    await expect(p.validateKey(KEY)).resolves.toMatchObject({ ok: false, kind: 'auth' })
  })

  it('estimates cost with the per-search fee', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, webSearchRequests: 2 }
    expect(estimateCostUsdMicros('perplexity', 'perplexity/sonar', null, usage)).toBe(250_000 + 5_000)
  })
})

describe('perplexity error mapping', () => {
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
    expect(err.provider).toBe('perplexity')
    expect(err.message).not.toContain(KEY)
    expect(err.message.length).toBeLessThan(400)
  })

  it('maps payment required and exhausted quota to quota', async () => {
    fetchMock.mockResolvedValueOnce(new Response('payment required', { status: 402 }))
    expect((await call().catch((e) => e)).kind).toBe('quota')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'You exceeded your current quota, purchase credits' } }, 429)
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
