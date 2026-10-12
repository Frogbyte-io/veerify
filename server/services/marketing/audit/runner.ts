/**
 * Site audit runner: starts audits and advances them one step at a time from a
 * scheduled task (`marketing:audit-advance`, every minute). There is no worker
 * process; every tick claims due audits, does bounded work and returns.
 *
 * States: queued -> (basic) analyzing -> done
 *         queued -> (full) crawling -> analyzing -> done
 * Any state may end in failed or cancelled.
 *
 * Only verified sites are ever fetched, in both modes.
 */
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { createLogger } from '~/server/utils/logger'
import { marketingConfig } from '~/server/utils/marketing-config'
import { getTeamApiKey, markCredentialInvalid } from '~/server/utils/team-credentials'
import { recordUsage } from '~/server/utils/marketing-usage'
import { getCrawlProvider, resolveCrawlConfig } from '~/server/services/crawl'
import {
  CrawlProviderError,
  type CrawlProvider,
  type CrawlProviderConfig,
  type CrawledPage,
} from '~/server/services/crawl/types'
import { fetchHomePage, fetchSiteFacts } from '~/server/services/marketing/site-files'
import { PageSpeedError, runPageSpeed } from '~/server/services/marketing/pagespeed'
import type { SeoAuditMode, SeoAuditTrigger } from '~/server/database/schema/marketing'
import { extractPageFacts } from './extract'
import { runPageRules, runSiteRules } from './rules'
import { computeScore } from './score'
import { crawlerAccess } from './robots'
import { validateLlmsTxt } from './llms-txt'
import { parseSitemap } from './sitemap'
import { drizzleAuditStore, type AuditRow, type AuditStore } from './store'
import type { AuditIssue, FetchedFile, PageFacts, SiteFacts } from './types'

const logger = createLogger('marketing:audit')

export const AUDIT_RETENTION = 10
export const MAX_CRAWL_MINUTES = 60
export const MAX_CONSECUTIVE_ERRORS = 10
export const LEASE_MS = 3 * 60_000
/** Lease taken before the long steps of finishing an audit (site files, PageSpeed) and before writing results */
export const FINISH_LEASE_MS = 6 * 60_000
export const SCHEDULE_INTERVAL_MS = 7 * 24 * 3_600_000
export const MANUAL_WINDOW_MS = 24 * 3_600_000

export interface RunnerDeps {
  store: AuditStore
  now: () => Date
  newId: () => string
  getCrawlProvider: () => CrawlProvider
  resolveCrawlConfig: typeof resolveCrawlConfig
  getTeamApiKey: typeof getTeamApiKey
  markCredentialInvalid: typeof markCredentialInvalid
  recordUsage: typeof recordUsage
  fetchSiteFacts: typeof fetchSiteFacts
  fetchHomePage: typeof fetchHomePage
  runPageSpeed: typeof runPageSpeed
}

export const defaultDeps: RunnerDeps = {
  store: drizzleAuditStore,
  now: () => new Date(),
  newId: () => randomUUID(),
  getCrawlProvider: () => getCrawlProvider('firecrawl'),
  resolveCrawlConfig,
  getTeamApiKey,
  markCredentialInvalid,
  recordUsage,
  fetchSiteFacts,
  fetchHomePage,
  runPageSpeed,
}

function withDeps(deps?: Partial<RunnerDeps>): RunnerDeps {
  return { ...defaultDeps, ...deps }
}

// --- start ---------------------------------------------------------------

export type AuditBlockReason = 'not_found' | 'not_enabled' | 'not_verified' | 'active_audit' | 'daily_limit'

export interface AuditStartStatus {
  canStart: boolean
  reason: AuditBlockReason | null
  message: string | null
  /** For `daily_limit`: when the oldest counted manual audit leaves the window */
  resetsAt: Date | null
}

const BLOCK_MESSAGES: Record<AuditBlockReason, string> = {
  not_found: 'Site not found',
  not_enabled: 'Marketing is not enabled for this product',
  not_verified: 'Verify your site before running an audit',
  active_audit: 'An audit is already running for this site',
  daily_limit: 'Daily limit of manual audits reached',
}

