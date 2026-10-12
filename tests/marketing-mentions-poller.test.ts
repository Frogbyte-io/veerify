import { describe, expect, it, vi } from 'vitest'
import type { CandidateSite, MentionInsert, MentionsStore } from '~/server/services/marketing/mentions/store'
import type { MatchTerm, SocialPost, SocialSource } from '~/server/services/social-sources'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/utils/marketing-usage', () => ({ recordUsage: vi.fn() }))

const { pollMentions, computeSince, retryDelayMs, buildExcerpt, pruneOldMentions, selectQuerySlice, planRotation } =
  await import('~/server/services/marketing/mentions/poller')
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
    queryOffset?: number
    cycleStartedAt?: Date | null
  }[]
}) {
  const inserted: MentionInsert[] = []
  const cursorWrites: unknown[][] = []
  const releases: unknown[][] = []
  const store: MentionsStore = {
    loadVerifiedSites: async () => opts.sites ?? [site()],
    loadDueSites: async () => opts.sites ?? [site()],
    claimCursor: async () => true,
    releaseClaim: async (...args) => {
      releases.push(args)
    },
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
  return { store, inserted, cursorWrites, releases }
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
    expect(cursorWrites).toEqual([
      ['s1', 'hackernews', NOW, null, { at: NOW, consecutiveFailures: 0, queryOffset: 0, cycleStartedAt: null }],
    ])
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
    expect(cursorWrites[0][4]).toEqual({ at: NOW, consecutiveFailures: 3, queryOffset: 0, cycleStartedAt: NOW })
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

  it('polls at most 16 sites at a time (default)', async () => {
    const { store } = makeStore({ sites: sitesN(40) })
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
    expect(summary.sitesPolled).toBe(40)
    expect(max).toBeLessThanOrEqual(16)
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

    /** In-memory cursor so consecutive runs see what the previous run saved (as the DB would). */
    function statefulStore(terms: MatchTerm[]) {
      const base = makeStore({ terms: { s1: terms } })
      let cursor: { lastPolledAt: Date; queryOffset: number; cycleStartedAt: Date | null } | null = null
      base.store.loadCursors = async () =>
        cursor
          ? [{ siteId: 's1', source: 'hackernews' as const, lastAttemptAt: null, consecutiveFailures: 0, ...cursor }]
          : []
      base.store.saveCursor = async (siteId, src, lastPolledAt, err, attempt) => {
        cursor = { lastPolledAt, queryOffset: attempt.queryOffset, cycleStartedAt: attempt.cycleStartedAt }
        base.cursorWrites.push([siteId, src, lastPolledAt, err, attempt])
      }
      return { ...base, cursor: () => cursor }
    }

    it('caps queries per run at 20 and covers every slice, across irregular gaps between runs', async () => {
      const { store } = statefulStore(manyTerms(45))
      const seen: string[][] = []
      const gaps = [0, 31, 400, 33, 3000, 45, 31]
      let t = NOW.getTime()
      for (const gapMinutes of gaps) {
        t += gapMinutes * 60 * 1000
        const hn = source('hackernews')
        await pollMentions({ now: new Date(t) }, { store, sources: [hn], recordUsage: vi.fn() })
        seen.push(hn.search.mock.calls.map((c) => (c[0] as { query: string }).query))
      }
      expect(seen.slice(0, 3).map((r) => r.length)).toEqual([20, 20, 5])
      // every one of the 45 queries is covered by the first three polls, whatever the gaps
      expect(new Set(seen.slice(0, 3).flat()).size).toBe(45)
      // the 4th poll starts a new cycle at the first query again
      expect(seen[3][0]).toBe(seen[0][0])
    })

    it('moves the watermark only when the offset wraps, to the start of the finished cycle', async () => {
      const { store, cursorWrites } = statefulStore(manyTerms(45))
      const t0 = NOW
      const t1 = new Date(NOW.getTime() + 31 * 60 * 1000)
      const t2 = new Date(NOW.getTime() + 5 * HOUR)
      const since0 = computeSince(null, t0)
      for (const now of [t0, t1, t2]) {
        await pollMentions({ now }, { store, sources: [source('hackernews')], recordUsage: vi.fn() })
      }
      const written = cursorWrites.map((w) => ({
        at: (w[2] as Date).getTime(),
        offset: (w[4] as { queryOffset: number }).queryOffset,
      }))
      expect(written.map((w) => w.offset)).toEqual([20, 40, 0])
      // the first two polls hold the watermark at the window start; the wrap moves it to the cycle start (t0)
      expect(written[0].at).toBe(since0.getTime())
      expect(written[1].at).toBe(since0.getTime())
      expect(written[2].at).toBe(t0.getTime())
    })

    it('does not rotate sites with 20 queries or fewer', async () => {
      const { store } = makeStore({ terms: { s1: manyTerms(20) } })
      const hn = source('hackernews')
      await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
      expect(hn.search).toHaveBeenCalledTimes(20)
    })

    it('restarts at 0 when the offset is past the end of a shrunken term list', () => {
      expect(selectQuerySlice([1, 2, 3], 40)).toEqual({ slice: [1, 2, 3], start: 0, slices: 1 })
      expect(
        selectQuerySlice(
          Array.from({ length: 45 }, (_, i) => i),
          20
        ).slice
      ).toHaveLength(20)
    })

    it('plans a single-slice site as always wrapped with the watermark at now', () => {
      const plan = planRotation({
        start: 0,
        processed: 3,
        queryCount: 3,
        now: NOW,
        previous: null,
        since: new Date(0),
        cycleStartedAt: null,
      })
      expect(plan).toMatchObject({ queryOffset: 0, watermark: NOW, wrapped: true })
    })
  })

  describe('per-query failures', () => {
    const manyTerms = (n: number): MatchTerm[] =>
      Array.from({ length: n }, (_, i) => ({ id: `t${i}`, kind: 'brand' as const, label: `Brand${i}`, aliases: [] }))

    it('saves the results of queries that succeeded and retries only from the failed one', async () => {
      const { store, inserted, cursorWrites } = makeStore({ terms: { s1: manyTerms(5) } })
      const hn = source('hackernews', async ({ query }) => {
        if (query.includes('Brand2')) throw new SocialSourceError('hackernews', 'server', 'boom', 500)
        return [post(`p-${query}`, `${query} is great`)]
      })
      const summary = await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
      expect(hn.search).toHaveBeenCalledTimes(5)
      expect(inserted.length).toBeGreaterThanOrEqual(4)
      expect(summary.errors).toBe(1)
      const write = cursorWrites[0]
      expect(String(write[3])).toMatch(/^partial: server/)
      // offset stops at the failed query; the watermark is held
      expect((write[4] as { queryOffset: number }).queryOffset).toBe(2)
      expect((write[4] as { consecutiveFailures: number }).consecutiveFailures).toBe(1)
      expect((write[2] as Date).getTime()).toBe(computeSince(null, NOW).getTime())
    })

    it('rotates past a query that keeps failing while others succeed', async () => {
      const { store, cursorWrites } = makeStore({
        terms: { s1: manyTerms(5) },
        cursors: [{ siteId: 's1', source: 'hackernews', lastPolledAt: NOW, consecutiveFailures: 2 }],
      })
      const hn = source('hackernews', async ({ query }) => {
        if (query.includes('Brand2')) throw new SocialSourceError('hackernews', 'server', 'boom', 500)
        return []
      })
      await pollMentions({ now: new Date(NOW.getTime() + 6 * HOUR) }, { store, sources: [hn], recordUsage: vi.fn() })
      expect((cursorWrites[0][4] as { queryOffset: number }).queryOffset).toBe(0)
    })
  })

  describe('source parallelism', () => {
    it("polls a site's sources at the same time", async () => {
      const { store } = makeStore({})
      let inFlight = 0
      let max = 0
      const slow = (id: SocialSource['id']) =>
        source(id, async () => {
          inFlight += 1
          max = Math.max(max, inFlight)
          await new Promise((r) => setTimeout(r, 10))
          inFlight -= 1
          return []
        })
      const summary = await pollMentions(
        { now: NOW },
        { store, sources: [slow('hackernews'), slow('reddit'), slow('bluesky')], recordUsage: vi.fn() }
      )
      expect(max).toBe(3)
      expect(summary).toMatchObject({ sitesPolled: 1, sourcesPolled: 3 })
    })

    it('reads the site concurrency from MARKETING_MENTIONS_CONCURRENCY, capped at 32', async () => {
      const original = process.env.MARKETING_MENTIONS_CONCURRENCY
      try {
        for (const [env, expected] of [
          ['4', 4],
          ['500', 32],
        ] as const) {
          process.env.MARKETING_MENTIONS_CONCURRENCY = env
          const { store } = makeStore({ sites: sitesN(60) })
          let inFlight = 0
          let max = 0
          const hn = source('hackernews', async () => {
            inFlight += 1
            max = Math.max(max, inFlight)
            await new Promise((r) => setTimeout(r, 5))
            inFlight -= 1
            return []
          })
          await pollMentions({ now: NOW }, { store, sources: [hn], recordUsage: vi.fn() })
          expect(max).toBe(expected)
        }
      } finally {
        if (original === undefined) delete process.env.MARKETING_MENTIONS_CONCURRENCY
        else process.env.MARKETING_MENTIONS_CONCURRENCY = original
      }
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
    expect(summary.errors).toBe(1)
  })

  it('leaves the cursor untouched on a rate limit: no failure counted, claim released', async () => {
    const lastPolledAt = new Date(NOW.getTime() - 2 * HOUR)
    const lastAttemptAt = new Date(NOW.getTime() - 40 * 60 * 1000)
    const { store, cursorWrites, releases } = makeStore({
      cursors: [{ siteId: 's1', source: 'reddit', lastPolledAt, lastAttemptAt, consecutiveFailures: 1 }],
    })
    const limited = source('reddit', async () => {
      throw new SocialSourceError('reddit', 'rate_limit', 'slow down', 429)
    })
    await pollMentions({ now: NOW }, { store, sources: [limited], recordUsage: vi.fn() })
    expect(cursorWrites).toHaveLength(0)
    expect(releases).toEqual([['s1', 'reddit', NOW, lastAttemptAt]])
  })
})
