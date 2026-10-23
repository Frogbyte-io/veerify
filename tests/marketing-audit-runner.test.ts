import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AuditStore, AuditRow, AuditSite, StoredPage } from '~/server/services/marketing/audit/store'
import type { RunnerDeps } from '~/server/services/marketing/audit/runner'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/utils/org-credentials', () => ({ getOrgApiKey: vi.fn(), markCredentialInvalid: vi.fn() }))
vi.mock('~/server/utils/marketing-usage', () => ({ recordUsage: vi.fn() }))

const { startAudit, advanceAudits, scheduleAudits, cancelAudit, getAuditStartStatus, MAX_CONSECUTIVE_ERRORS } =
  await import('~/server/services/marketing/audit/runner')
const { CrawlProviderError } = await import('~/server/services/crawl/types')

const HTML = (title: string) =>
  `<html lang="en"><head><title>${title} - a long enough title</title><meta name="description" content="${'d'.repeat(80)}"></head><body><h1>${title}</h1><a href="/about">About</a></body></html>`

class MemStore implements AuditStore {
  site: AuditSite = {
    id: 's1',
    projectId: 'p1',
    organizationId: 't1',
    origin: 'https://example.com',
    verifiedAt: new Date('2026-01-01'),
    marketingEnabled: true,
  }
  audits: AuditRow[] = []
  pages: Array<StoredPage & { auditId: string }> = []
  issues: Array<{ auditId: string; pageId: string | null; ruleId: string }> = []
  candidates: Array<{ siteId: string; lastAuditAt: Date | null }> = []
  pruned: Array<[string, number]> = []

  async loadSite(id: string) {
    return id === this.site.id ? this.site : null
  }
  async hasActiveAudit() {
    return this.audits.some((a) => ['queued', 'crawling', 'analyzing'].includes(a.status))
  }
  async manualAuditTimes(_s: string, since: Date) {
    return this.audits
      .filter((a) => a.trigger === 'manual' && a.createdAt >= since)
      .map((a) => a.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())
  }
  async insertAudit(row: Partial<AuditRow>) {
    this.audits.push({
      crawlProvider: null,
      crawlJobId: null,
      crawlCursor: null,
      pagesFetched: 0,
      score: null,
      siteFacts: null,
      error: null,
      requestedByUserId: null,
      startedAt: null,
      finishedAt: null,
      mode: 'basic',
      status: 'queued',
      ...row,
    } as AuditRow)
  }
  async getAudit(id: string) {
    return this.audits.find((a) => a.id === id) ?? null
  }
  async claimDue(exclude: string[], _now?: Date, _leaseUntil?: Date): Promise<AuditRow | null> {
    return (
      this.audits.find((a) => ['queued', 'crawling', 'analyzing'].includes(a.status) && !exclude.includes(a.id)) ?? null
    )
  }
  leaseHeld = true
  leaseExtensions = 0
  async extendLease(_id?: string, _now?: Date, _leaseUntil?: Date): Promise<boolean> {
    this.leaseExtensions++
    return this.leaseHeld
  }
  async updateAudit(id: string, patch: Partial<AuditRow>) {
    const audit = this.audits.find((a) => a.id === id)
    if (!audit || !['queued', 'crawling', 'analyzing'].includes(audit.status)) return false
    Object.assign(audit, patch)
    return true
  }
  async insertPages(rows: Array<{ id: string; auditId: string; url: string; facts: StoredPage['facts'] }>) {
    let n = 0
    for (const r of rows) {
      if (this.pages.some((p) => p.auditId === r.auditId && p.url === r.url)) continue
      this.pages.push({ id: r.id, auditId: r.auditId, url: r.url, facts: r.facts })
      n++
    }
    return n
  }
  async loadPages(auditId: string) {
    return this.pages.filter((p) => p.auditId === auditId)
  }
  async pageUrls(auditId: string) {
    return this.pages.filter((p) => p.auditId === auditId).map((p) => p.url)
  }
  async deleteIssues(auditId: string) {
    this.issues = this.issues.filter((i) => i.auditId !== auditId)
  }
  async insertIssues(rows: Array<{ auditId: string; pageId: string | null; ruleId: string }>) {
    this.issues.push(...rows)
  }
  async pruneAudits(siteId: string, keep: number) {
    this.pruned.push([siteId, keep])
  }
  async scheduleCandidates() {
    return this.candidates
  }
}

