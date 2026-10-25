import { randomUUID } from 'node:crypto'
import {
  buildQueries,
  classifyMention,
  matchTerms,
  SOCIAL_SOURCES,
  SocialSourceError,
  type MatchTerm,
  type SocialPost,
  type SocialSource,
} from '~/server/services/social-sources'
import type { MentionSource } from '~/server/database/schema/marketing'
import { marketingConfig } from '~/server/utils/marketing-config'
import { recordUsage } from '~/server/utils/marketing-usage'
import { publishMentionsNew } from '~/server/utils/marketing-realtime'
import { createLogger } from '~/server/utils/logger'
import { dbMentionsStore, isMarketingOn, type MentionInsert, type MentionsStore, type SourceCursorRow } from './store'

const logger = createLogger('marketing-mentions')

export const POLL_INTERVAL_MS = 30 * 60 * 1000
export const FAILURE_BACKOFF_BASE_MS = 15 * 60 * 1000
export const FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000
export const OVERLAP_MS = 60 * 60 * 1000
export const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000
export const QUERY_LIMIT = 50
/** Wall-clock budget of one poll run; the task fires every 5 minutes, so a run never overlaps the next */
export const POLL_BUDGET_MS = 45_000
/** Default sites polled at the same time (`MARKETING_MENTIONS_CONCURRENCY`, capped at 32); a site polls its sources in parallel */
export const POLL_CONCURRENCY = 16
/** A source that failed this many times in a row skips past a failing query instead of retrying it forever */
export const POISON_QUERY_FAILURES = 2
/** Queries sent per (site, source) per run; sites with more rotate through them across runs */
export const MAX_QUERIES_PER_RUN = 20
/** Sites selected per run (the budget is the real limiter; this bounds the SELECT) */
export const MAX_SITES_PER_RUN = 400
/**
 * A (site, source) cursor is claimed for polling by stamping `last_attempt_at`; another replica can
 * only claim it again after this long, which is shorter than the poll interval but longer than a
 * run's budget.
 */
export const CLAIM_LEASE_MS = 15 * 60 * 1000
export const EXCERPT_LENGTH = 500
const RETENTION_BATCH = 500
const MAX_RETENTION_BATCHES = 20

export interface PollSummary {
  sitesPolled: number
  sourcesPolled: number
  inserted: number
  errors: number
}

export interface PollOptions {
  now?: Date
  maxSites?: number
  /** Wall-clock budget; no new site/source/query is started once spent (default 45 s) */
  budgetMs?: number
  /** Sites polled concurrently (default MARKETING_MENTIONS_CONCURRENCY, 16) */
  concurrency?: number
  /** Query cap per (site, source) per run (default 20) */
  maxQueriesPerRun?: number
}

export interface PollDeps {
  /** Wall clock for the budget (injectable for tests) */
  clock?: () => number
  store?: MentionsStore
  sources?: SocialSource[]
  recordUsage?: (organizationId: string, metric: string, units: number) => Promise<void>
  publishNew?: (input: { projectId: string; count: number }) => Promise<void>
}

/** Start of the search window: one hour before the last poll, never older than seven days. */
export function computeSince(lastPolledAt: Date | null, now: Date): Date {
  const floor = now.getTime() - MAX_LOOKBACK_MS
  if (!lastPolledAt) return new Date(floor)
  return new Date(Math.max(lastPolledAt.getTime() - OVERLAP_MS, floor))
}

/** Wait before retrying a failing source: min(2^failures * 15 minutes, 6 hours). */
export function retryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_INTERVAL_MS
  return Math.min(2 ** Math.min(consecutiveFailures, 10) * FAILURE_BACKOFF_BASE_MS, FAILURE_BACKOFF_MAX_MS)
}

/** When the source was last tried: coalesce(last_attempt_at, last_polled_at). */
export function lastAttemptOf(cursor: SourceCursorRow | undefined): Date | null {
  return cursor ? (cursor.lastAttemptAt ?? cursor.lastPolledAt) : null
}

/** Due when never tried, or the poll interval (or failure backoff) has elapsed since the last attempt. */
export function isDue(cursor: SourceCursorRow | undefined, now: Date): boolean {
  const attempt = lastAttemptOf(cursor)
  if (!attempt) return true
  return now.getTime() - attempt.getTime() >= retryDelayMs(cursor?.consecutiveFailures ?? 0)
}