const BLOCK_STATUS: Record<AuditBlockReason, number> = {
  not_found: 404,
  not_enabled: 403,
  not_verified: 403,
  active_audit: 409,
  daily_limit: 429,
}

/** Everything that can stop an audit from starting. Manual limit only applies to `manual`. */
export async function getAuditStartStatus(
  siteId: string,
  trigger: SeoAuditTrigger,
  partial?: Partial<RunnerDeps>
): Promise<AuditStartStatus> {
  const deps = withDeps(partial)
  const blocked = (reason: AuditBlockReason, resetsAt: Date | null = null): AuditStartStatus => ({
    canStart: false,
    reason,
    message: BLOCK_MESSAGES[reason],
    resetsAt,
  })

  const site = await deps.store.loadSite(siteId)
  if (!site) return blocked('not_found')
  if (!site.marketingEnabled) return blocked('not_enabled')
  if (!site.verifiedAt) return blocked('not_verified')
  if (await deps.store.hasActiveAudit(siteId)) return blocked('active_audit')

  if (trigger === 'manual') {
    const limit = marketingConfig.manualAuditsPerDay
    const now = deps.now()
    const times = await deps.store.manualAuditTimes(siteId, new Date(now.getTime() - MANUAL_WINDOW_MS))
    if (times.length >= limit) {
      const counted = times.slice(times.length - limit)
      const oldest = counted[0] ?? now
      return blocked('daily_limit', new Date(oldest.getTime() + MANUAL_WINDOW_MS))
    }
  }
  return { canStart: true, reason: null, message: null, resetsAt: null }
}

/** Team key first (unless known invalid), then the instance key. Null means basic mode. */
async function resolveConfigFor(
  teamId: string,
  deps: RunnerDeps
): Promise<{ config: CrawlProviderConfig; teamKey: boolean } | null> {
  const stored = await deps.getTeamApiKey(teamId, 'firecrawl')
  const teamKey = stored && stored.status !== 'invalid' ? stored.apiKey : null
  const config = deps.resolveCrawlConfig(teamKey)
  if (!config) return null
  return { config, teamKey: teamKey !== null && config.apiKey === teamKey }
}

function blockedError(status: AuditStartStatus) {
  const reason = status.reason!
  const message =
    reason === 'daily_limit' && status.resetsAt
      ? `${status.message}. You can run another at ${status.resetsAt.toISOString()}`
      : (status.message ?? 'Cannot start audit')
  const code =
    reason === 'active_audit'
      ? ErrorCode.CONFLICT
      : reason === 'daily_limit'
        ? ErrorCode.RATE_LIMITED
        : reason === 'not_found'
          ? ErrorCode.NOT_FOUND
          : ErrorCode.FORBIDDEN
  return createError({
    statusCode: BLOCK_STATUS[reason],
    statusMessage: message,
    data: createErrorResponse(code, message, {
      reason,
      resetsAt: status.resetsAt?.toISOString() ?? null,
    }),
  })
}

export async function startAudit(
  input: { siteId: string; trigger: SeoAuditTrigger; userId?: string },
  partial?: Partial<RunnerDeps>
): Promise<{ id: string; mode: SeoAuditMode }> {
  const deps = withDeps(partial)
  const status = await getAuditStartStatus(input.siteId, input.trigger, partial)
  if (!status.canStart && status.reason) throw blockedError(status)

  const site = (await deps.store.loadSite(input.siteId))!
  const crawl = await resolveConfigFor(site.teamId, deps)
  const mode: SeoAuditMode = crawl ? 'full' : 'basic'
  const now = deps.now()
  const id = deps.newId()

  try {
    await deps.store.insertAudit({
      id,
      siteId: site.id,
      trigger: input.trigger,
      mode,
      status: 'queued',
      pageLimit: marketingConfig.maxAuditPages,
      requestedByUserId: input.userId ?? null,
      startedAt: now,
      createdAt: now,
    })
  } catch (error) {
    // The partial unique index on active audits is the real arbiter of concurrent starts
    if (isUniqueViolation(error)) {
      throw blockedError({
        canStart: false,
        reason: 'active_audit',
        message: BLOCK_MESSAGES.active_audit,
        resetsAt: null,
      })
    }
    throw error
  }
  return { id, mode }
}

