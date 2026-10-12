import { describe, expect, it, vi } from 'vitest'
import type { CandidateSite, MentionInsert, MentionsStore } from '~/server/services/marketing/mentions/store'
import type { MatchTerm, SocialPost, SocialSource } from '~/server/services/social-sources'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/utils/marketing-usage', () => ({ recordUsage: vi.fn() }))

const {
  pollMentions,
  computeSince,
  retryDelayMs,
  buildExcerpt,
  pruneOldMentions,
  selectQuerySlice,
  rotationWatermark,
} = await import('~/server/services/marketing/mentions/poller')
const { SocialSourceError } = await import('~/server/services/social-sources')

const NOW = new Date('2026-10-10T12:00:00Z')
const HOUR = 60 * 60 * 1000

function site(overrides: Partial<CandidateSite> = {}): CandidateSite {
  return {
    siteId: 's1',
    teamId: 't1',
    projectId: 'p1',
    projectName: 'Acme',
    projectSlug: 'acme',
    projectSettings: { marketingEnabled: true },
    teamMarketingEnabled: true,
    ...overrides,
  }
}

const brand = { id: 'brand-1', kind: 'brand' as const, label: 'Acme', aliases: [] }
const rival = { id: 'rival-1', kind: 'competitor' as const, label: 'Rivalo', aliases: [] }
const keyword = { id: 'kw-1', kind: 'keyword' as const, label: 'feedback tool', aliases: [] }

function post(id: string, text: string, overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    source: 'hackernews',
    externalId: id,
    url: `https://example.com/${id}`,
    author: 'someone',
    title: null,
    text,
    publishedAt: new Date('2026-10-10T10:00:00Z'),
    score: 3,
    ...overrides,
  }
}

function makeStore(opts: {
  sites?: CandidateSite[]
  terms?: Record<string, MatchTerm[]>
  cursors?: {
    siteId: string
    source: 'hackernews' | 'reddit' | 'bluesky'
    lastPolledAt: Date
    lastAttemptAt?: Date | null
    consecutiveFailures?: number
  }[]
}) {
  const inserted: MentionInsert[] = []
  const cursorWrites: unknown[][] = []
  const store: MentionsStore = {
    loadVerifiedSites: async () => opts.sites ?? [site()],
    loadDueSites: async () => opts.sites ?? [site()],
    claimCursor: async () => true,
    loadTerms: async (ids) => new Map(ids.map((id) => [id, opts.terms?.[id] ?? [brand]])),
    loadCursors: async () => opts.cursors ?? [],
    insertMentions: async (rows) => {
      inserted.push(...rows)
      return rows.length
    },
    saveCursor: async (...args) => {
      cursorWrites.push(args)
    },
    deleteOlderThan: vi.fn(async () => 0),
  }
  return { store, inserted, cursorWrites }
}

function source(
  id: SocialSource['id'],
  search: SocialSource['search'] = async () => [],
  configured = true
): SocialSource & { search: ReturnType<typeof vi.fn> } {
  return { id, label: id, isConfigured: () => configured, search: vi.fn(search) }
}

describe('pollMentions eligibility', () => {
  it('skips sites with a module switch off or no terms, and unconfigured sources', async () => {
    const sites = [
      site({ siteId: 'on' }),
      site({ siteId: 'team-off', teamMarketingEnabled: false }),
      site({ siteId: 'product-off', projectSettings: { marketingEnabled: false } }),
      site({ siteId: 'no-team-row', teamMarketingEnabled: null }),
      site({ siteId: 'no-terms' }),
    ]
    const { store } = makeStore({ sites, terms: { 'no-terms': [] } })
    const hn = source('hackernews')
    const reddit = source('reddit', async () => [], false)

    const summary = await pollMentions({ now: NOW }, { store, sources: [hn, reddit], recordUsage: vi.fn() })

    expect(summary).toMatchObject({ sitesPolled: 1, sourcesPolled: 1 })
    expect(hn.search).toHaveBeenCalledTimes(1)
    expect(reddit.search).not.toHaveBeenCalled()
  })

  it('polls only sources whose cursor is due', async () => {
    const { store } = makeStore({
      cursors: [
        { siteId: 's1', source: 'hackernews', lastPolledAt: new Date(NOW.getTime() - 10 * 60 * 1000) },
        { siteId: 's1', source: 'bluesky', lastPolledAt: new Date(NOW.getTime() - 31 * 60 * 1000) },
      ],
    })
    const hn = source('hackernews')
    const bsky = source('bluesky')
    await pollMentions({ now: NOW }, { store, sources: [hn, bsky], recordUsage: vi.fn() })
    expect(hn.search).not.toHaveBeenCalled()
    expect(bsky.search).toHaveBeenCalledTimes(1)
  })

  it('honours maxSites, oldest-polled first', async () => {
    const { store } = makeStore({
      sites: [site({ siteId: 'a' }), site({ siteId: 'b' }), site({ siteId: 'c' })],
      cursors: [
        { siteId: 'a', source: 'hackernews', lastPolledAt: new Date(NOW.getTime() - 2 * HOUR) },
        { siteId: 'c', source: 'hackernews', lastPolledAt: new Date(NOW.getTime() - 5 * HOUR) },
      ],
    })
    const writes: string[] = []
    store.saveCursor = async (siteId) => {
      writes.push(siteId)
    }
    await pollMentions({ now: NOW, maxSites: 2 }, { store, sources: [source('hackernews')], recordUsage: vi.fn() })
    expect(writes).toEqual(['b', 'c'])
  })
})

