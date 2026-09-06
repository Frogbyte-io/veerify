import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  messages: [{ id: 'message-1', conversationId: 'conversation-1', kind: 'incoming', body: 'Hi', bodyHtml: null, senderKind: 'contact', senderContactId: 'contact-1', senderUserId: null, isPrivate: false, channelMessageId: 'external-1', inReplyTo: null, deliveryStatus: 'sent', createdAt: new Date() }],
  attachments: [{ id: 'attachment-1', messageId: 'message-1', fileName: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 10 }],
  attachmentRow: { storageKey: 'support/final/invoice.pdf', fileName: 'invoice.pdf', contentType: 'application/pdf', conversationId: 'conversation-1' },
  getObject: vi.fn().mockResolvedValue(Buffer.from('bytes')),
  readMode: 'message' as 'message' | 'download',
  selectCount: 0,
  accessError: null as Error | null,
  headers: {} as Record<string, string>,
}))

vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({ requireConversationAccess: vi.fn(async () => { if (state.accessError) throw state.accessError; return {} }) }))
vi.mock('~/server/utils/storage', () => ({ getStorageProvider: vi.fn(() => ({ getObject: state.getObject })) }))
vi.mock('~/server/database/drizzle', () => ({
    db: {
    select: vi.fn(() => {
      state.selectCount++
      const chain: Record<string, any> = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockImplementation(() => state.readMode === 'message' && state.selectCount === 2 ? Promise.resolve(state.attachments) : chain),
        limit: vi.fn().mockResolvedValue(state.readMode === 'message' ? state.messages : [state.attachmentRow]),
      }
      return chain
    }),
  },
}))
vi.mock('h3', () => ({
  createError: (input: any) => Object.assign(new Error(input.statusMessage), input),
  getRouterParam: (_event: unknown, name: string) => name === 'id' ? 'attachment-1' : 'conversation-1',
  setResponseHeader: (event: unknown, name: string, value: string) => { void event; state.headers[name] = value },
}))
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => name === 'id' ? 'attachment-1' : 'conversation-1')
vi.stubGlobal('getQuery', () => ({ limit: '20' }))
vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input.statusMessage), input))
vi.stubGlobal('setResponseHeader', vi.fn())

const messageList = (await import('../server/api/support/conversations/[id]/messages/index.get')).default
const attachmentGet = (await import('../server/api/support/attachments/[id].get')).default

describe('support attachment read routes', () => {
  beforeEach(() => {
    state.getObject.mockClear()
    state.selectCount = 0
    state.accessError = null
    state.headers = {}
  })

  it('returns finalized attachment metadata without storage or sensitive message fields', async () => {
    state.readMode = 'message'
    const result = await messageList({} as never)
    const message = result.data.messages[0]
    expect(message.attachments).toEqual([{ id: 'attachment-1', fileName: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 10, downloadUrl: '/api/support/attachments/attachment-1' }])
    expect(message).not.toHaveProperty('channelHeaders')
    expect(message).not.toHaveProperty('metadata')
    expect(message).not.toHaveProperty('deliveryError')
    expect(message).not.toHaveProperty('storageKey')
    expect(state.getObject).not.toHaveBeenCalled()
  })

  it('serves canonical bytes and uses attachment download hardening', async () => {
    state.readMode = 'download'
    const result = await attachmentGet({} as never)
    expect(result).toEqual(Buffer.from('bytes'))
    expect(state.getObject).toHaveBeenCalledWith(state.attachmentRow.storageKey)
    expect(state.headers['Content-Disposition']).toMatch(/^attachment; filename="invoice.pdf"; filename\*=UTF-8''invoice.pdf$/)
    expect(state.headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('checks conversation access before reading canonical storage', async () => {
    state.readMode = 'download'
    state.accessError = Object.assign(new Error('forbidden'), { statusCode: 403 })
    await expect(attachmentGet({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.getObject).not.toHaveBeenCalled()
  })

  it('sanitizes storage-provider failures without exposing paths or keys', async () => {
    state.readMode = 'download'
    state.getObject.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT C:\\private\\support\\final\\invoice.pdf'), { code: 'EIO' })
    )

    await expect(attachmentGet({} as never)).rejects.toMatchObject({
      statusCode: 503,
      data: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Attachment is temporarily unavailable',
        },
      },
    })
  })
})
