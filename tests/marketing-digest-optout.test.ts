import { describe, expect, it, vi } from 'vitest'

type Row = { email: string; settings: unknown; organizationId?: string; projectId?: string }
// Two queries run in order: organization owners/admins, then project admins
const rows = vi.hoisted(() => ({ queue: [] as Row[][] }))

vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'from', 'innerJoin']) chain[name] = () => chain
  chain.where = async () => rows.queue.shift() ?? []
  return { db: chain }
})
vi.mock('~/lib/email', () => ({ sendMarketingMentionsDigestEmail: vi.fn() }))

const { loadAdminEmailsForProjects } = await import('~/server/services/marketing/mentions/digest')

describe('loadAdminEmailsForProjects', () => {
  it('skips admins who turned the marketing digest off', async () => {
    rows.queue = [
      [
        { organizationId: 'o1', email: 'on@x.test', settings: null },
        {
          organizationId: 'o1',
          email: 'default@x.test',
          settings: { notificationPreferences: { newFeedback: false } },
        },
        {
          organizationId: 'o1',
          email: 'off@x.test',
          settings: { notificationPreferences: { marketingDigest: false } },
        },
      ],
      [
        { projectId: 'p1', email: 'explicit@x.test', settings: { notificationPreferences: { marketingDigest: true } } },
        { projectId: 'p1', email: 'on@x.test', settings: null },
      ],
    ]
    const result = await loadAdminEmailsForProjects([{ projectId: 'p1', organizationId: 'o1' }])
    expect(result.get('p1')).toEqual(['on@x.test', 'default@x.test', 'explicit@x.test'])
  })

  it('combines org admins and project admins per project', async () => {
    rows.queue = [
      [{ organizationId: 'o1', email: 'owner@x.test', settings: null }],
      [{ projectId: 'p2', email: 'pa@x.test', settings: null }],
    ]
    const result = await loadAdminEmailsForProjects([
      { projectId: 'p1', organizationId: 'o1' },
      { projectId: 'p2', organizationId: 'o1' },
    ])
    expect(result.get('p1')).toEqual(['owner@x.test'])
    expect(result.get('p2')).toEqual(['owner@x.test', 'pa@x.test'])
  })
})