describe('pollMentions ingestion', () => {
  it('skips posts without a term match and picks brand > competitor > keyword', async () => {
    const { store, inserted } = makeStore({ terms: { s1: [keyword, rival, brand] } })
    const hn = source('hackernews', async () => [
      post('fuzzy', 'something unrelated'),
      post('all', 'Acme beats Rivalo as a feedback tool'),
      post('comp', 'Rivalo is a feedback tool'),
      post('kw', 'I need a feedback tool'),
    ])
    await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })

    const byId = Object.fromEntries(inserted.map((row) => [row.externalId, row]))
    expect(byId.fuzzy).toBeUndefined()
    expect(byId.all).toMatchObject({ kind: 'mention', termId: 'brand-1' })
    expect(byId.comp).toMatchObject({ kind: 'competitor', termId: 'rival-1' })
    expect(byId.kw).toMatchObject({ kind: 'opportunity', termId: 'kw-1' })
  })

  it('dedupes the same post returned by several queries', async () => {
    const { store, inserted } = makeStore({
      terms: { s1: [brand, { ...rival, id: 'brand-alias', kind: 'brand' as const, label: 'Acme App' }] },
    })
    const hn = source('hackernews', async () => [post('same', 'Acme App is neat')])
    const summary = await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
    expect(hn.search).toHaveBeenCalledTimes(2)
    expect(inserted).toHaveLength(1)
    expect(summary.inserted).toBe(1)
  })

  it('trims excerpts to about 500 characters and includes the title', async () => {
    const { store, inserted } = makeStore({})
    const hn = source('hackernews', async () => [post('long', `Acme ${'x'.repeat(2000)}`, { title: 'Show HN: Acme' })])
    await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
    expect(inserted[0].excerpt.length).toBeLessThanOrEqual(500)
    expect(inserted[0].excerpt.startsWith('Show HN: Acme Acme')).toBe(true)
    expect(inserted[0].title).toBe('Show HN: Acme')
  })

  it('passes since and a limit of 50, records usage and updates the cursor', async () => {
    const lastPolledAt = new Date(NOW.getTime() - 2 * HOUR)
    const { store, cursorWrites } = makeStore({ cursors: [{ siteId: 's1', source: 'hackernews', lastPolledAt }] })
    const hn = source('hackernews')
    const usage = vi.fn()
    await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: usage })

    expect(hn.search).toHaveBeenCalledWith({
      query: 'Acme',
      since: new Date(lastPolledAt.getTime() - HOUR),
      limit: 50,
    })
    expect(usage).toHaveBeenCalledWith('t1', 'mentions:hackernews:requests', 1)
    expect(cursorWrites).toEqual([['s1', 'hackernews', NOW, null, { at: NOW, consecutiveFailures: 0 }]])
  })
})

