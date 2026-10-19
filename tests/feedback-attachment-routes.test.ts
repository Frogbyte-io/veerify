import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { LocalStorageProvider } from '../server/utils/storage/provider-local'
import { buildFeedbackAttachmentDownloadUrl, processFeedbackAttachment } from '../server/utils/feedback-attachments'

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, storage: null as unknown }))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => (state.row ? [state.row] : [])),
    })),
  },
}))
vi.mock('~/server/utils/storage', () => ({ getStorageProvider: vi.fn(() => state.storage) }))

type Handler = (event: unknown) => Promise<unknown>

describe('feedback attachment download + local storage isolation', () => {
  let dir: string
  let headers: Record<string, unknown>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fa-test-'))
    headers = {}
    state.storage = new LocalStorageProvider({ rootDir: dir })
    vi.stubGlobal('useRuntimeConfig', () => ({ uploadTokenSecret: 'unit-test-secret' }))
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error('err'), input))
    vi.stubGlobal('getRouterParam', () => 'att-1')
    vi.stubGlobal('setResponseHeaders', (_event: unknown, value: Record<string, unknown>) => {
      headers = value
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(dir, { recursive: true, force: true })
  })

  async function stored(fileName: string, bytes: Buffer, contentType: string, kind: string) {
    await (state.storage as LocalStorageProvider).putObject({
      key: 'feedback-attachments/p/att-1/x',
      buffer: bytes,
      contentType,
    })
    state.row = {
      id: 'att-1',
      feedbackId: 'fb-1',
      status: 'ready',
      storageKey: 'feedback-attachments/p/att-1/x',
      fileName,
      contentType,
      kind,
    }
  }

  function query(url: string) {
    const parsed = new URL(url, 'http://localhost')
    return { exp: parsed.searchParams.get('exp'), sig: parsed.searchParams.get('sig') }
  }

  async function fileHandler() {
    return (await import('../server/api/feedback-attachments/[id]/file.get')).default as unknown as Handler
  }

  it('serves a processed image inline with hardened headers for a valid signature', async () => {
    const raw = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
    const processed = await processFeedbackAttachment(raw, 'a.png', 'image/png')
    await stored('a.png', processed.buffer, 'image/png', 'image')
    const handler = await fileHandler()
    vi.stubGlobal('getQuery', () => query(buildFeedbackAttachmentDownloadUrl('att-1').url))
    const body = await handler({})
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(headers['content-disposition']).toMatch(/^inline/)
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(String(headers['content-security-policy'])).toContain('sandbox')
  })

  it('forces download for non-images and refuses bad, wrong-id or expired signatures', async () => {
    await stored('run.log', Buffer.from('hello'), 'text/plain', 'log')
    const handler = await fileHandler()
    const good = query(buildFeedbackAttachmentDownloadUrl('att-1').url)
    vi.stubGlobal('getQuery', () => good)
    await handler({})
    expect(headers['content-disposition']).toMatch(/^attachment/)

    vi.stubGlobal('getQuery', () => query(buildFeedbackAttachmentDownloadUrl('other-id').url))
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
    vi.stubGlobal('getQuery', () => ({ exp: good.exp, sig: 'forged' }))
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
    const expired = buildFeedbackAttachmentDownloadUrl('att-1', new Date(Date.now() - 10 * 60 * 1000)).url
    vi.stubGlobal('getQuery', () => query(expired))
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('stops serving bytes once the feedback was deleted (row detached) or the row is pending', async () => {
    await stored('run.log', Buffer.from('hello'), 'text/plain', 'log')
    const handler = await fileHandler()
    vi.stubGlobal('getQuery', () => query(buildFeedbackAttachmentDownloadUrl('att-1').url))
    state.row = { ...state.row, feedbackId: null }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
    state.row = { ...state.row, feedbackId: 'fb-1', status: 'pending' }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('the public local object route no longer serves private attachment prefixes', async () => {
    await stored('run.log', Buffer.from('secret'), 'text/plain', 'log')
    const handler = (await import('../server/api/uploads/object/[...key].get')).default as unknown as Handler
    vi.stubGlobal('getRouterParam', () => 'feedback-attachments/p/att-1/x')
    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
  })
})
