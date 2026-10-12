import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateSite, MentionInsert, MentionsStore } from '~/server/services/marketing/mentions/store'
import type { SocialPost, SocialSource } from '~/server/services/social-sources'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/utils/marketing-usage', () => ({ recordUsage: vi.fn() }))

const { pollMentions } = await import('~/server/services/marketing/mentions/poller')
const { publishMentionsNew } = await import('~/server/utils/marketing-realtime')
const { setRealtimeDriver, sanitizeEnvelope, envelopeMatchesChannel } = await import('~/server/services/realtime')

const NOW = new Date('2026-10-10T12:00:00Z')

const site: CandidateSite = {
  siteId: 's1',
  teamId: 't1',
  projectId: 'p1',
  projectName: 'Acme',
  projectSlug: 'acme',
  projectSettings: { marketingEnabled: true },
  teamMarketingEnabled: true,
}

function storeInserting(count: (rows: MentionInsert[]) => number): MentionsStore {
  return {
    loadVerifiedSites: async () => [site],
    loadDueSites: async () => [site],
    claimCursor: async () => true,
    releaseClaim: async () => undefined,
    loadTerms: async (ids) =>
      new Map(ids.map((id) => [id, [{ id: 'b', kind: 'brand' as const, label: 'Acme', aliases: [] }]])),
    loadCursors: async () => [],
    insertMentions: async (rows) => count(rows),
    saveCursor: async () => {},
    deleteOlderThan: async () => 0,
  }
}

function sourceReturning(posts: SocialPost[]): SocialSource {
  return { id: 'hackernews', label: 'hn', isConfigured: () => true, search: async () => posts } as SocialSource
}

const hit: SocialPost = {
  source: 'hackernews',
  externalId: 'x1',
  url: 'https://example.com/x1',
  author: 'someone',
  title: null,
  text: 'I love Acme and its secret text',
  publishedAt: new Date('2026-10-10T10:00:00Z'),
  score: 1,
}

describe('mentions realtime publish from the poller', () => {
  it('publishes once per site with the inserted count', async () => {
    const publishNew = vi.fn(async () => {})
    await pollMentions(
      { now: NOW },
      { store: storeInserting((rows) => rows.length), sources: [sourceReturning([hit])], publishNew }
    )
    expect(publishNew).toHaveBeenCalledTimes(1)
    expect(publishNew).toHaveBeenCalledWith({ teamId: 't1', projectId: 'p1', count: 1 })
  })

  it('does not publish when nothing was inserted (all conflicts or no hits)', async () => {
    const publishNew = vi.fn(async () => {})
    await pollMentions({ now: NOW }, { store: storeInserting(() => 0), sources: [sourceReturning([hit])], publishNew })
    await pollMentions({ now: NOW }, { store: storeInserting(() => 0), sources: [sourceReturning([])], publishNew })
    expect(publishNew).not.toHaveBeenCalled()
  })

  it('does not fail the poll when publishing throws', async () => {
    const publishNew = vi.fn(async () => {
      throw new Error('broker down')
    })
    const summary = await pollMentions(
      { now: NOW },
      { store: storeInserting((rows) => rows.length), sources: [sourceReturning([hit])], publishNew }
    )
    expect(summary.inserted).toBe(1)
  })
})

describe('publishMentionsNew envelope', () => {
  const published: { channel: string; envelope: Record<string, unknown> }[] = []

  beforeEach(() => {
    published.length = 0
    setRealtimeDriver({
      name: 'test',
      publish: async (channel, envelope) => {
        published.push({ channel, envelope: envelope as unknown as Record<string, unknown> })
      },
      subscribe: async () => {},
      unsubscribe: async () => {},
      close: async () => {},
    })
  })

  it('publishes a thin envelope on team:<id> with no content', async () => {
    await publishMentionsNew({ teamId: 't1', projectId: 'p1', count: 3 })
    expect(published).toHaveLength(1)
    expect(published[0].channel).toBe('team:t1')
    expect(published[0].envelope).toEqual({
      v: 1,
      type: 'marketing.mentions.new',
      teamId: 't1',
      projectId: 'p1',
      count: 3,
    })
  })

  it('publishes nothing for a zero or invalid count', async () => {
    await publishMentionsNew({ teamId: 't1', projectId: 'p1', count: 0 })
    await publishMentionsNew({ teamId: 't1', projectId: 'p1', count: -2 })
    expect(published).toHaveLength(0)
  })

  it('keeps the envelope allowlist closed: text is stripped, projectId and count survive', () => {
    const envelope = sanitizeEnvelope({
      v: 1,
      type: 'marketing.mentions.new',
      teamId: 't1',
      projectId: 'p1',
      count: 2,
      excerpt: 'secret',
      text: 'secret',
    })
    expect(envelope).toEqual({ v: 1, type: 'marketing.mentions.new', teamId: 't1', projectId: 'p1', count: 2 })
    expect(JSON.stringify(envelope)).not.toContain('secret')
  })

  it('refuses to match a team envelope to another team channel', () => {
    const envelope = sanitizeEnvelope({
      v: 1,
      type: 'marketing.mentions.new',
      teamId: 't1',
      projectId: 'p1',
      count: 1,
    })!
    expect(envelopeMatchesChannel(envelope, 'team:t2')).toBe(false)
    expect(envelopeMatchesChannel(envelope, 'team:t1')).toBe(true)
  })
})