describe('pollMentions errors', () => {
  it('records the error for one source and keeps polling the others', async () => {
    const { store, cursorWrites } = makeStore({})
    const failing = source('reddit', async () => {
      throw new SocialSourceError('reddit', 'auth', 'bad credentials', 401)
    })
    const ok = source('bluesky')
    const summary = await pollMentions({ now: NOW }, { store, sources: [failing, ok], recordUsage: vi.fn() })

    expect(summary.errors).toBe(1)
    expect(ok.search).toHaveBeenCalled()
    const failedWrite = cursorWrites.find((w) => w[1] === 'reddit')!
    expect(failedWrite[3]).toBe('auth: bad credentials')
    // The watermark does not advance on failure
    expect((failedWrite[2] as Date).getTime()).toBe(computeSince(null, NOW).getTime())
  })

  it('stops a rate limited source for the rest of the run', async () => {
    const { store } = makeStore({ sites: [site({ siteId: 'a' }), site({ siteId: 'b' })] })
    const limited = source('reddit', async () => {
      throw new SocialSourceError('reddit', 'rate_limit', 'slow down', 429)
    })
    const hn = source('hackernews')
    await pollMentions({ now: NOW, concurrency: 1 }, { store, sources: [limited, hn], recordUsage: vi.fn() })
    expect(limited.search).toHaveBeenCalledTimes(1)
    expect(hn.search).toHaveBeenCalledTimes(2)
  })

  it('treats non-source errors as a failed source without throwing', async () => {
    const { store, cursorWrites } = makeStore({})
    const broken = source('hackernews', async () => {
      throw new Error('secret body text')
    })
    const summary = await pollMentions({ now: NOW }, { store, sources: [broken], recordUsage: vi.fn() })
    expect(summary.errors).toBe(1)
    expect(String(cursorWrites[0][3])).not.toContain('secret')
  })
})

describe('failure backoff and starvation', () => {
  it('computes retryDelayMs as min(2^failures * 15min, 6h)', () => {
    expect(retryDelayMs(0)).toBe(30 * 60 * 1000)
    expect(retryDelayMs(1)).toBe(30 * 60 * 1000)
    expect(retryDelayMs(2)).toBe(60 * 60 * 1000)
    expect(retryDelayMs(3)).toBe(2 * HOUR)
    expect(retryDelayMs(5)).toBe(6 * HOUR)
    expect(retryDelayMs(50)).toBe(6 * HOUR)
  })

  it('schedules on the last attempt, not the watermark, and backs off failing sources', async () => {
    const old = new Date(NOW.getTime() - 3 * 24 * HOUR)
    const { store } = makeStore({
      cursors: [
        // failed 10 minutes ago twice: not due again for an hour
        {
          siteId: 's1',
          source: 'hackernews',
          lastPolledAt: old,
          lastAttemptAt: new Date(NOW.getTime() - 10 * 60 * 1000),
          consecutiveFailures: 2,
        },
        // failed 2 hours ago twice: due
        {
          siteId: 's1',
          source: 'bluesky',
          lastPolledAt: old,
          lastAttemptAt: new Date(NOW.getTime() - 2 * HOUR),
          consecutiveFailures: 2,
        },
      ],
    })
    const hn = source('hackernews')
    const bsky = source('bluesky')
    await pollMentions({ now: NOW }, { store, sources: [hn, bsky], recordUsage: vi.fn() })
    expect(hn.search).not.toHaveBeenCalled()
    expect(bsky.search).toHaveBeenCalledTimes(1)
  })

  it('records the attempt and counts failures, keeping the watermark', async () => {
    const lastPolledAt = new Date(NOW.getTime() - 5 * HOUR)
    const { store, cursorWrites } = makeStore({
      cursors: [{ siteId: 's1', source: 'hackernews', lastPolledAt, consecutiveFailures: 2 }],
    })
    const failing = source('hackernews', async () => {
      throw new SocialSourceError('hackernews', 'server', 'boom', 500)
    })
    await pollMentions({ now: NOW }, { store, sources: [failing], recordUsage: vi.fn() })
    expect(cursorWrites[0][2]).toEqual(lastPolledAt)
    expect(cursorWrites[0][4]).toEqual({ at: NOW, consecutiveFailures: 3 })
  })

  it('does not let a permanently failing site hog the maxSites slots', async () => {
    const { store } = makeStore({
      sites: [site({ siteId: 'bad' }), site({ siteId: 'good' })],
      cursors: [
        {
          siteId: 'bad',
          source: 'hackernews',
          lastPolledAt: new Date(NOW.getTime() - 30 * 24 * HOUR),
          lastAttemptAt: new Date(NOW.getTime() - 7 * HOUR),
          consecutiveFailures: 9,
        },
        { siteId: 'good', source: 'hackernews', lastPolledAt: new Date(NOW.getTime() - 2 * HOUR) },
      ],
    })
    const writes: string[] = []
    store.saveCursor = async (siteId) => {
      writes.push(siteId)
    }
    await pollMentions({ now: NOW, maxSites: 1 }, { store, sources: [source('hackernews')], recordUsage: vi.fn() })
    // "bad" was attempted 7h ago (older than good's 2h) so it goes first, but only once per backoff window
    expect(writes).toEqual(['bad'])
    writes.length = 0
    const again = makeStore({
      sites: [site({ siteId: 'bad' }), site({ siteId: 'good' })],
      cursors: [
        {
          siteId: 'bad',
          source: 'hackernews',
          lastPolledAt: new Date(NOW.getTime() - 30 * 24 * HOUR),
          lastAttemptAt: NOW,
          consecutiveFailures: 10,
        },
        { siteId: 'good', source: 'hackernews', lastPolledAt: new Date(NOW.getTime() - 2 * HOUR) },
      ],
    })
    again.store.saveCursor = async (siteId) => {
      writes.push(siteId)
    }
    await pollMentions(
      { now: NOW, maxSites: 1 },
      { store: again.store, sources: [source('hackernews')], recordUsage: vi.fn() }
    )
    expect(writes).toEqual(['good'])
  })
})

