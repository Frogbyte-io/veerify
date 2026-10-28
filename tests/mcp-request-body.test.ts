import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'
import { MCP_MAX_BODY_BYTES, readMcpJsonBody } from '~/server/mcp/request-body'
import { readJsonBodyWithLimit } from '~/server/utils/json-body-limit'

function eventWith(headers: Record<string, string>, chunks: Array<Buffer | string>, end = true) {
  const req = new PassThrough() as unknown as IncomingMessage & PassThrough
  Object.assign(req, { headers, method: 'POST', url: '/mcp' })
  const event = createEvent(req, {} as ServerResponse)
  queueMicrotask(() => {
    for (const chunk of chunks) req.write(chunk)
    if (end) req.end()
  })
  return { event, req }
}

describe('readMcpJsonBody', () => {
  it('limits bodies to 4 MiB, the SDK default', () => {
    expect(MCP_MAX_BODY_BYTES).toBe(4 * 1024 * 1024)
  })

  it('parses a JSON body', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const { event } = eventWith({ 'content-length': String(body.length) }, [body])
    await expect(readMcpJsonBody(event)).resolves.toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  })

  it('refuses with 413 from Content-Length without reading the stream', async () => {
    const { event, req } = eventWith({ 'content-length': String(MCP_MAX_BODY_BYTES + 1) }, [], false)
    let read = false
    req.on('data', () => {
      read = true
    })
    await expect(readMcpJsonBody(event)).rejects.toMatchObject({
      statusCode: 413,
      data: { success: false, error: { code: 'VALIDATION_ERROR' } },
    })
    expect(read).toBe(false)
  })

  it('refuses a chunked body with 413 as soon as it passes the cap, without waiting for the end', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x20)
    // Five 1 MiB chunks and the stream never ends: the reader must reject on its own.
    const { event } = eventWith({ 'transfer-encoding': 'chunked' }, [chunk, chunk, chunk, chunk, chunk], false)
    await expect(readMcpJsonBody(event)).rejects.toMatchObject({ statusCode: 413 })
  })

  it('accepts a chunked body exactly at the cap', async () => {
    const json = `"${'a'.repeat(MCP_MAX_BODY_BYTES - 2)}"`
    const { event } = eventWith({ 'transfer-encoding': 'chunked' }, [json.slice(0, 1000), json.slice(1000)])
    await expect(readMcpJsonBody(event)).resolves.toHaveLength(MCP_MAX_BODY_BYTES - 2)
  })

  it('refuses invalid JSON with 400', async () => {
    const { event } = eventWith({}, ['{not json'])
    await expect(readMcpJsonBody(event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('readJsonBodyWithLimit with a pre-buffered body (in-process $fetch)', () => {
  function bufferedEvent(body: string) {
    const req = new PassThrough() as unknown as IncomingMessage & PassThrough & { body: string }
    Object.assign(req, { headers: {}, method: 'POST', url: '/api/x', body })
    return createEvent(req, {} as ServerResponse)
  }

  it('parses a body under the cap', async () => {
    await expect(readJsonBodyWithLimit(bufferedEvent('{"a":1}'), 100)).resolves.toEqual({ a: 1 })
  })

  it('refuses a body over the cap with 413', async () => {
    await expect(readJsonBodyWithLimit(bufferedEvent(`"${'a'.repeat(200)}"`), 100)).rejects.toMatchObject({
      statusCode: 413,
    })
  })
})