let store: MemStore
let clock: number
let idCounter: number
const provider = {
  id: 'firecrawl' as const,
  label: 'Firecrawl',
  validateKey: vi.fn(),
  startCrawl: vi.fn(),
  getCrawl: vi.fn(),
  cancelCrawl: vi.fn(),
}
const deps = (): Partial<RunnerDeps> => ({
  store,
  now: () => new Date(clock),
  newId: () => `id-${++idCounter}`,
  getCrawlProvider: () => provider,
  getOrgApiKey: vi.fn(async () => null) as never,
  markCredentialInvalid: vi.fn(async () => true) as never,
  recordUsage: vi.fn(async () => undefined) as never,
  fetchSiteFacts: vi.fn(async () => ({
    origin: 'https://example.com',
    robotsTxt: { status: 200, body: 'User-agent: GPTBot\nDisallow: /\n' },
    llmsTxt: { status: 404, body: null },
    sitemapXml: { status: 200, body: '<urlset><url><loc>https://example.com/</loc></url></urlset>' },
  })),
  fetchHomePage: vi.fn(async () => ({ url: 'https://example.com/', statusCode: 200, html: HTML('Home') })),
  runPageSpeed: vi.fn(),
})

const prevEnv = { ...process.env }
beforeEach(() => {
  store = new MemStore()
  clock = Date.parse('2026-10-10T12:00:00Z')
  idCounter = 0
  for (const fn of Object.values(provider)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
  delete process.env.FIRECRAWL_API_KEY
  delete process.env.PAGESPEED_API_KEY
  delete process.env.MARKETING_MANUAL_AUDITS_PER_DAY
  process.env.MARKETING_MAX_AUDIT_PAGES = '3'
  provider.cancelCrawl.mockResolvedValue(undefined)
})
afterEach(() => {
  process.env = { ...prevEnv }
})

function withFull(d: Partial<RunnerDeps>): Partial<RunnerDeps> {
  return {
    ...d,
    getOrgApiKey: vi.fn(async () => ({ apiKey: 'team-key', status: 'valid', monthlyBudgetCents: null })) as never,
  }
}

describe('startAudit guards', () => {
  it('refuses unverified sites in every mode', async () => {
    store.site.verifiedAt = null
    await expect(startAudit({ siteId: 's1', trigger: 'manual' }, deps())).rejects.toMatchObject({ statusCode: 403 })
    expect(store.audits).toHaveLength(0)
  })

  it('refuses when marketing is off', async () => {
    store.site.marketingEnabled = false
    await expect(startAudit({ siteId: 's1', trigger: 'auto' }, deps())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a second active audit with 409', async () => {
    await startAudit({ siteId: 's1', trigger: 'manual' }, deps())
    await expect(startAudit({ siteId: 's1', trigger: 'manual' }, deps())).rejects.toMatchObject({ statusCode: 409 })
  })

  it('limits manual audits per rolling day with 429 and a reset time', async () => {
    process.env.MARKETING_MANUAL_AUDITS_PER_DAY = '2'
    for (let i = 0; i < 2; i++) {
      await startAudit({ siteId: 's1', trigger: 'manual' }, deps())
      store.audits[i].status = 'done'
      clock += 3_600_000
    }
    const err = await startAudit({ siteId: 's1', trigger: 'manual' }, deps()).catch((e) => e)
    expect(err.statusCode).toBe(429)
    expect(err.data.error.details.resetsAt).toBe('2026-10-11T12:00:00.000Z')
    const status = await getAuditStartStatus('s1', 'manual', deps())
    expect(status).toMatchObject({ canStart: false, reason: 'daily_limit' })
    // scheduled audits are not limited
    await expect(startAudit({ siteId: 's1', trigger: 'schedule' }, deps())).resolves.toBeTruthy()
    // the window rolls
    store.audits.forEach((a) => (a.status = 'done'))
    clock += 24 * 3_600_000
    await expect(startAudit({ siteId: 's1', trigger: 'manual' }, deps())).resolves.toBeTruthy()
  })

  it('maps a unique violation on insert (concurrent start) to the 409 already-running error', async () => {
    store.insertAudit = vi.fn(async () => {
      throw Object.assign(new Error('failed query'), { cause: Object.assign(new Error('dup'), { code: '23505' }) })
    }) as never
    const err = await startAudit({ siteId: 's1', trigger: 'manual' }, deps()).catch((e) => e)
    expect(err.statusCode).toBe(409)
    expect(err.data.error.details.reason).toBe('active_audit')
  })

  it('picks the mode from the resolved crawl config and caps pages', async () => {
    const basic = await startAudit({ siteId: 's1', trigger: 'manual' }, deps())
    expect(basic.mode).toBe('basic')
    expect(store.audits[0].pageLimit).toBe(3)
    store.audits[0].status = 'done'
    const full = await startAudit({ siteId: 's1', trigger: 'schedule' }, withFull(deps()))
    expect(full.mode).toBe('full')
    store.audits[1].status = 'done'
    process.env.FIRECRAWL_API_KEY = 'instance'
    const inst = await startAudit({ siteId: 's1', trigger: 'schedule' }, deps())
    expect(inst.mode).toBe('full')
  })

  it('ignores a team key already marked invalid', async () => {
    const d = {
      ...deps(),
      getOrgApiKey: vi.fn(async () => ({ apiKey: 'bad', status: 'invalid', monthlyBudgetCents: null })) as never,
    }
    expect((await startAudit({ siteId: 's1', trigger: 'manual' }, d)).mode).toBe('basic')
  })
})

describe('basic audit', () => {
  it('runs end to end: home page, site files, issues, score, retention', async () => {
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)

    const audit = store.audits[0]
    expect(audit.status).toBe('done')
    expect(audit.score).toBeGreaterThan(0)
    expect(audit.score).toBeLessThan(100)
    expect(store.pages).toHaveLength(1)
    expect(store.issues.some((i) => i.ruleId === 'llms-txt-missing' || i.ruleId.includes('llms'))).toBe(true)
    const facts = audit.siteFacts as Record<string, any>
    expect(facts._runtime).toBeUndefined()
    expect(facts.robotsTxt.status).toBe('found')
    expect(facts.llmsTxt.status).toBe('missing')
    expect(facts.sitemap).toMatchObject({ status: 'found', kind: 'urlset', urlCount: 1 })
    expect(facts.crawlerAccess.find((c: any) => c.bot === 'GPTBot').verdict).toBe('blocked')
    expect(facts.pagespeed).toEqual({ status: 'not_configured' })
    expect(store.pruned).toEqual([['s1', 10]])
    expect(provider.startCrawl).not.toHaveBeenCalled()
  })

  it('stores PageSpeed results when a key is configured and marks a bad team key invalid', async () => {
    process.env.PAGESPEED_API_KEY = 'psi'
    const d = deps()
    ;(d.runPageSpeed as any).mockResolvedValue({ performanceScore: 90, lab: {}, field: null, fetchedAt: 'x' })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect((store.audits[0].siteFacts as any).pagespeed).toMatchObject({ status: 'ok', performanceScore: 90 })
    expect(d.runPageSpeed).toHaveBeenCalledWith('https://example.com/', 'psi', { strategy: 'mobile' })
  })

  it('fails when the home page cannot be fetched', async () => {
    const d = deps()
    ;(d.fetchHomePage as any).mockRejectedValue(new Error('timeout'))
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('failed')
    expect(store.audits[0].error).toContain('home page')
  })

  it('fails an audit whose site lost verification before it ran', async () => {
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    store.site.verifiedAt = null
    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('failed')
    expect(d.fetchHomePage).not.toHaveBeenCalled()
  })
})

describe('full audit', () => {
  const page = (path: string, html: string | null = HTML(path)) => ({
    url: `https://example.com/${path}`,
    statusCode: 200,
    html,
  })

  it('starts a crawl job, batches by cursor, respects the page limit, then analyzes', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl
      .mockResolvedValueOnce({ status: 'running', pages: [page('a'), page('b')], next: 'c1' })
      .mockResolvedValueOnce({ status: 'completed', pages: [page('c'), page('d'), page('e')] })

    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(provider.startCrawl).toHaveBeenCalledWith(
      { apiKey: 'team-key', baseUrl: 'https://api.firecrawl.dev' },
      { url: 'https://example.com', limit: 3 }
    )
    expect(store.audits[0]).toMatchObject({ status: 'crawling', crawlJobId: 'job1' })

    await advanceAudits({}, d)
    expect(provider.getCrawl.mock.calls[0][2]).toBeUndefined()
    expect(provider.getCrawl.mock.calls[1][2]).toBe('c1')
    // limit 3: a, b, c stored; d and e dropped, job cancelled, moved to analyzing
    expect(store.pages.map((p) => p.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
    expect(store.audits[0].status).toBe('analyzing')
    expect(provider.cancelCrawl).toHaveBeenCalledTimes(1)
    expect(d.recordUsage).toHaveBeenCalledWith('t1', 'crawl:pages', 2)

    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('done')
    expect(store.audits[0].score).not.toBeNull()
  })

  it('records usage only for inserted rows and ignores already-stored URLs before applying the limit', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl
      .mockResolvedValueOnce({ status: 'running', pages: [page('a'), page('b')], next: 'c1' })
      // repeats a and b (and a within the batch); only c fits in the remaining room of 1
      .mockResolvedValueOnce({ status: 'completed', pages: [page('a'), page('a'), page('b'), page('c'), page('d')] })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    await advanceAudits({}, d)
    expect(store.pages.map((p) => p.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
    expect(d.recordUsage).toHaveBeenCalledTimes(2)
    expect(d.recordUsage).toHaveBeenNthCalledWith(1, 't1', 'crawl:pages', 2)
    expect(d.recordUsage).toHaveBeenNthCalledWith(2, 't1', 'crawl:pages', 1)
  })

  it('finishing twice does not duplicate issues', async () => {
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    const first = store.issues.length
    expect(first).toBeGreaterThan(0)
    store.audits[0].status = 'analyzing' // simulate re-entry after a lost lease
    await advanceAudits({}, d)
    expect(store.issues).toHaveLength(first)
  })

  it('stops polling a running job with no new batch and keeps the cursor', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl.mockResolvedValue({ status: 'running', pages: [page('a')], next: 'c1' })
    provider.getCrawl.mockResolvedValueOnce({ status: 'running', pages: [page('a')], next: 'c1' })
    provider.getCrawl.mockResolvedValueOnce({ status: 'running', pages: [] })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    await advanceAudits({}, d)
    expect(store.audits[0]).toMatchObject({ status: 'crawling', crawlCursor: 'c1', pagesFetched: 1 })
  })

  it('stores pages without HTML with an error note and skips them in the rules', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl.mockResolvedValue({
      status: 'completed',
      pages: [{ url: 'https://example.com/x', statusCode: 200, html: null, error: 'blocked' }],
    })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    await advanceAudits({}, d)
    await advanceAudits({}, d)
    expect(store.pages[0].facts).toMatchObject({ url: 'https://example.com/x', statusCode: 200, error: 'blocked' })
    expect(store.issues.filter((i) => i.pageId !== null)).toHaveLength(0)
    expect(store.audits[0].status).toBe('done')
  })

  it('fails on provider failure and cancel states', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl.mockResolvedValue({ status: 'failed', pages: [], error: 'site unreachable' })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    await advanceAudits({}, d)
    expect(store.audits[0]).toMatchObject({ status: 'failed' })
    expect(store.audits[0].error).toContain('site unreachable')
  })

  it('cancels and fails a crawl running longer than 60 minutes', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl.mockResolvedValue({ status: 'running', pages: [] })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    clock += 61 * 60_000
    await advanceAudits({}, d)
    expect(provider.cancelCrawl).toHaveBeenCalled()
    expect(store.audits[0].status).toBe('failed')
    expect(store.audits[0].error).toContain('60 minutes')
  })

  it('marks the team key invalid on auth errors and tells the user to update it', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockRejectedValue(new CrawlProviderError('firecrawl', 'auth', 'Unauthorized', 401))
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(d.markCredentialInvalid).toHaveBeenCalledWith('t1', 'firecrawl', 'Unauthorized')
    expect(store.audits[0].status).toBe('failed')
    expect(store.audits[0].error).toContain('Marketing settings')
  })

  it('does not touch team credentials when the instance key was rejected', async () => {
    process.env.FIRECRAWL_API_KEY = 'instance'
    const d = deps()
    provider.startCrawl.mockRejectedValue(new CrawlProviderError('firecrawl', 'auth', 'Unauthorized', 401))
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(d.markCredentialInvalid).not.toHaveBeenCalled()
    expect(store.audits[0].status).toBe('failed')
  })

  it('fails on quota errors', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockRejectedValue(new CrawlProviderError('firecrawl', 'quota', 'no credits', 402))
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(store.audits[0].error).toBe(
      'Firecrawl credits exhausted. Add credits at Firecrawl or use another key, then run again.'
    )
  })

  it('retries transient errors and gives up after 10 in a row', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockRejectedValue(new CrawlProviderError('firecrawl', 'rate_limit', 'slow down', 429))
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await advanceAudits({}, d)
      expect(store.audits[0].status).toBe('queued')
    }
    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('failed')
    expect(store.audits[0].error).toContain('10 attempts')
  })

  it('resets the error counter after a successful step', async () => {
    const d = withFull(deps())
    provider.startCrawl
      .mockRejectedValueOnce(new CrawlProviderError('firecrawl', 'network', 'x'))
      .mockResolvedValue({ jobId: 'job1' })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect((store.audits[0].siteFacts as any)._runtime.errors).toBe(1)
    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('crawling')
    expect((store.audits[0].siteFacts as any)._runtime.errors).toBe(0)
  })
})