describe('computeSince', () => {
  it('uses a one hour overlap and a seven day floor', () => {
    expect(computeSince(new Date(NOW.getTime() - 2 * HOUR), NOW)).toEqual(new Date(NOW.getTime() - 3 * HOUR))
    expect(computeSince(new Date(NOW.getTime() - 30 * 24 * HOUR), NOW)).toEqual(new Date(NOW.getTime() - 7 * 24 * HOUR))
    expect(computeSince(null, NOW)).toEqual(new Date(NOW.getTime() - 7 * 24 * HOUR))
  })
})

describe('retention', () => {
  it('deletes in batches older than 180 days until a short batch', async () => {
    const deleteOlderThan = vi.fn().mockResolvedValueOnce(500).mockResolvedValueOnce(120)
    const total = await pruneOldMentions({ deleteOlderThan } as unknown as MentionsStore, NOW)
    expect(total).toBe(620)
    expect(deleteOlderThan).toHaveBeenCalledTimes(2)
    expect(deleteOlderThan.mock.calls[0][0]).toEqual(new Date(NOW.getTime() - 180 * 24 * HOUR))
  })

  it('runs as part of every poll', async () => {
    const { store } = makeStore({ sites: [] })
    await pollMentions({ now: NOW }, { store, sources: [], recordUsage: vi.fn() })
    expect(store.deleteOlderThan).toHaveBeenCalled()
  })
})

describe('buildExcerpt', () => {
  it('collapses whitespace', () => {
    expect(buildExcerpt('T', 'a\n\n  b')).toBe('T a b')
  })
})