// --- helpers -------------------------------------------------------------

interface Runtime {
  errors: number
}

function readRuntime(audit: AuditRow): Runtime {
  const runtime = (audit.siteFacts as { _runtime?: { errors?: unknown } } | null)?._runtime
  return { errors: typeof runtime?.errors === 'number' ? runtime.errors : 0 }
}

/** Interim siteFacts: keeps the error counter and drops the lease. */
function interimFacts(audit: AuditRow, errors: number): Record<string, unknown> {
  const { _runtime: _drop, ...rest } = (audit.siteFacts ?? {}) as Record<string, unknown>
  return { ...rest, _runtime: { errors } }
}

function emptyFacts(url: string, statusCode: number): PageFacts {
  return {
    url,
    statusCode,
    title: null,
    metaDescription: null,
    canonical: null,
    robotsMeta: null,
    lang: null,
    h1: [],
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    twitterCard: null,
    internalLinks: [],
    externalLinkCount: 0,
    images: [],
    jsonLdTypes: [],
    jsonLdErrors: 0,
    wordCount: 0,
  }
}

type FactsWithError = PageFacts & { error?: string }

/** Pages the provider returned without HTML keep url/status and an error note, and skip the rules. */
export function pageFactsFor(page: CrawledPage): FactsWithError {
  if (page.html === null) {
    return { ...emptyFacts(page.url, page.statusCode), error: page.error ?? 'The page content could not be retrieved' }
  }
  try {
    return extractPageFacts(page.url, page.statusCode, page.html)
  } catch {
    return { ...emptyFacts(page.url, page.statusCode), error: 'The page could not be parsed' }
  }
}

function fileStatus(file: FetchedFile): { status: 'found' | 'missing' | 'error'; httpStatus: number | null } {
  if (file.status === null) return { status: 'error', httpStatus: null }
  if (file.status >= 200 && file.status < 300 && file.body !== null) return { status: 'found', httpStatus: file.status }
  if (file.status === 404 || file.status === 410) return { status: 'missing', httpStatus: file.status }
  return { status: 'error', httpStatus: file.status }
}

function fail(deps: RunnerDeps, audit: AuditRow, message: string) {
  logger.warn('Audit failed', { auditId: audit.id, message })
  return deps.store.updateAudit(audit.id, {
    status: 'failed',
    error: message,
    finishedAt: deps.now(),
    siteFacts: null,
  })
}

// --- advance -------------------------------------------------------------

export interface AdvanceResult {
  processed: number
}

export async function advanceAudits(
  options: { budgetMs?: number } = {},
  partial?: Partial<RunnerDeps>
): Promise<AdvanceResult> {
  const deps = withDeps(partial)
  const budgetMs = options.budgetMs ?? 45_000
  const deadline = deps.now().getTime() + budgetMs
  const seen: string[] = []

  while (deps.now().getTime() < deadline) {
    const now = deps.now()
    const audit = await deps.store.claimDue(seen, now, new Date(now.getTime() + LEASE_MS))
    if (!audit) break
    seen.push(audit.id)
    try {
      await processAudit(audit, deadline, deps)
    } catch (err) {
      logger.error('Audit step crashed', { auditId: audit.id, error: err instanceof Error ? err.message : 'unknown' })
      await recordTransient(deps, audit, err)
    }
  }
  return { processed: seen.length }
}

/** Transient error: leave the audit where it is for the next tick, give up after too many in a row. */
async function recordTransient(deps: RunnerDeps, audit: AuditRow, err: unknown) {
  const errors = readRuntime(audit).errors + 1
  if (errors >= MAX_CONSECUTIVE_ERRORS) {
    const detail = err instanceof Error ? err.message : 'unknown error'
    await fail(deps, audit, `The audit kept failing and was stopped after ${errors} attempts. Last error: ${detail}`)
    return
  }
  await deps.store.updateAudit(audit.id, { siteFacts: interimFacts(audit, errors) })
}