describe('cancelAudit', () => {
  it('cancels the provider job and the audit', async () => {
    const d = withFull(deps())
    provider.startCrawl.mockResolvedValue({ jobId: 'job1' })
    provider.getCrawl.mockResolvedValue({ status: 'running', pages: [] })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    await cancelAudit(store.audits[0].id, d)
    expect(provider.cancelCrawl).toHaveBeenCalledWith(expect.anything(), 'job1')
    expect(store.audits[0].status).toBe('cancelled')
    // a worker finishing late cannot resurrect it
    expect(await store.updateAudit(store.audits[0].id, { status: 'done' })).toBe(false)
  })
})

describe('scheduleAudits', () => {
  it('creates auto for never-audited sites and schedule for stale ones', async () => {
    store.candidates = [{ siteId: 's1', lastAuditAt: null }]
    await scheduleAudits(deps())
    expect(store.audits[0].trigger).toBe('auto')

    store.audits[0].status = 'done'
    store.candidates = [{ siteId: 's1', lastAuditAt: new Date(clock - 8 * 86_400_000) }]
    await scheduleAudits(deps())
    expect(store.audits[1].trigger).toBe('schedule')
  })

  it('skips sites that cannot start (unverified) without throwing', async () => {
    store.site.verifiedAt = null
    store.candidates = [{ siteId: 's1', lastAuditAt: null }]
    await expect(scheduleAudits(deps())).resolves.toEqual({ created: 0 })
  })
})

