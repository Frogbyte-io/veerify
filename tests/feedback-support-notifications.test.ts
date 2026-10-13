import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  links: [] as Array<{ contactId: string; email: string | null; userId: string | null }>,
}))
const sendEmail = vi.hoisted(() => vi.fn(async () => undefined))
const notifyUser = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('~/lib/email', () => ({ sendStatusChangeNotificationEmail: sendEmail }))
vi.mock('~/server/utils/notifications', () => ({ notifyUser }))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('~/server/database/drizzle', () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(state.links),
  }
  return { db: { select: () => chain } }
})

const { notifyLinkedFeedbackContacts } = await import('~/server/utils/feedback-support-notifications')

beforeEach(() => {
  state.links = []
  sendEmail.mockClear()
  notifyUser.mockClear()
})

describe('linked feedback contact notifications', () => {
  it('does not query or notify contacts before feedback is completed', async () => {
    state.links = [{ contactId: 'contact-1', email: 'one@example.com', userId: null }]

    await notifyLinkedFeedbackContacts({
      feedbackId: 'feedback-1',
      feedbackTitle: 'CSV export',
      projectId: 'project-1',
      status: 'planned',
      actorUserId: 'agent-1',
      actorName: 'Agent',
    })

    expect(sendEmail).not.toHaveBeenCalled()
    expect(notifyUser).not.toHaveBeenCalled()
  })

  it('treats custom terminal statuses as shippable and deduplicates notifications', async () => {
    state.links = [
      { contactId: 'contact-1', email: 'one@example.com', userId: 'user-1' },
      { contactId: 'contact-1', email: 'one@example.com', userId: 'user-1' },
      { contactId: 'contact-2', email: 'two@example.com', userId: null },
    ]

    await notifyLinkedFeedbackContacts({
      feedbackId: 'feedback-1',
      feedbackTitle: 'CSV export',
      projectId: 'project-1',
      status: 'shipped',
      actorUserId: 'agent-1',
      actorName: 'Agent',
    })

    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'one@example.com', newStatus: 'shipped' }))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'two@example.com' }))
    expect(notifyUser).toHaveBeenCalledTimes(1)
    expect(notifyUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'status_change', feedbackId: 'feedback-1' })
    )
  })
})