async function processAudit(audit: AuditRow, deadline: number, deps: RunnerDeps) {
  const site = await deps.store.loadSite(audit.siteId)
  if (!site || !site.verifiedAt) {
    await fail(deps, audit, 'The site is no longer verified. Verify it again in Marketing settings to run audits.')
    return
  }
  if (!site.marketingEnabled) {
    await fail(deps, audit, 'Marketing was turned off for this product.')
    return
  }

  try {
    if (audit.status === 'queued') {
      if (audit.mode === 'basic') await runBasic(audit, site.origin, site.teamId, deps)
      else await startCrawlJob(audit, site.origin, site.teamId, deps)
    } else if (audit.status === 'crawling') {
      await pollCrawl(audit, site.teamId, deadline, deps)
    } else if (audit.status === 'analyzing') {
      await finishAudit(audit, site.origin, site.teamId, deps)
    }
  } catch (err) {
    if (err instanceof CrawlProviderError) {
      await handleProviderError(audit, site.teamId, err, deps)
      return
    }
    await recordTransient(deps, audit, err)
  }
}

async function handleProviderError(audit: AuditRow, teamId: string, err: CrawlProviderError, deps: RunnerDeps) {
  if (err.kind === 'auth') {
    const resolved = await resolveConfigFor(teamId, deps)
    const usedTeamKey = resolved?.teamKey ?? false
    if (usedTeamKey) await deps.markCredentialInvalid(teamId, 'firecrawl', err.message)
    await fail(
      deps,
      audit,
      'Firecrawl rejected the API key. Update the key in Marketing settings, then run the audit again.'
    )
    return
  }
  if (err.kind === 'quota') {
    await fail(deps, audit, 'Firecrawl credits exhausted. Add credits at Firecrawl or use another key, then run again.')
    return
  }
  if (err.kind === 'bad_request') {
    await fail(deps, audit, `Firecrawl could not crawl this site: ${err.message}`)
    return
  }
  await recordTransient(deps, audit, err)
}

async function runBasic(audit: AuditRow, origin: string, teamId: string, deps: RunnerDeps) {
  const userAgent = marketingConfig.botUserAgent
  let home: CrawledPage
  try {
    home = await deps.fetchHomePage(origin, { userAgent })
  } catch (err) {
    await fail(deps, audit, `Could not fetch the home page: ${err instanceof Error ? err.message : 'unknown error'}`)
    return
  }
  const facts = pageFactsFor(home)
  await deps.store.insertPages([
    { id: deps.newId(), auditId: audit.id, url: facts.url, statusCode: facts.statusCode, facts },
  ])
  const moved = await deps.store.updateAudit(audit.id, {
    status: 'analyzing',
    pagesFetched: 1,
    siteFacts: interimFacts(audit, 0),
  })
  if (!moved) return
  await finishAudit({ ...audit, status: 'analyzing', pagesFetched: 1 }, origin, teamId, deps)
}

async function startCrawlJob(audit: AuditRow, origin: string, teamId: string, deps: RunnerDeps) {
  const resolved = await resolveConfigFor(teamId, deps)
  if (!resolved) {
    await fail(deps, audit, 'No Firecrawl key is configured any more. Add one in Marketing settings and run again.')
    return
  }
  const provider = deps.getCrawlProvider()
  const { jobId } = await provider.startCrawl(resolved.config, { url: origin, limit: audit.pageLimit })
  await deps.store.updateAudit(audit.id, {
    status: 'crawling',
    crawlProvider: provider.id,
    crawlJobId: jobId,
    startedAt: deps.now(),
    siteFacts: interimFacts(audit, 0),
  })
}

