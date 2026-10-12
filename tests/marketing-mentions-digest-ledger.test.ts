import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const dbState = vi.hoisted(() => ({
  executed: [] as unknown[],
  insertCalls: [] as Array<{ values: unknown; conflict: string }>,
  insertReturning: [] as unknown[][],
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    execute: async (query: unknown) => {
      dbState.executed.push(query)
      return { rows: [] }
    },
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            dbState.insertCalls.push({ values, conflict: 'do-nothing' })
            return dbState.insertReturning.shift() ?? []
          },
        }),
      }),
    }),
  },
}))
vi.mock('~/lib/email', () => ({ sendMarketingMentionsDigestEmail: vi.fn() }))

const { sendMentionsDigests, digestWindowEnd, digestMetric } =
  await import('~/server/services/marketing/mentions/digest')

type Digests = Parameters<typeof sendMentionsDigests>[1]

const counts = { mention: 2, competitor: 0, opportunity: 0 }
const NOW = new Date('2026-10-12T08:00:00Z')

const siteFor = (siteId: string, teamId: string) => ({
  siteId,
  teamId,
  projectId: `p-${siteId}`,
  projectName: `Product ${siteId}`,
  projectSlug: siteId,
  projectSettings: { marketingEnabled: true },
  teamMarketingEnabled: true,
})

/** In-memory ledger with the same semantics as INSERT ... ON CONFLICT DO NOTHING RETURNING */
function sharedLedger() {
  const rows = new Set<string>()
  return {
    rows,
    ledger: {
      listClaimed: async (date: string) =>
        new Set([...rows].filter((r) => r.endsWith(`|${date}`)).map((r) => r.split('|')[0])),
      claim: async (teamIds: string[], date: string) => {
        const won = new Set<string>()
        for (const teamId of teamIds) {
          const key = `${teamId}|${date}`
          if (!rows.has(key)) {
            rows.add(key)
            won.add(teamId)
          }
        }
        return won
      },
      release: async (teamIds: string[], date: string) => {
        for (const teamId of teamIds) rows.delete(`${teamId}|${date}`)
      },
    },
  }
}

function makeWorker(
  ledger: ReturnType<typeof sharedLedger>['ledger'],
  sites: ReturnType<typeof siteFor>[],
  send = vi.fn().mockResolvedValue(undefined),
  extra: Partial<NonNullable<Digests>> = {}
) {
  const loadDigestContents = vi.fn(
    async (siteIds: string[]) => new Map(siteIds.map((id) => [id, { counts, items: [] }]))
  )
  const loadAdminEmailsForTeams = vi.fn(async (teamIds: string[]) => new Map(teamIds.map((t) => [t, [`${t}@x.test`]])))
  const deps: Digests = {
    store: { loadVerifiedSites: async () => sites },
    ledger,
    loadSitesWithNewMentions: async () => new Set(sites.map((s) => s.siteId)),
    loadDigestContents,
    loadAdminEmailsForTeams,
    sendEmail: send,
    baseUrl: 'https://app.test/',
    ...extra,
  }
  return { deps, send, loadDigestContents, loadAdminEmailsForTeams }
}

