import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLlmProvider, LLM_MODELS, LLM_PROVIDERS, LlmProviderError } from '../server/services/llm'

const KEY = 'sk-test-SECRETKEY1234567890'

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
  vi.useRealTimers()
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return {
    url: url as string,
    init: init as RequestInit,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  }
}

const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }

describe('registry', () => {
  it('lists providers and resolves them', () => {
    expect(LLM_PROVIDERS.map((p) => p.id).sort()).toEqual(['anthropic', 'openai'])
    expect(getLlmProvider('openai').id).toBe('openai')
    expect(LLM_MODELS.anthropic).toEqual({ answer: 'claude-sonnet-5-5', extract: 'claude-haiku-4-5' })
  })
})

describe('anthropic', () => {
  const p = getLlmProvider('anthropic')

  it('sends the web search request and parses text, citations and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'claude-sonnet-5-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
        content: [
          { type: 'text', text: 'Let me search. ' },
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 's1',
            content: [{ type: 'web_search_result', url: 'https://r.com' }],
          },
          {
            type: 'text',
            text: 'Acme is good.',
            citations: [
              { type: 'web_search_result_location', url: 'https://a.com', title: 'A' },
              { type: 'web_search_result_location', url: 'https://b.com', title: 'B' },
            ],
          },
          {
            type: 'text',
            text: ' Yes.',
            citations: [{ type: 'web_search_result_location', url: 'https://a.com', title: 'A2' }],
          },
        ],
      })
    )
    const out = await p.answerWithSearch({ apiKey: KEY, prompt: 'best crm?', country: 'US' })
    const { url, init, body } = lastCall()
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    const h = init.headers as Record<string, string>
    expect(h['x-api-key']).toBe(KEY)
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(body.model).toBe('claude-sonnet-5-5')
    expect(body.messages).toEqual([{ role: 'user', content: 'best crm?' }])
    expect(body.tools[0]).toMatchObject({
      type: 'web_search_20260209',
      name: 'web_search',
      allowed_callers: ['direct'],
      max_uses: 5,
      user_location: { type: 'approximate', country: 'US' },
    })
    expect(out.text).toBe('Let me search. Acme is good. Yes.')
    expect(out.citations).toEqual([
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ])
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5, webSearchRequests: 1 })
    expect(out.model).toBe('claude-sonnet-5-5')
  })

  it('continues pause_turn and sums usage', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          stop_reason: 'pause_turn',
          usage: { input_tokens: 1, output_tokens: 2 },
          content: [{ type: 'text', text: 'a' }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 4 },
          content: [{ type: 'text', text: 'b' }],
        })
      )
    const out = await p.answerWithSearch({ apiKey: KEY, prompt: 'q' })
    expect(out.text).toBe('ab')
    expect(out.usage).toEqual({ inputTokens: 4, outputTokens: 6, webSearchRequests: 0 })
    expect(lastCall().body.messages).toHaveLength(2)
  })

  it('extractStructured uses output_config.format and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
        content: [{ type: 'text', text: '{"a":"x"}' }],
      })
    )
    const out = await p.extractStructured<{ a: string }>({
      apiKey: KEY,
      system: 'sys',
      input: 'in',
      schema,
      schemaName: 'thing',
    })
    const { body } = lastCall()
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.system).toBe('sys')
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema } })
    expect(out.data).toEqual({ a: 'x' })
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })

  it('extractStructured rejects invalid JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nope' }] })
    )
    await expect(
      p.extractStructured({ apiKey: KEY, system: 's', input: 'i', schema, schemaName: 'n' })
    ).rejects.toMatchObject({ kind: 'server' })
  })

  it('validateKey lists models', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(p.validateKey(KEY)).resolves.toEqual({ ok: true })
    expect(lastCall().url).toContain('/v1/models')
    expect(lastCall().init.method).toBe('GET')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'invalid x-api-key' } }, 401))
    await expect(p.validateKey(KEY)).resolves.toMatchObject({ ok: false, kind: 'auth' })
  })
})