async function pollCrawl(audit: AuditRow, teamId: string, deadline: number, deps: RunnerDeps) {
  const resolved = await resolveConfigFor(teamId, deps)
  if (!resolved || !audit.crawlJobId) {
    await fail(deps, audit, 'No Firecrawl key is configured any more. Add one in Marketing settings and run again.')
    return
  }
  const provider = deps.getCrawlProvider()

  const startedAt = audit.startedAt?.getTime() ?? deps.now().getTime()
  if (deps.now().getTime() - startedAt > MAX_CRAWL_MINUTES * 60_000) {
    await provider.cancelCrawl(resolved.config, audit.crawlJobId).catch(() => undefined)
    await fail(deps, audit, `The crawl took longer than ${MAX_CRAWL_MINUTES} minutes and was stopped.`)
    return
  }

  let cursor = audit.crawlCursor ?? undefined
  let pagesFetched = audit.pagesFetched
  let finished = false
  let reachedLimit = false

  do {
    const batch = await provider.getCrawl(resolved.config, audit.crawlJobId, cursor)

    if (batch.status === 'failed' || batch.status === 'cancelled') {
      await fail(deps, audit, batch.error ? `The crawl ${batch.status}: ${batch.error}` : `The crawl ${batch.status}.`)
      return
    }

    // Drop already-stored (and in-batch duplicate) URLs first so they neither use up the
    // remaining room nor count as usage, then apply the page limit.
    const known = new Set(await deps.store.pageUrls(audit.id))
    const fresh = []
    for (const page of batch.pages) {
      const facts = pageFactsFor(page)
      if (known.has(facts.url)) continue
      known.add(facts.url)
      fresh.push({ id: deps.newId(), auditId: audit.id, url: facts.url, statusCode: facts.statusCode, facts })
    }
    const room = Math.max(0, audit.pageLimit - pagesFetched)
    const rows = fresh.slice(0, room)
    if (rows.length > 0) {
      const inserted = await deps.store.insertPages(rows)
      pagesFetched += inserted
      if (inserted > 0) await deps.recordUsage(teamId, 'crawl:pages', inserted)
    }
    if (batch.next) cursor = batch.next

    await deps.store.updateAudit(audit.id, {
      crawlCursor: cursor ?? null,
      pagesFetched,
      siteFacts: interimFacts(audit, 0),
    })

    reachedLimit = pagesFetched >= audit.pageLimit
    finished = reachedLimit || (batch.status === 'completed' && !batch.next)
    if (finished) break
    if (!batch.next) break // job still running and nothing more to read yet
  } while (deps.now().getTime() < deadline)

  if (finished) {
    if (reachedLimit) await provider.cancelCrawl(resolved.config, audit.crawlJobId).catch(() => undefined)
    await deps.store.updateAudit(audit.id, { status: 'analyzing', siteFacts: interimFacts(audit, 0) })
  }
}

/**
 * Re-takes the lease for the next long step. False means the lease lapsed and another worker may have
 * claimed the audit, so this one must stop: two workers finishing the same audit would interleave
 * their delete/insert of issues.
 */
async function holdLease(audit: AuditRow, deps: RunnerDeps): Promise<boolean> {
  const now = deps.now()
  const held = await deps.store.extendLease(audit.id, now, new Date(now.getTime() + FINISH_LEASE_MS))
  if (!held) logger.warn('Audit lease lost while finishing; leaving it to the current owner', { auditId: audit.id })
  return held
}