describe('audit lease while finishing', () => {
  it('extends the lease before the site-file fetch, before PageSpeed and before writing results', async () => {
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('done')
    expect(store.leaseExtensions).toBe(3)
  })

  it('writes nothing when the lease was already lost (another worker owns the audit)', async () => {
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    store.leaseHeld = false
    await advanceAudits({}, d)
    expect(store.audits[0].status).not.toBe('done')
    expect(store.issues).toHaveLength(0)
    expect(d.fetchSiteFacts).not.toHaveBeenCalled()
  })

  it('re-checks after the slow PageSpeed step and does not double-finish when the lease lapsed meanwhile', async () => {
    process.env.PAGESPEED_API_KEY = 'psi'
    const d = deps()
    ;(d.runPageSpeed as any).mockImplementation(async () => {
      // A second worker claimed the audit while PageSpeed was running
      store.leaseHeld = false
      return { performanceScore: 90, lab: {}, field: null, fetchedAt: 'x' }
    })
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(d.runPageSpeed).toHaveBeenCalled()
    expect(store.audits[0].status).not.toBe('done')
    // no delete/insert of issues from the worker that lost the lease
    expect(store.issues).toHaveLength(0)
  })
})

/** Store whose lease behaves like the SQL: stored in siteFacts._runtime.leaseUntil, NULL fails extendLease */
class LeasingStore extends MemStore {
  override async claimDue(exclude: string[], now = new Date(), leaseUntil = new Date()): Promise<AuditRow | null> {
    const audit = this.audits.find((a) => {
      if (!['queued', 'crawling', 'analyzing'].includes(a.status) || exclude.includes(a.id)) return false
      const held = (a.siteFacts as { _runtime?: { leaseUntil?: string } } | null)?._runtime?.leaseUntil
      return !held || new Date(held).getTime() < now.getTime()
    })
    if (!audit) return null
    const facts = (audit.siteFacts ?? {}) as { _runtime?: Record<string, unknown> }
    audit.siteFacts = { ...facts, _runtime: { ...facts._runtime, leaseUntil: leaseUntil.toISOString() } } as never
    return { ...audit }
  }
  override async extendLease(id?: string, now = new Date(), leaseUntil = new Date()): Promise<boolean> {
    this.leaseExtensions++
    const audit = this.audits.find((a) => a.id === id)
    const facts = audit?.siteFacts as { _runtime?: { leaseUntil?: string } } | null
    const held = facts?._runtime?.leaseUntil
    if (!audit || !held || new Date(held).getTime() < now.getTime()) return false
    audit.siteFacts = { ...facts, _runtime: { ...facts._runtime, leaseUntil: leaseUntil.toISOString() } } as never
    return true
  }
}

