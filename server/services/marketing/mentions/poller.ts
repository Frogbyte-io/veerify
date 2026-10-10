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
import { recordUsage } from '~/server/utils/marketing-usage'
import { createLogger } from '~/server/utils/logger'
import { dbMentionsStore, isMarketingOn, type MentionInsert, type MentionsStore } from './store'

const logger = createLogger('marketing-mentions')

export const POLL_INTERVAL_MS = 30 * 60 * 1000
export const OVERLAP_MS = 60 * 60 * 1000
export const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000
export const QUERY_LIMIT = 50
export const EXCERPT_LENGTH = 500
const RETENTION_BATCH = 500
const MAX_RETENTION_BATCHES = 20

export interface PollSummary {
  sitesPolled: number
  sourcesPolled: number
  inserted: number
  errors: number
}

export interface PollDeps {
  store?: MentionsStore
  sources?: SocialSource[]
  recordUsage?: (teamId: string, metric: string, units: number) => Promise<void>
}

/** Start of the search window: one hour before the last poll, never older than seven days. */
export function computeSince(lastPolledAt: Date | null, now: Date): Date {
  const floor = now.getTime() - MAX_LOOKBACK_MS
  if (!lastPolledAt) return new Date(floor)
  return new Date(Math.max(lastPolledAt.getTime() - OVERLAP_MS, floor))
}

export function isDue(lastPolledAt: Date | null, now: Date): boolean {
  return !lastPolledAt || now.getTime() - lastPolledAt.getTime() >= POLL_INTERVAL_MS
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

export async function pollMentions(
  options: { now?: Date; maxSites?: number } = {},
  deps: PollDeps = {}
): Promise<PollSummary> {
  const now = options.now ?? new Date()
  const maxSites = options.maxSites ?? 20
  const store = deps.store ?? dbMentionsStore
  const sources = (deps.sources ?? SOCIAL_SOURCES).filter((source) => source.isConfigured())
  const usage = deps.recordUsage ?? recordUsage
  const summary: PollSummary = { sitesPolled: 0, sourcesPolled: 0, inserted: 0, errors: 0 }

  const verified = (await store.loadVerifiedSites()).filter(isMarketingOn)
  const terms = await store.loadTerms(verified.map((site) => site.siteId))
  const withTerms = verified.filter((site) => (terms.get(site.siteId)?.length ?? 0) > 0)
  const cursors = await store.loadCursors(withTerms.map((site) => site.siteId))
  const cursorOf = (siteId: string, source: string) =>
    cursors.find((c) => c.siteId === siteId && c.source === source)?.lastPolledAt ?? null

  // Oldest-polled sites first so a backlog drains fairly across runs.
  const due = withTerms
    .map((site) => {
      const dueSources = sources.filter((source) => isDue(cursorOf(site.siteId, source.id), now))
      const oldest = Math.min(...dueSources.map((s) => cursorOf(site.siteId, s.id)?.getTime() ?? 0))
      return { site, dueSources, oldest }
    })
    .filter((entry) => entry.dueSources.length > 0)
    .sort((a, b) => a.oldest - b.oldest)
    .slice(0, maxSites)

  const rateLimited = new Set<string>()

  for (const { site, dueSources } of due) {
    const siteTerms = terms.get(site.siteId) ?? []
    const queries = buildQueries(siteTerms)
    let polledAny = false

    for (const source of dueSources) {
      if (rateLimited.has(source.id)) continue
      const previous = cursorOf(site.siteId, source.id)
      const since = computeSince(previous, now)
      const found = new Map<string, MentionInsert>()
      let requests = 0
      let failure: string | null = null

      try {
        for (const { query } of queries) {
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

      try {
        if (found.size > 0) summary.inserted += await store.insertMentions([...found.values()])
        // On failure the watermark stays put (or starts at the window start), so the
        // next run re-searches the same window; inserts are idempotent.
        await store.saveCursor(site.siteId, source.id, failure ? (previous ?? since) : now, failure)
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
  }

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