describe('mentions digest ledger', () => {
  it('emails each eligible team once and records the claim', async () => {
    const { ledger, rows } = sharedLedger()
    const w = makeWorker(ledger, [siteFor('s1', 't1'), siteFor('s2', 't2')])
    const summary = await sendMentionsDigests({ now: NOW }, w.deps)
    expect(summary).toMatchObject({ sitesNotified: 2, emailsSent: 2, errors: 0, teamsProcessed: 2, teamsDeferred: 0 })
    expect(rows).toEqual(new Set(['t1|2026-10-12', 't2|2026-10-12']))
    expect(w.send.mock.calls[0][0]).toMatchObject({
      to: 't1@x.test',
      productName: 'Product s1',
      mentionsUrl: 'https://app.test/marketing/mentions?product=s1',
    })
  })

  it('only one of two simultaneous workers sends a team its digest', async () => {
    const { ledger } = sharedLedger()
    const sites = Array.from({ length: 10 }, (_, i) => siteFor(`s${i}`, `t${i}`))
    const send = vi.fn().mockResolvedValue(undefined)
    const a = makeWorker(ledger, sites, send)
    const b = makeWorker(ledger, sites, send)
    // Both list the ledger before either claims, so only the atomic claim keeps them apart
    const [ra, rb] = await Promise.all([
      sendMentionsDigests({ now: NOW, teamBatch: 3 }, a.deps),
      sendMentionsDigests({ now: NOW, teamBatch: 3 }, b.deps),
    ])
    const recipients = send.mock.calls.map((c) => c[0].to)
    expect(new Set(recipients).size).toBe(recipients.length)
    expect(recipients).toHaveLength(10)
    expect(ra.teamsProcessed + rb.teamsProcessed).toBe(10)
  })

  it('a later run skips teams already claimed today and does not send again', async () => {
    const { ledger } = sharedLedger()
    const sites = [siteFor('s1', 't1')]
    const first = makeWorker(ledger, sites)
    await sendMentionsDigests({ now: NOW }, first.deps)
    const second = makeWorker(ledger, sites)
    const summary = await sendMentionsDigests({ now: new Date('2026-10-12T09:00:00Z') }, second.deps)
    expect(second.send).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ emailsSent: 0, teamsProcessed: 0, teamsAlreadyClaimed: 1 })
  })

  it('claims the next day again', async () => {
    const { ledger } = sharedLedger()
    const sites = [siteFor('s1', 't1')]
    const w = makeWorker(ledger, sites)
    await sendMentionsDigests({ now: NOW }, w.deps)
    await sendMentionsDigests({ now: new Date('2026-10-13T08:00:00Z') }, w.deps)
    expect(w.send).toHaveBeenCalledTimes(2)
  })

  it('stops at the time budget and the next run resumes with the unclaimed teams', async () => {
    const { ledger } = sharedLedger()
    const sites = Array.from({ length: 6 }, (_, i) => siteFor(`s${i}`, `t${i}`))
    let t = 0
    const send = vi.fn().mockImplementation(async () => {
      t += 20_000
    })
    const w1 = makeWorker(ledger, sites, send, { clock: () => t })
    const first = await sendMentionsDigests({ now: NOW, teamBatch: 2, budgetMs: 45_000 }, w1.deps)
    // The budget is checked per email: batch 1 sends at 0 s and 20 s, batch 2 sends one at 40 s, and the
    // next email (60 s) is past the budget, so that team's claim is released and batch 3 never starts
    expect(first.teamsProcessed).toBe(3)
    expect(first.teamsDeferred).toBe(3)

    const w2 = makeWorker(ledger, sites, send)
    const second = await sendMentionsDigests({ now: new Date('2026-10-12T09:00:00Z') }, w2.deps)
    expect(second.teamsProcessed).toBe(3)
    expect(second.teamsAlreadyClaimed).toBe(3)
    const recipients = send.mock.calls.map((c) => c[0].to)
    expect(new Set(recipients).size).toBe(6)
  })

  it('sends up to 10 emails at once within a batch', async () => {
    const { ledger } = sharedLedger()
    const sites = Array.from({ length: 25 }, (_, i) => siteFor(`s${i}`, `t${i}`))
    let inFlight = 0
    let max = 0
    const send = vi.fn().mockImplementation(async () => {
      inFlight += 1
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
    })
    const w = makeWorker(ledger, sites, send)
    const summary = await sendMentionsDigests({ now: NOW }, w.deps)
    expect(summary.emailsSent).toBe(25)
    expect(max).toBe(10)
  })

  it('checks the time budget before every email, not only per batch', async () => {
    const { ledger, rows } = sharedLedger()
    const sites = Array.from({ length: 4 }, (_, i) => siteFor(`s${i}`, `t${i}`))
    let t = 0
    const send = vi.fn().mockImplementation(async () => {
      t += 50_000
    })
    const w = makeWorker(ledger, sites, send, { clock: () => t })
    const summary = await sendMentionsDigests({ now: NOW, teamBatch: 25, budgetMs: 45_000 }, w.deps)
    // one batch of four teams: only the first email starts before the budget is gone
    expect(send).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ emailsSent: 1, teamsProcessed: 1, teamsDeferred: 3 })
    expect(rows.size).toBe(1)
  })

  it('releases the claim when every email of a team fails so the next hourly run retries', async () => {
    const { ledger, rows } = sharedLedger()
    const sites = [siteFor('s1', 't1'), siteFor('s2', 't2')]
    const send = vi.fn().mockImplementation(async ({ to }: { to: string }) => {
      if (to === 't1@x.test') throw new Error('smtp down')
    })
    const w = makeWorker(ledger, sites, send)
    const summary = await sendMentionsDigests({ now: NOW }, w.deps)
    expect(summary).toMatchObject({ emailsSent: 1, errors: 1 })
    expect(rows).toEqual(new Set(['t2|2026-10-12']))
  })

  it('releases the claims when loading content fails for the batch', async () => {
    const { ledger, rows } = sharedLedger()
    const w = makeWorker(ledger, [siteFor('s1', 't1')], undefined, {
      loadDigestContents: async () => {
        throw new Error('db down')
      },
    })
    const summary = await sendMentionsDigests({ now: NOW }, w.deps)
    expect(summary.errors).toBe(1)
    expect(rows.size).toBe(0)
  })

  it('batches the per-site queries: one content load and one admin lookup per team batch, not per site', async () => {
    const { ledger } = sharedLedger()
    const sites = Array.from({ length: 10 }, (_, i) => siteFor(`s${i}`, `t${i % 5}`))
    const w = makeWorker(ledger, sites)
    await sendMentionsDigests({ now: NOW, teamBatch: 25 }, w.deps)
    expect(w.loadDigestContents).toHaveBeenCalledTimes(1)
    expect(w.loadDigestContents.mock.calls[0][0]).toHaveLength(10)
    expect(w.loadAdminEmailsForTeams).toHaveBeenCalledTimes(1)
  })

  it('ignores sites with no new mentions, sites with a module switch off, and teams with no opted-in admin', async () => {
    const { ledger, rows } = sharedLedger()
    const sites = [
      siteFor('quiet', 'tq'),
      { ...siteFor('off', 'to'), teamMarketingEnabled: false },
      siteFor('noadmins', 'tn'),
      siteFor('ok', 'tk'),
    ]
    const w = makeWorker(ledger, sites, undefined, {
      loadSitesWithNewMentions: async () => new Set(['off', 'noadmins', 'ok']),
      loadAdminEmailsForTeams: async (teamIds) => new Map(teamIds.map((t) => [t, t === 'tn' ? [] : [`${t}@x.test`]])),
    })
    const summary = await sendMentionsDigests({ now: NOW }, w.deps)
    expect(summary.emailsSent).toBe(1)
    // the quiet and switched-off teams never touch the ledger
    expect([...rows].some((r) => r.startsWith('tq') || r.startsWith('to'))).toBe(false)
  })

  it('anchors the 24 h window at 07:00 UTC so a resumed run covers the same window', () => {
    expect(digestWindowEnd(new Date('2026-10-12T10:00:00Z')).toISOString()).toBe('2026-10-12T07:00:00.000Z')
    expect(digestWindowEnd(new Date('2026-10-12T07:00:00Z')).toISOString()).toBe('2026-10-12T07:00:00.000Z')
    expect(digestMetric('2026-10-12')).toBe('digest:2026-10-12')
  })
})

describe('default ledger and batched content (SQL)', () => {
  it('selects sites with new mentions in one statement using the new-mention index columns', async () => {
    dbState.executed = []
    const { sendMentionsDigests: run } = await import('~/server/services/marketing/mentions/digest')
    // No deps for the loaders: the first statement executed must be the site prefilter
    await run(
      { now: NOW },
      {
        store: { loadVerifiedSites: async () => [] },
        ledger: { listClaimed: async () => new Set(), claim: async () => new Set(), release: async () => undefined },
      }
    ).catch(() => undefined)
    const dialect = new PgDialect()
    const text = dialect.sqlToQuery(dbState.executed[0] as Parameters<typeof dialect.sqlToQuery>[0]).sql
    expect(text).toMatch(/SELECT DISTINCT site_id FROM mention/)
    expect(text).toMatch(/status = 'new' AND created_at >=/)
  })
})
