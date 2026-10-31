import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/utils/notifications', () => ({ notifyUser: vi.fn() }))

const { notifyReplyFailed } = await import('../server/utils/reply-failure-notifications')

describe('notifyReplyFailed', () => {
  const loadConversation = vi.fn(async () => ({ displayId: 42, subject: 'Refund' }))

  it('notifies the replying agent once per failure, with a plain reason and a link', async () => {
    // The guarded marker update succeeds once; every later caller (redelivered webhook, racing worker) gets nothing.
    let claimed = false
    const claim = vi.fn(async () => {
      if (claimed) return null
      claimed = true
      return {
        senderUserId: 'user-1',
        conversationId: 'conv-1',
        deliveryStatus: 'failed',
        deliveryError: '550 The acme.example domain is not verified. Please, add and verify your domain',
      }
    })
    const notify = vi.fn(async () => ({ id: 'n-1' }) as never)

    expect(await notifyReplyFailed('msg-1', { claim, loadConversation, notify })).toBe(true)
    expect(await notifyReplyFailed('msg-1', { claim, loadConversation, notify })).toBe(false)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('user-1', {
      type: 'reply_failed',
      title: 'Your reply in conversation #42 was not sent',
      body: 'Refund · The mail provider refused the From address: its domain is not verified for sending.',
      link: '/inbox?conversationId=conv-1',
    })
  })

  it('says bounced for a hard bounce', async () => {
    const notify = vi.fn(async (_userId: string, _params: Record<string, unknown>) => ({ id: 'n-2' }) as never)
    await notifyReplyFailed('msg-2', {
      claim: async () => ({
        senderUserId: 'user-1',
        conversationId: 'conv-1',
        deliveryStatus: 'bounced',
        deliveryError: '552 5.2.2 mailbox full',
      }),
      loadConversation,
      notify,
    })
    expect(notify.mock.calls[0][1]).toMatchObject({
      title: 'Your reply in conversation #42 bounced',
      body: 'Refund · The recipient’s mailbox is full.',
    })
  })

  it('never throws', async () => {
    const claim = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(notifyReplyFailed('msg-3', { claim })).resolves.toBe(false)
  })
})
