import { describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({ value: [] as Array<{ email: string; settings: unknown }> }))

vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'from', 'innerJoin']) chain[name] = () => chain
  chain.where = async () => rows.value
  return { db: chain }
})
vi.mock('~/lib/email', () => ({ sendMarketingMentionsDigestEmail: vi.fn() }))

const { loadAdminEmails } = await import('~/server/services/marketing/mentions/digest')

describe('loadAdminEmails', () => {
  it('skips admins who turned the marketing digest off', async () => {
    rows.value = [
      { email: 'on@x.test', settings: null },
      { email: 'default@x.test', settings: { notificationPreferences: { newFeedback: false } } },
      { email: 'explicit@x.test', settings: { notificationPreferences: { marketingDigest: true } } },
      { email: 'off@x.test', settings: { notificationPreferences: { marketingDigest: false } } },
    ]
    expect(await loadAdminEmails('t1')).toEqual(['on@x.test', 'default@x.test', 'explicit@x.test'])
  })
})