describe('openai', () => {
  const p = getLlmProvider('openai')

  it('sends the web search request and parses text, citations and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'gpt-6-astra-2026',
        status: 'completed',
        usage: { input_tokens: 11, output_tokens: 6 },
        output: [
          { type: 'web_search_call', id: 'ws1', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Acme wins.',
                annotations: [
                  { type: 'url_citation', url: 'https://a.com', title: 'A' },
                  { type: 'url_citation', url: 'https://a.com', title: 'dup' },
                  { type: 'url_citation', url: 'https://b.com', title: 'B' },
                ],
              },
            ],
          },
        ],
      })
    )
    const out = await p.answerWithSearch({ apiKey: KEY, prompt: 'q', country: 'GB' })
    const { url, init, body } = lastCall()
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(body).toMatchObject({
      model: 'gpt-6-astra',
      input: 'q',
      store: false,
      max_tool_calls: 5,
      tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'GB' } }],
    })
    expect(out.text).toBe('Acme wins.')
    expect(out.citations).toEqual([
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ])
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 6, webSearchRequests: 1 })
    expect(out.model).toBe('gpt-6-astra-2026')
  })

  it('extractStructured sends strict json_schema and parses output', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'completed',
        usage: { input_tokens: 2, output_tokens: 1 },
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":"y"}' }] }],
      })
    )
    const out = await p.extractStructured<{ a: string }>({
      apiKey: KEY,
      system: 'sys',
      input: 'in',
      schema,
      schemaName: 'thing',
    })
    const { body } = lastCall()
    expect(body.model).toBe('gpt-6-luna')
    expect(body.instructions).toBe('sys')
    expect(body.text).toEqual({ format: { type: 'json_schema', name: 'thing', schema, strict: true } })
    expect(out.data).toEqual({ a: 'y' })
  })

  it('maps a refusal to bad_request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
      })
    )
    await expect(
      p.extractStructured({ apiKey: KEY, system: 's', input: 'i', schema, schemaName: 'n' })
    ).rejects.toMatchObject({ kind: 'bad_request' })
  })

  it('validateKey lists models', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(p.validateKey(KEY)).resolves.toEqual({ ok: true })
    expect(lastCall().url).toBe('https://api.openai.com/v1/models')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad key' } }, 403))
    await expect(p.validateKey(KEY)).resolves.toMatchObject({ ok: false, kind: 'auth' })
  })
})

describe.each(['anthropic', 'openai'] as const)('%s error mapping', (id) => {
  const p = getLlmProvider(id)
  const call = () => p.answerWithSearch({ apiKey: KEY, prompt: 'q' })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'bad_request'],
    [404, 'bad_request'],
    [422, 'bad_request'],
    [500, 'server'],
    [503, 'server'],
    [529, 'server'],
  ])('status %i -> %s, truncated and key-free', async (status, kind) => {
    const body = `${'x'.repeat(1000)} echoed key ${KEY}`
    fetchMock.mockResolvedValueOnce(new Response(`${KEY} ${body}`, { status }))
    const err = await call().catch((e) => e)
    expect(err).toBeInstanceOf(LlmProviderError)
    expect(err.kind).toBe(kind)
    expect(err.status).toBe(status)
    expect(err.provider).toBe(id)
    expect(err.message).not.toContain(KEY)
    expect(err.message.length).toBeLessThan(400)
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

describe('quota errors', () => {
  const openai = getLlmProvider('openai')
  const anthropic = getLlmProvider('anthropic')

  it('maps OpenAI 429 insufficient_quota to quota (not rate_limit)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' },
        },
        429
      )
    )
    const err = await openai.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)
    expect(err.kind).toBe('quota')
  })

  it('keeps a plain OpenAI 429 as rate_limit', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } }, 429)
    )
    const err = await openai.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)
    expect(err.kind).toBe('rate_limit')
  })

  it('maps Anthropic low credit balance (400) to quota', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Your credit balance is too low to access the Anthropic API.',
          },
        },
        400
      )
    )
    const err = await anthropic.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)
    expect(err.kind).toBe('quota')
  })

  it('keeps other Anthropic 400s as bad_request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } }, 400)
    )
    const err = await anthropic.answerWithSearch({ apiKey: KEY, prompt: 'q' }).catch((e) => e)
    expect(err.kind).toBe('bad_request')
  })
})

describe('openai incomplete answers', () => {
  it('throws bad_request instead of storing truncated text', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'half an ans' }] }],
      })
    )
    const err = await getLlmProvider('openai')
      .answerWithSearch({ apiKey: KEY, prompt: 'q' })
      .catch((e) => e)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/truncated/)
  })
})