/**
 * Which slice of a site's queries this run covers. Sites with at most `maxPerRun` queries always
 * poll all of them. Larger sites rotate through the list using the persisted `queryOffset` of the
 * (site, source) cursor: each successful poll searches the next `maxPerRun` queries from the offset
 * and advances it (see `planRotation`), so no slice is ever skipped, however irregular the gaps
 * between runs. An offset past the end of the list (the term list shrank) restarts at 0.
 *
 * Very large term lists simply poll each slice less often: a site with N slices re-searches a given
 * query every N polls of that source (N * 30 minutes at the default interval), never less.
 */
export function selectQuerySlice<T>(
  queries: T[],
  offset: number,
  maxPerRun: number = MAX_QUERIES_PER_RUN
): { slice: T[]; start: number; slices: number } {
  const slices = Math.max(1, Math.ceil(queries.length / maxPerRun))
  const start = offset > 0 && offset < queries.length ? offset : 0
  return { slice: queries.slice(start, start + maxPerRun), start, slices }
}

/**
 * Rotation state to store after polling one slice.
 *
 * `processed` is how many queries from `start` are done (searched, or deliberately skipped); the next
 * offset is `start + processed`, so a failed query is retried first next time. The search-window
 * watermark only moves when the offset wraps past the last query: it moves to the start of the cycle
 * that just finished (the first slice's poll time), so every slice of the next cycle searches a
 * window reaching back to when its query was last covered. A cycle whose start time is unknown
 * (rows from before rotation state) holds the watermark, and the next cycle records it.
 */
export function planRotation(input: {
  start: number
  processed: number
  queryCount: number
  now: Date
  previous: Date | null
  since: Date
  cycleStartedAt: Date | null
}): { queryOffset: number; watermark: Date; cycleStartedAt: Date | null; wrapped: boolean } {
  const held = input.previous ?? input.since
  const cycleStartedAt = input.start === 0 ? input.now : input.cycleStartedAt
  const next = input.start + input.processed
  if (input.queryCount === 0 || next >= input.queryCount) {
    const cycle = cycleStartedAt ?? held
    const watermark = new Date(Math.min(input.now.getTime(), Math.max(held.getTime(), cycle.getTime())))
    return { queryOffset: 0, watermark, cycleStartedAt: null, wrapped: true }
  }
  return { queryOffset: next, watermark: held, cycleStartedAt, wrapped: false }
}