async function finishAudit(audit: AuditRow, origin: string, teamId: string, deps: RunnerDeps) {
  const userAgent = marketingConfig.botUserAgent
  if (!(await holdLease(audit, deps))) return
  const site: SiteFacts = await deps.fetchSiteFacts(origin, { userAgent })
  const stored = await deps.store.loadPages(audit.id)

  if (!(await holdLease(audit, deps))) return
  const pagespeed = await collectPageSpeed(teamId, origin, deps)

  const analyzable = stored.filter((p) => !(p.facts as FactsWithError).error)
  const issues: AuditIssue[] = [
    ...runPageRules(analyzable.map((p) => p.facts)),
    ...runSiteRules(
      site,
      analyzable.map((p) => p.facts)
    ),
  ]
  const score = computeScore(issues, analyzable.length)

  const idByUrl = new Map(stored.map((p) => [p.url, p.id]))
  // PageSpeed can take a minute: confirm we still own the audit before the delete + insert below
  if (!(await holdLease(audit, deps))) return
  // Re-entry (lease expiry mid-finish) must not duplicate issues
  await deps.store.deleteIssues(audit.id)
  await deps.store.insertIssues(
    issues.map((issue) => ({
      id: deps.newId(),
      auditId: audit.id,
      pageId: issue.pageUrl ? (idByUrl.get(issue.pageUrl) ?? null) : null,
      pageUrl: issue.pageUrl,
      ruleId: issue.ruleId,
      severity: issue.severity,
      details: issue.details,
    }))
  )

  const llmsFile = fileStatus(site.llmsTxt)
  const sitemapFile = fileStatus(site.sitemapXml)
  const sitemap = sitemapFile.status === 'found' && site.sitemapXml.body ? parseSitemap(site.sitemapXml.body) : null
  const siteFacts = {
    robotsTxt: fileStatus(site.robotsTxt),
    llmsTxt: {
      ...llmsFile,
      validation:
        llmsFile.status === 'found' && site.llmsTxt.body
          ? (({ valid, title, summary, problems, sections }) => ({
              valid,
              title,
              summary,
              problems,
              sectionCount: sections.length,
            }))(validateLlmsTxt(site.llmsTxt.body))
          : null,
    },
    sitemap: { ...sitemapFile, kind: sitemap?.kind ?? null, urlCount: sitemap?.urls.length ?? null },
    crawlerAccess: crawlerAccess(
      site.robotsTxt.status !== null && site.robotsTxt.status < 300 ? site.robotsTxt.body : null
    ),
    pagespeed,
  }

  const done = await deps.store.updateAudit(audit.id, {
    status: 'done',
    score,
    siteFacts,
    error: null,
    finishedAt: deps.now(),
  })
  if (done) await deps.store.pruneAudits(audit.siteId, AUDIT_RETENTION)
}

async function collectPageSpeed(teamId: string, origin: string, deps: RunnerDeps): Promise<Record<string, unknown>> {
  const teamKey = await deps.getTeamApiKey(teamId, 'pagespeed')
  const usable = teamKey && teamKey.status !== 'invalid' ? teamKey.apiKey : null
  const apiKey = usable ?? marketingConfig.pagespeedApiKey ?? null
  if (!apiKey) return { status: 'not_configured' }

  try {
    const result = await deps.runPageSpeed(`${new URL(origin).origin}/`, apiKey, { strategy: 'mobile' })
    return { status: 'ok', ...result }
  } catch (err) {
    if (err instanceof PageSpeedError) {
      if (err.kind === 'auth' && usable) await deps.markCredentialInvalid(teamId, 'pagespeed', err.message)
      return { status: 'error', kind: err.kind, message: err.message }
    }
    return { status: 'error', kind: 'failed', message: 'PageSpeed request failed' }
  }
}

// --- cancel --------------------------------------------------------------

export async function cancelAudit(auditId: string, partial?: Partial<RunnerDeps>): Promise<boolean> {
  const deps = withDeps(partial)
  const audit = await deps.store.getAudit(auditId)
  if (!audit) return false

  if (audit.status === 'crawling' && audit.crawlJobId) {
    try {
      const site = await deps.store.loadSite(audit.siteId)
      const resolved = site ? await resolveConfigFor(site.teamId, deps) : null
      if (resolved) await deps.getCrawlProvider().cancelCrawl(resolved.config, audit.crawlJobId)
    } catch (err) {
      logger.warn('Could not cancel crawl job at the provider', {
        auditId,
        error: err instanceof Error ? err.name : 'unknown',
      })
    }
  }
  return deps.store.updateAudit(auditId, { status: 'cancelled', finishedAt: deps.now(), siteFacts: null })
}

// --- schedule ------------------------------------------------------------

export async function scheduleAudits(partial?: Partial<RunnerDeps>): Promise<{ created: number }> {
  const deps = withDeps(partial)
  const cutoff = new Date(deps.now().getTime() - SCHEDULE_INTERVAL_MS)
  const candidates = await deps.store.scheduleCandidates(cutoff, 200)
  let created = 0
  for (const candidate of candidates) {
    try {
      await startAudit({ siteId: candidate.siteId, trigger: candidate.lastAuditAt ? 'schedule' : 'auto' }, partial)
      created++
    } catch (err) {
      // A race with a manual audit or a just-lost verification is not an error
      if ((err as { statusCode?: number })?.statusCode === undefined) {
        logger.error('Could not schedule audit', { siteId: candidate.siteId })
      }
    }
  }
  return { created }
}
