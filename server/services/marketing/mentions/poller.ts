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
/** Wall-clock budget of one poll run; the task fires every 15 minutes, so a run never overlaps the next */
export const POLL_BUDGET_MS = 45_000
/** Sites polled at the same time */
export const POLL_CONCURRENCY = 8
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
  /** Sites polled concurrently (default 8) */
  concurrency?: number
  /** Query cap per (site, source) per run (default 20) */
  maxQueriesPerRun?: number
}

export interface PollDeps {
  /** Wall clock for the budget (injectable for tests) */
  clock?: () => number
  store?: MentionsStore
  sources?: SocialSource[]
  recordUsage?: (teamId: string, metric: string, units: number) => Promise<void>
  publishNew?: (input: { teamId: string; projectId: string; count: number }) => Promise<void>
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
 * poll all of them. Larger sites rotate: the slice index follows the poll-interval epoch, so
 * consecutive runs (one interval apart) cover consecutive slices and every query is searched once
 * every `slices` runs. No state is stored (the cursor table has no free column for an offset), so a
 * run delayed past an interval boundary can repeat or skip a slice once; see `rotationWatermark`
 * for why a skipped slice is still covered by the search window.
 */
export function selectQuerySlice<T>(
  queries: T[],
  now: Date,
  maxPerRun: number = MAX_QUERIES_PER_RUN
): { slice: T[]; slices: number } {
  const slices = Math.max(1, Math.ceil(queries.length / maxPerRun))
  if (slices === 1) return { slice: queries, slices }
  const index = Math.floor(now.getTime() / POLL_INTERVAL_MS) % slices
  return { slice: queries.slice(index * maxPerRun, (index + 1) * maxPerRun), slices }
}

/**
 * Watermark to store after a successful poll of one slice. A site polled in `slices` slices only
 * re-searches a given query every `slices` runs, so the watermark may only advance to the start of
 * that cycle (`now - (slices - 1)` intervals): the next run's window then reaches back to the last
 * time that run's own slice was searched, plus the usual overlap. Never moves backwards.
 */
export function rotationWatermark(previous: Date | null, since: Date, now: Date, slices: number): Date {
  if (slices <= 1) return now
  const cycleStart = now.getTime() - (slices - 1) * POLL_INTERVAL_MS
  return new Date(Math.min(now.getTime(), Math.max((previous ?? since).getTime(), cycleStart)))
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
 * for sites later in the queue; those are left untouched (not marked failed) and go first next run.
 * A site that fails for any other reason only backs off itself.
 */
export async function pollMentions(options: PollOptions = {}, deps: PollDeps = {}): Promise<PollSummary> {
  const now = options.now ?? new Date()
  const maxSites = options.maxSites ?? MAX_SITES_PER_RUN
  const clock = deps.clock ?? Date.now
  const deadline = clock() + (options.budgetMs ?? POLL_BUDGET_MS)
  const concurrency = Math.max(1, options.concurrency ?? POLL_CONCURRENCY)
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

  const pollSite = async ({ site, dueSources }: (typeof due)[number]) => {
    const siteTerms = terms.get(site.siteId) ?? []
    const queries = buildQueries(siteTerms)
    const { slice, slices } = selectQuerySlice(queries, now, maxQueries)
    let polledAny = false
    let siteInserted = 0

    for (const source of dueSources) {
      if (expired()) break
      if (rateLimited.has(source.id)) continue
      const existing = cursorRow(site.siteId, source.id)
      const previous = existing?.lastPolledAt ?? null
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
      if (!claimed) continue

      const found = new Map<string, MentionInsert>()
      let requests = 0
      let failure: string | null = null

      try {
        for (const { query } of slice) {
          // Budget spent, or a concurrent site just tripped this source's (app-wide) rate limit
          if (expired() || rateLimited.has(source.id)) break
          requests += 1
          const posts = await source.search({ query, since, limit: QUERY_LIMIT })
          for (const post of posts) {
            if (found.has(post.externalId)) continue
            const row = toMentionRow(site.siteId, post, siteTerms)
            if (row) found.set(post.externalId, row)
          }
        }
      } catch (error) {
        failure = describeError(error)
        summary.errors += 1
        if (error instanceof SocialSourceError && error.kind === 'rate_limit') rateLimited.add(source.id)
        logger.warn('Mentions source failed', {
          siteId: site.siteId,
          source: source.id,
          kind: error instanceof SocialSourceError ? error.kind : 'unknown',
        })
      }

      // Budget ran out between queries: some of the slice was not searched
      const cutShort = !failure && requests < slice.length

      try {
        if (found.size > 0) {
          const inserted = await store.insertMentions([...found.values()])
          summary.inserted += inserted
          siteInserted += inserted
        }
        if (!(cutShort && requests === 0)) {
          // On failure or a cut-short run the watermark stays put (or starts at the window start), so
          // the next run re-searches the same window; inserts are idempotent.
          const watermark = failure || cutShort ? (previous ?? since) : rotationWatermark(previous, since, now, slices)
          await store.saveCursor(site.siteId, source.id as MentionSource, watermark, failure, {
            at: now,
            consecutiveFailures: failure ? (existing?.consecutiveFailures ?? 0) + 1 : 0,
          })
        }
        if (requests > 0) await usage(site.teamId, `mentions:${source.id}:requests`, requests)
      } catch (error) {
        summary.errors += 1
        logger.error('Failed to store mentions', {
          siteId: site.siteId,
          source: source.id,
          error: error instanceof Error ? error.message : 'unknown',
        })
        continue
      }

      summary.sourcesPolled += 1
      polledAny = true
    }

    if (polledAny) summary.sitesPolled += 1

    // One thin event per site per run, only when rows were really inserted (conflicts excluded).
    if (siteInserted > 0) {
      try {
        await publishNew({ teamId: site.teamId, projectId: site.projectId, count: siteInserted })
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