describe('basic audit lease', () => {
  it('finishes in one tick: the interim facts keep the lease so finishing can extend it', async () => {
    store = new LeasingStore()
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(store.audits[0].status).toBe('done')
    expect(store.issues.length).toBeGreaterThan(0)
    expect(store.leaseExtensions).toBe(3)
  })
})

describe('audit lanes', () => {
  const seedAudits = async (d: Partial<RunnerDeps>, n: number) => {
    for (let i = 0; i < n; i++) {
      store.audits.push({
        id: `a${i}`,
        siteId: 's1',
        projectId: 'p1',
        mode: 'basic',
        status: 'queued',
        trigger: 'manual',
        createdAt: new Date(clock + i),
        pageLimit: 3,
        pagesFetched: 0,
        siteFacts: null,
      } as unknown as AuditRow)
    }
    void d
  }

  it('advances up to 4 audits at the same time and never the same audit twice', async () => {
    store = new LeasingStore()
    const d = deps()
    await seedAudits(d, 10)
    let inFlight = 0
    let max = 0
    const calls: string[] = []
    ;(d.fetchHomePage as any).mockImplementation(async () => {
      inFlight++
      max = Math.max(max, inFlight)
      calls.push('home')
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { url: 'https://example.com/', statusCode: 200, html: HTML('Home') }
    })
    const result = await advanceAudits({}, d)
    expect(result.processed).toBe(10)
    expect(calls).toHaveLength(10)
    expect(max).toBe(4)
    expect(store.audits.every((a) => a.status === 'done')).toBe(true)
  })

  it('honours a lane override', async () => {
    store = new LeasingStore()
    const d = deps()
    await seedAudits(d, 5)
    let inFlight = 0
    let max = 0
    ;(d.fetchHomePage as any).mockImplementation(async () => {
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { url: 'https://example.com/', statusCode: 200, html: HTML('Home') }
    })
    await advanceAudits({ lanes: 2 }, d)
    expect(max).toBe(2)
  })
})