export function buildExcerpt(title: string | null, text: string): string {
  const joined = [title, text]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return joined.length > EXCERPT_LENGTH ? `${joined.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : joined
}

/** Brand match wins over competitor, which wins over keyword. Returns null for fuzzy search hits. */
export function toMentionRow(siteId: string, post: SocialPost, terms: MatchTerm[]): MentionInsert | null {
  const matches = matchTerms(post, terms)
  const kind = classifyMention(matches)
  if (!kind) return null
  const wanted = kind === 'mention' ? 'brand' : kind === 'competitor' ? 'competitor' : 'keyword'
  const termId = matches.find((m) => m.kind === wanted)?.termId ?? null

  return {
    id: randomUUID(),
    siteId,
    termId,
    source: post.source,
    externalId: post.externalId,
    url: post.url,
    author: post.author,
    title: post.title,
    excerpt: buildExcerpt(post.title, post.text),
    score: post.score,
    kind,
    publishedAt: post.publishedAt,
  }
}

function describeError(error: unknown): string {
  if (error instanceof SocialSourceError) return `${error.kind}: ${error.message}`.slice(0, 200)
  return 'server: unexpected error'
}

/**
 * Polls due (site, source) pairs within a wall-clock budget, a few sites at a time.
 *
 * Multi-replica safety: before polling a (site, source) the cursor is claimed atomically
 * (`store.claimCursor`: stamp `last_attempt_at` only if it is unset or older than CLAIM_LEASE_MS), so
 * two replicas never poll the same pair; the loser skips it.
 *
 * Rate limits: Reddit and Bluesky limit per app/account and Hacker News per IP, so a rate-limit
 * response from a source is global to this instance, not specific to the site that hit it. The source
 * is therefore skipped for the rest of the run (continuing would only burn requests against the same
 * limit and extend the ban). Trade-off: one noisy site that trips the limit also pauses the source
 * for sites later in the queue; those and the site that hit the limit are left untouched (the claim is
 * released, no failure counted, watermark and offset unchanged) and go first next run.
 * A site that fails for any other reason only backs off itself. Individual query failures are caught
 * per query: the other queries' results are kept and only the failed query is retried next run.
 */
export async function pollMentions(options: PollOptions = {}, deps: PollDeps = {}): Promise<PollSummary> {
  const now = options.now ?? new Date()
  const maxSites = options.maxSites ?? MAX_SITES_PER_RUN
  const clock = deps.clock ?? Date.now
  const deadline = clock() + (options.budgetMs ?? POLL_BUDGET_MS)
  const concurrency = Math.max(1, options.concurrency ?? marketingConfig.mentionsConcurrency)
  const maxQueries = Math.max(1, options.maxQueriesPerRun ?? MAX_QUERIES_PER_RUN)
  const store = deps.store ?? dbMentionsStore
  const sources = (deps.sources ?? SOCIAL_SOURCES).filter((source) => source.isConfigured())
  const usage = deps.recordUsage ?? recordUsage
  const publishNew = deps.publishNew ?? publishMentionsNew
  const summary: PollSummary = { sitesPolled: 0, sourcesPolled: 0, inserted: 0, errors: 0 }

  // Due selection happens in SQL (verified, both switches on, has terms, at least one source due),
  // least recently attempted first, LIMITed; the checks below re-verify it against the loaded rows.
  const candidates = sources.length
    ? await store.loadDueSites({ now, sourceIds: sources.map((s) => s.id), limit: maxSites })
    : []
  const verified = candidates.filter(isMarketingOn)
  const terms = await store.loadTerms(verified.map((site) => site.siteId))
  const withTerms = verified.filter((site) => (terms.get(site.siteId)?.length ?? 0) > 0)
  const cursors = new Map<string, SourceCursorRow>()
  for (const cursor of await store.loadCursors(withTerms.map((site) => site.siteId))) {
    cursors.set(`${cursor.siteId}:${cursor.source}`, cursor)
  }
  const cursorRow = (siteId: string, source: string) => cursors.get(`${siteId}:${source}`)

  // Least-recently-attempted sites first so a backlog drains fairly across runs. Ordering uses
  // the attempt time, not the watermark, so a failing source cannot hog the head of the queue.
  const due = withTerms
    .map((site) => {
      const dueSources = sources.filter((source) => isDue(cursorRow(site.siteId, source.id), now))
      const oldest = Math.min(...dueSources.map((s) => lastAttemptOf(cursorRow(site.siteId, s.id))?.getTime() ?? 0))
      return { site, dueSources, oldest }
    })
    .filter((entry) => entry.dueSources.length > 0)
    .sort((a, b) => a.oldest - b.oldest)
    .slice(0, maxSites)

  const rateLimited = new Set<string>()
  const expired = () => clock() >= deadline

  const siteInserted = new Map<string, number>()

  const pollSource = async (
    site: (typeof due)[number]['site'],
    source: SocialSource,
    queries: ReturnType<typeof buildQueries>,
    siteTerms: MatchTerm[]
  ): Promise<number | null> => {
    if (expired() || rateLimited.has(source.id)) return null
    const existing = cursorRow(site.siteId, source.id)
    const previous = existing?.lastPolledAt ?? null
    const previousAttempt = lastAttemptOf(existing)
    const since = computeSince(previous, now)

    // Another replica (or an overlapping run) may have taken this pair since we selected it
    let claimed = false
    try {
      claimed = await store.claimCursor(site.siteId, source.id as MentionSource, now, since, CLAIM_LEASE_MS)
    } catch (error) {
      summary.errors += 1
      logger.error('Failed to claim mentions cursor', {
        siteId: site.siteId,
        source: source.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
    if (!claimed) return null

    const { slice, start } = selectQuerySlice(queries, existing?.queryOffset ?? 0, maxQueries)
    const found = new Map<string, MentionInsert>()
    let requests = 0
    let attempted = 0
    let succeeded = 0
    let firstFailed: number | null = null
    let failure: string | null = null
    let rateLimit = false
    const priorFailures = existing?.consecutiveFailures ?? 0

    for (let i = 0; i < slice.length; i++) {
      // Budget spent, or a concurrent site just tripped this source's (app-wide) rate limit
      if (expired() || rateLimited.has(source.id)) break
      requests += 1
      try {
        const posts = await source.search({ query: slice[i].query, since, limit: QUERY_LIMIT })
        for (const post of posts) {
          if (found.has(post.externalId)) continue
          const row = toMentionRow(site.siteId, post, siteTerms)
          if (row) found.set(post.externalId, row)
        }
        succeeded += 1
        attempted = i + 1
      } catch (error) {
        const kind = error instanceof SocialSourceError ? error.kind : 'unknown'
        failure ??= describeError(error)
        logger.warn('Mentions query failed', { siteId: site.siteId, source: source.id, kind })
        if (kind === 'rate_limit') {
          rateLimit = true
          rateLimited.add(source.id)
          break
        }
        // Credentials / configuration problems fail every query of the source: stop early
        if (kind === 'auth' || kind === 'not_configured') {
          firstFailed ??= i
          break
        }
        firstFailed ??= i
        attempted = i + 1
      }
    }
    // Retry from the first failed query next run. But a query that keeps failing while others succeed
    // is query-specific (not an outage), so after a few failed polls rotate past it instead of stalling.
    let processed = firstFailed ?? attempted
    if (firstFailed !== null && succeeded > 0 && priorFailures >= POISON_QUERY_FAILURES) processed = attempted
    if (failure) summary.errors += 1

    try {
      // Results of the queries that did succeed are kept even when others failed or limits hit
      if (found.size > 0) {
        const inserted = await store.insertMentions([...found.values()])
        summary.inserted += inserted
        siteInserted.set(site.siteId, (siteInserted.get(site.siteId) ?? 0) + inserted)
      }
      if (rateLimit || requests === 0) {
        // Leave the cursor as it was: no failure counted, watermark and offset unchanged. Also when the
        // claim was taken but no request was issued (budget spent / source rate limited by another site),
        // so the pair is due again at once instead of waiting a full interval.
        await store.releaseClaim(site.siteId, source.id as MentionSource, now, previousAttempt)
      } else if (requests > 0) {
        const plan = planRotation({
          start,
          processed,
          queryCount: queries.length,
          now,
          previous,
          since,
          cycleStartedAt: existing?.cycleStartedAt ?? null,
        })
        const lastError = failure ? (succeeded > 0 ? `partial: ${failure}` : failure) : null
        await store.saveCursor(
          site.siteId,
          source.id as MentionSource,
          plan.watermark,
          lastError?.slice(0, 200) ?? null,
          {
            at: now,
            consecutiveFailures: failure ? priorFailures + 1 : 0,
            queryOffset: plan.queryOffset,
            cycleStartedAt: plan.cycleStartedAt,
          }
        )
      }
      if (requests > 0) await usage(site.organizationId, `mentions:${source.id}:requests`, requests)
    } catch (error) {
      summary.errors += 1
      logger.error('Failed to store mentions', {
        siteId: site.siteId,
        source: source.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
      return null
    }

    summary.sourcesPolled += 1
    return found.size
  }

  const pollSite = async ({ site, dueSources }: (typeof due)[number]) => {
    const siteTerms = terms.get(site.siteId) ?? []
    const queries = buildQueries(siteTerms)

    // A site's sources are independent services with separate limits: poll them in parallel
    const results = await Promise.all(dueSources.map((source) => pollSource(site, source, queries, siteTerms)))
    if (results.some((r) => r !== null)) summary.sitesPolled += 1

    // One thin event per site per run, only when rows were really inserted (conflicts excluded).
    const count = siteInserted.get(site.siteId) ?? 0
    if (count > 0) {
      try {
        await publishNew({ projectId: site.projectId, count })
      } catch (error) {
        logger.warn('Mentions realtime publish failed', {
          siteId: site.siteId,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
    }
  }

  // Simple pool: `concurrency` workers pull the next site until the queue or the budget is exhausted
  let next = 0
  const worker = async () => {
    while (!expired()) {
      const entry = due[next++]
      if (!entry) return
      await pollSite(entry)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker))

  try {
    await pruneOldMentions(store, now)
  } catch (error) {
    logger.error('Mention retention failed', { error: error instanceof Error ? error.message : 'unknown' })
  }

  logger.info('Mentions poll finished', { ...summary })
  return summary
}

export async function pruneOldMentions(store: MentionsStore, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_MS)
  let total = 0
  for (let i = 0; i < MAX_RETENTION_BATCHES; i++) {
    const deleted = await store.deleteOlderThan(cutoff, RETENTION_BATCH)
    total += deleted
    if (deleted < RETENTION_BATCH) break
  }
  return total
}