describe('pollMentions throughput and multi-replica safety', () => {
  const sitesN = (n: number) => Array.from({ length: n }, (_, i) => site({ siteId: `s${i}` }))

  it('claims each (site, source) cursor before polling and skips pairs another replica holds', async () => {
    const { store } = makeStore({ sites: [site({ siteId: 'a' }), site({ siteId: 'b' })] })
    const order: string[] = []
    store.claimCursor = vi.fn(async (siteId) => {
      order.push(`claim:${siteId}`)
      return siteId === 'a' // replica 2 already took b
    })
    const hn = source('hackernews', async () => {
      order.push('search')
      return []
    })
    const summary = await pollMentions({ now: NOW, concurrency: 1 }, { store, sources: [hn], recordUsage: vi.fn() })
    expect(hn.search).toHaveBeenCalledTimes(1)
    expect(order.slice(0, 2)).toEqual(['claim:a', 'search'])
    expect(summary).toMatchObject({ sitesPolled: 1, sourcesPolled: 1 })
    // claim passes the window start and the 15 minute lease
    expect(store.claimCursor).toHaveBeenCalledWith('a', 'hackernews', NOW, computeSince(null, NOW), 15 * 60 * 1000)
  })

  it('two workers running at once poll each pair exactly once', async () => {
    const claimed = new Set<string>()
    const mk = () => makeStore({ sites: sitesN(6) }).store
    const claimCursor = async (siteId: string, src: string) => {
      const key = `${siteId}:${src}`
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    }
    const a = mk()
    const b = mk()
    a.claimCursor = claimCursor
    b.claimCursor = claimCursor
    const hnA = source('hackernews', async () => [])
    const hnB = source('hackernews', async () => [])
    await Promise.all([
      pollMentions({ now: NOW, concurrency: 2 }, { store: a, sources: [hnA], recordUsage: vi.fn() }),
      pollMentions({ now: NOW, concurrency: 2 }, { store: b, sources: [hnB], recordUsage: vi.fn() }),
    ])
    expect(hnA.search.mock.calls.length + hnB.search.mock.calls.length).toBe(6)
  })

  it('polls at most 8 sites at a time', async () => {
    const { store } = makeStore({ sites: sitesN(24) })
    let now = 0
    let max = 0
    const hn = source('hackernews', async () => {
      now++
      max = Math.max(max, now)
      await new Promise((r) => setTimeout(r, 5))
      now--
      return []
    })
    const summary = await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
    expect(summary.sitesPolled).toBe(24)
    expect(max).toBeLessThanOrEqual(8)
    expect(max).toBeGreaterThan(1)
  })

  it('stops starting work once the wall-clock budget is spent and leaves the rest for the next run', async () => {
    const { store, cursorWrites } = makeStore({ sites: sitesN(6) })
    let t = 0
    const hn = source('hackernews', async () => {
      t += 30_000
      return []
    })
    const summary = await pollMentions(
      { now: NOW, concurrency: 1, budgetMs: 45_000 },
      { store, sources: [hn], recordUsage: vi.fn(), clock: () => t }
    )
    expect(hn.search).toHaveBeenCalledTimes(2)
    expect(summary.sitesPolled).toBe(2)
    expect(cursorWrites).toHaveLength(2)
  })

  it('does not advance the watermark when the budget cuts a site short mid-queries', async () => {
    const aliases = Array.from({ length: 4 }, (_, i) => `alias${i}`)
    const { store, cursorWrites } = makeStore({ terms: { s1: [{ ...brand, aliases }] } })
    let t = 0
    const hn = source('hackernews', async () => {
      t += 30_000
      return []
    })
    await pollMentions({ now: NOW, budgetMs: 45_000 }, { store, sources: [hn], recordUsage: vi.fn(), clock: () => t })
    expect(hn.search).toHaveBeenCalledTimes(2)
    expect(cursorWrites).toHaveLength(1)
    expect((cursorWrites[0][2] as Date).getTime()).toBe(computeSince(null, NOW).getTime())
    expect(cursorWrites[0][3]).toBeNull()
  })

  describe('query rotation', () => {
    const manyTerms = (n: number): MatchTerm[] =>
      Array.from({ length: n }, (_, i) => ({ id: `t${i}`, kind: 'brand' as const, label: `Brand${i}`, aliases: [] }))

    it('caps queries per run at 20 and covers different slices on consecutive runs', async () => {
      const queriesAt = async (now: Date) => {
        const { store } = makeStore({ terms: { s1: manyTerms(45) } })
        const hn = source('hackernews')
        await pollMentions({ now }, { store, sources: [hn], recordUsage: vi.fn() })
        return hn.search.mock.calls.map((c) => (c[0] as { query: string }).query)
      }
      const t0 = new Date('2026-10-10T12:00:00Z')
      const runs = [
        await queriesAt(t0),
        await queriesAt(new Date(t0.getTime() + 30 * 60 * 1000)),
        await queriesAt(new Date(t0.getTime() + 60 * 60 * 1000)),
      ]
      expect(runs.map((r) => r.length).sort((a, b) => a - b)).toEqual([5, 20, 20])
      // together they cover all 45 queries exactly once
      expect(new Set(runs.flat()).size).toBe(45)
    })

    it('does not rotate sites with 20 queries or fewer', async () => {
      const { store } = makeStore({ terms: { s1: manyTerms(20) } })
      const hn = source('hackernews')
      await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
      expect(hn.search).toHaveBeenCalledTimes(20)
    })

    it('holds the watermark back by the rotation cycle so unsearched slices stay inside the next window', async () => {
      const { store, cursorWrites } = makeStore({ terms: { s1: manyTerms(45) } })
      await pollMentions({ now: NOW }, { store, sources: [source('hackernews')], recordUsage: vi.fn() })
      // 3 slices: watermark = now - 2 intervals (30 min each), but never before the window start
      const written = cursorWrites[0][2] as Date
      expect(written.getTime()).toBe(Math.max(computeSince(null, NOW).getTime(), NOW.getTime() - 2 * 30 * 60 * 1000))
      expect(written.getTime()).toBeLessThan(NOW.getTime())
    })

    it('exposes the helpers', () => {
      expect(selectQuerySlice([1, 2, 3], NOW)).toEqual({ slice: [1, 2, 3], slices: 1 })
      expect(rotationWatermark(null, new Date(0), NOW, 1)).toEqual(NOW)
    })
  })

  it('a rate limit from one site stops that source for later sites, other sources continue', async () => {
    const { store } = makeStore({ sites: sitesN(4) })
    const limited = source('reddit', async () => {
      throw new SocialSourceError('reddit', 'rate_limit', 'slow down', 429)
    })
    const hn = source('hackernews')
    const summary = await pollMentions(
      { now: NOW, concurrency: 1 },
      { store, sources: [limited, hn], recordUsage: vi.fn() }
    )
    expect(limited.search).toHaveBeenCalledTimes(1)
    expect(hn.search).toHaveBeenCalledTimes(4)
    // only the site that hit the limit is marked failed
    expect(summary.errors).toBe(1)
  })
})