describe('cloud instance-key guard in audits', () => {
  it('ignores the instance PageSpeed key on the cloud, uses it with MARKETING_ALLOW_INSTANCE_KEYS=true', async () => {
    process.env.APP_DEPLOYMENT_MODE = 'cloud'
    process.env.PAGESPEED_API_KEY = 'psi'
    const d = deps()
    await startAudit({ siteId: 's1', trigger: 'manual' }, d)
    await advanceAudits({}, d)
    expect(d.runPageSpeed).not.toHaveBeenCalled()
    expect((store.audits[0].siteFacts as any).pagespeed).toEqual({ status: 'not_configured' })

    store.audits[0].status = 'done'
    process.env.MARKETING_ALLOW_INSTANCE_KEYS = 'true'
    ;(d.runPageSpeed as any).mockResolvedValue({ performanceScore: 90, lab: {}, field: null, fetchedAt: 'x' })
    await startAudit({ siteId: 's1', trigger: 'schedule' }, d)
    await advanceAudits({}, d)
    expect(d.runPageSpeed).toHaveBeenCalledWith('https://example.com/', 'psi', { strategy: 'mobile' })
  })

  it('runs audits in basic mode on the cloud when only the instance Firecrawl key exists', async () => {
    process.env.APP_DEPLOYMENT_MODE = 'cloud'
    process.env.FIRECRAWL_API_KEY = 'instance'
    const audit = await startAudit({ siteId: 's1', trigger: 'manual' }, deps())
    expect(audit.mode).toBe('basic')
  })
})
