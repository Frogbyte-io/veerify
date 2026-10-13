import { and, eq, inArray, sql } from 'drizzle-orm'
import { sendMarketingMentionsDigestEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { teamMember, user } from '~/server/database/schema/auth'
import { marketingUsage, mention, type MentionKind } from '~/server/database/schema/marketing'
import { SOCIAL_SOURCES } from '~/server/services/social-sources'
import { currentPeriod } from '~/server/utils/marketing-usage'
import { sqlTimestamp } from '~/server/utils/sql-timestamp'
import { createLogger } from '~/server/utils/logger'
import { dbMentionsStore, isMarketingOn, type MentionsStore } from './store'

const logger = createLogger('marketing-mentions-digest')

export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000
export const DIGEST_TOP_ITEMS = 10
/** UTC hour the digest window ends at; the task runs hourly from 07:00 to 11:00 so a run can resume */
export const DIGEST_HOUR_UTC = 7
/** Wall-clock budget of one run; teams left over are picked up by the next hourly run */
export const DIGEST_BUDGET_MS = 45_000
/** Teams claimed and processed per batch (also the granularity of the budget check) */
export const DIGEST_TEAM_BATCH = 25
/** Emails sent at the same time within a batch; the time budget is checked before each team's first email */
export const DIGEST_SEND_CONCURRENCY = 10
const SITE_QUERY_CHUNK = 500

export interface DigestItem {
  sourceLabel: string
  kind: MentionKind
  title: string | null
  excerpt: string
  url: string
}

export interface DigestContent {
  counts: { mention: number; competitor: number; opportunity: number }
  items: DigestItem[]
}

/** Idempotency ledger: one row per (team, UTC date) in `marketing_usage` with metric `digest:<date>`. */
export interface DigestLedger {
  /** Teams whose digest for `date` was already claimed (by any worker) */
  listClaimed: (date: string) => Promise<Set<string>>
  /** Atomically claims the teams; resolves the subset this caller won (INSERT ... ON CONFLICT DO NOTHING RETURNING) */
  claim: (teamIds: string[], date: string, now: Date) => Promise<Set<string>>
  /** Gives a claim back (every email of the team failed) so a later run retries it */
  release: (teamIds: string[], date: string, now: Date) => Promise<void>
}

export interface DigestDeps {
  store?: Pick<MentionsStore, 'loadVerifiedSites'>
  ledger?: DigestLedger
  /** Sites with at least one new mention since `since` (a cheap prefilter) */
  loadSitesWithNewMentions?: (since: Date) => Promise<Set<string>>
  loadDigestContents?: (siteIds: string[], since: Date) => Promise<Map<string, DigestContent>>
  loadAdminEmailsForTeams?: (teamIds: string[]) => Promise<Map<string, string[]>>
  sendEmail?: typeof sendMarketingMentionsDigestEmail
  baseUrl?: string
  clock?: () => number
}

export interface DigestSummary {
  sitesNotified: number
  emailsSent: number
  errors: number
  /** Teams this run claimed and processed */
  teamsProcessed: number
  /** Teams skipped because another run/worker already claimed today's digest */
  teamsAlreadyClaimed: number
  /** Teams left for the next hourly run because the time budget ran out */
  teamsDeferred: number
}

const sourceLabel = (id: string) => SOCIAL_SOURCES.find((s) => s.id === id)?.label ?? id

export function digestDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function digestMetric(date: string): string {
  return `digest:${date}`
}

/** End of the 24 h window: 07:00 UTC of the run's date (or `now` before that), stable across resumed runs. */
export function digestWindowEnd(now: Date): Date {
  const anchor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC)
  return new Date(Math.min(now.getTime(), anchor))
}

const dbLedger: DigestLedger = {
  async listClaimed(date) {
    const rows = await db
      .select({ teamId: marketingUsage.teamId })
      .from(marketingUsage)
      .where(
        and(eq(marketingUsage.period, currentPeriod(new Date(date))), eq(marketingUsage.metric, digestMetric(date)))
      )
    return new Set(rows.map((r) => r.teamId))
  },
  async claim(teamIds, date, now) {
    if (teamIds.length === 0) return new Set()
    const rows = await db
      .insert(marketingUsage)
      .values(
        teamIds.map((teamId) => ({
          teamId,
          period: currentPeriod(new Date(date)),
          metric: digestMetric(date),
          units: 1,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing()
      .returning({ teamId: marketingUsage.teamId })
    return new Set(rows.map((r) => r.teamId))
  },
  async release(teamIds, date) {
    if (teamIds.length === 0) return
    await db
      .delete(marketingUsage)
      .where(
        and(
          inArray(marketingUsage.teamId, teamIds),
          eq(marketingUsage.period, currentPeriod(new Date(date))),
          eq(marketingUsage.metric, digestMetric(date))
        )
      )
  },
}

async function loadSitesWithNewMentions(since: Date): Promise<Set<string>> {
  const res = await db.execute<{ site_id: string }>(sql`
    SELECT DISTINCT site_id FROM mention
    WHERE status = 'new' AND created_at >= ${sqlTimestamp(since)}
  `)
  return new Set(res.rows.map((r) => r.site_id))
}

/** Counts and top items for many sites in two queries per chunk (not two per site). */
async function loadDigestContents(siteIds: string[], since: Date): Promise<Map<string, DigestContent>> {
  const result = new Map<string, DigestContent>()
  const content = (siteId: string) => {
    let entry = result.get(siteId)
    if (!entry) {
      entry = { counts: { mention: 0, competitor: 0, opportunity: 0 }, items: [] }
      result.set(siteId, entry)
    }
    return entry
  }

  for (let i = 0; i < siteIds.length; i += SITE_QUERY_CHUNK) {
    const chunk = siteIds.slice(i, i + SITE_QUERY_CHUNK)
    const isNew = and(
      inArray(mention.siteId, chunk),
      eq(mention.status, 'new'),
      sql`${mention.createdAt} >= ${sqlTimestamp(since)}`
    )

    const countRows = await db
      .select({ siteId: mention.siteId, kind: mention.kind, total: sql<number>`count(*)::int` })
      .from(mention)
      .where(isNew)
      .groupBy(mention.siteId, mention.kind)
    for (const row of countRows) content(row.siteId).counts[row.kind] = Number(row.total)

    const top = await db.execute<{
      site_id: string
      source: string
      kind: MentionKind
      title: string | null
      excerpt: string
      url: string
    }>(sql`
      SELECT site_id, source, kind, title, excerpt, url FROM (
        SELECT m.site_id, m.source, m.kind, m.title, m.excerpt, m.url,
               row_number() OVER (
                 PARTITION BY m.site_id ORDER BY m.score DESC NULLS LAST, m.published_at DESC
               ) AS rn
        FROM mention m
        WHERE m.site_id IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `
        )})
          AND m.status = 'new' AND m.created_at >= ${sqlTimestamp(since)}
      ) ranked
      WHERE rn <= ${DIGEST_TOP_ITEMS}
      ORDER BY site_id, rn
    `)
    for (const row of top.rows) {
      content(row.site_id).items.push({
        sourceLabel: sourceLabel(row.source),
        kind: row.kind,
        title: row.title,
        excerpt: row.excerpt,
        url: row.url,
      })
    }
  }
  return result
}

type AdminRow = { email: string; settings: { notificationPreferences?: { marketingDigest?: boolean } } | null }

/** Admins opt out with the `marketingDigest` notification preference (default on) */
function optedInEmails(rows: AdminRow[]): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => row.settings?.notificationPreferences?.marketingDigest !== false)
        .map((row) => row.email)
        .filter(Boolean)
    ),
  ]
}

export async function loadAdminEmails(teamId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email, settings: user.settings })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'admin')))
  return optedInEmails(rows)
}

/** Admin emails for many teams in one query. */
export async function loadAdminEmailsForTeams(teamIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (teamIds.length === 0) return result
  const rows = await db
    .select({ teamId: teamMember.teamId, email: user.email, settings: user.settings })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(inArray(teamMember.teamId, teamIds), eq(teamMember.role, 'admin')))
  const byTeam = new Map<string, AdminRow[]>()
  for (const row of rows) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), row])
  for (const [teamId, teamRows] of byTeam) result.set(teamId, optedInEmails(teamRows))
  return result
}

/**
 * Emails each product's team admins the mentions that arrived in the last 24 hours.
 *
 * Multi-replica safe and resumable. Each (team, UTC date) is claimed in `marketing_usage`
 * (`digest:<date>`, INSERT ... ON CONFLICT DO NOTHING RETURNING) before anything is sent, so two
 * workers running at once split the teams and never both email one. The task runs hourly from
 * 07:00 to 11:00 UTC: a run stops starting batches and teams once its budget is spent (checked before each team's first
 * email; a started team is always finished, so the run can overrun by that team's remaining emails), and the next run continues with teams nobody has claimed yet; a team
 * whose emails were not started at all gets its claim back. Delivery is at-most-once per team and day: a worker
 * that dies after claiming loses that team's digest for the day. When every email of a team fails
 * (for example SMTP is down) the claim is released so the next hourly run retries.
 */
export async function sendMentionsDigests(
  options: { now?: Date; budgetMs?: number; teamBatch?: number } = {},
  deps: DigestDeps = {}
): Promise<DigestSummary> {
  const now = options.now ?? new Date()
  const clock = deps.clock ?? Date.now
  const deadline = clock() + (options.budgetMs ?? DIGEST_BUDGET_MS)
  const batchSize = Math.max(1, options.teamBatch ?? DIGEST_TEAM_BATCH)
  const date = digestDate(now)
  const since = new Date(digestWindowEnd(now).getTime() - DIGEST_WINDOW_MS)
  const store = deps.store ?? dbMentionsStore
  const ledger = deps.ledger ?? dbLedger
  const loadSitesWithMentions = deps.loadSitesWithNewMentions ?? loadSitesWithNewMentions
  const loadContents = deps.loadDigestContents ?? loadDigestContents
  const loadEmails = deps.loadAdminEmailsForTeams ?? loadAdminEmailsForTeams
  const send = deps.sendEmail ?? sendMarketingMentionsDigestEmail
  const baseUrl = (deps.baseUrl ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const summary: DigestSummary = {
    sitesNotified: 0,
    emailsSent: 0,
    errors: 0,
    teamsProcessed: 0,
    teamsAlreadyClaimed: 0,
    teamsDeferred: 0,
  }

  const withMentions = await loadSitesWithMentions(since)
  const sites = (await store.loadVerifiedSites()).filter((site) => isMarketingOn(site) && withMentions.has(site.siteId))
  const sitesByTeam = new Map<string, typeof sites>()
  for (const site of sites) sitesByTeam.set(site.teamId, [...(sitesByTeam.get(site.teamId) ?? []), site])

  const alreadyClaimed = await ledger.listClaimed(date)
  const teams = [...sitesByTeam.keys()].filter((teamId) => !alreadyClaimed.has(teamId))
  summary.teamsAlreadyClaimed = sitesByTeam.size - teams.length

  for (let i = 0; i < teams.length; i += batchSize) {
    if (clock() >= deadline) {
      summary.teamsDeferred += teams.length - i
      break
    }
    const batch = teams.slice(i, i + batchSize)
    // The claim is the single-send guarantee: only the teams this worker wins are processed
    const won = await ledger.claim(batch, date, now)
    summary.teamsAlreadyClaimed += batch.length - won.size
    if (won.size === 0) continue
    const claimedTeams = batch.filter((teamId) => won.has(teamId))
    summary.teamsProcessed += claimedTeams.length

    const failedTeams: string[] = []
    try {
      const batchSites = claimedTeams.flatMap((teamId) => sitesByTeam.get(teamId) ?? [])
      const [contents, emails] = await Promise.all([
        loadContents(
          batchSites.map((site) => site.siteId),
          since
        ),
        loadEmails(claimedTeams),
      ])

      type Job = { teamId: string; siteId: string; payload: Parameters<typeof send>[0] }
      const jobs: Job[] = []
      for (const teamId of claimedTeams) {
        for (const site of sitesByTeam.get(teamId) ?? []) {
          const content = contents.get(site.siteId)
          if (!content) continue
          const total = content.counts.mention + content.counts.competitor + content.counts.opportunity
          if (total === 0) continue
          const mentionsUrl = `${baseUrl}/marketing/mentions?product=${encodeURIComponent(site.projectSlug)}`
          for (const to of emails.get(teamId) ?? []) {
            jobs.push({
              teamId,
              siteId: site.siteId,
              payload: { to, productName: site.projectName, counts: content.counts, items: content.items, mentionsUrl },
            })
          }
        }
      }

      const stats = new Map<string, { sent: number; errors: number; attempted: number; jobs: number }>()
      const sitesNotified = new Set<string>()
      for (const job of jobs) {
        const entry = stats.get(job.teamId) ?? { sent: 0, errors: 0, attempted: 0, jobs: 0 }
        entry.jobs += 1
        stats.set(job.teamId, entry)
      }
      // Send pool: workers take the next email. The budget is only checked before a team's FIRST email:
      // once any job of a team has started, all of its jobs run, because the team keeps its per-day
      // claim and a half-sent team would never get the rest of its recipients' digests that day. The
      // overrun past the deadline is bounded by the remaining emails of the teams already started
      // (sites x admins per team, at most DIGEST_SEND_CONCURRENCY in flight).
      let next = 0
      const worker = async () => {
        for (;;) {
          const job = jobs[next++]
          if (!job) return
          const entry = stats.get(job.teamId)!
          if (entry.attempted === 0 && clock() >= deadline) continue
          entry.attempted += 1
          try {
            await send(job.payload)
            entry.sent += 1
            summary.emailsSent += 1
            sitesNotified.add(job.siteId)
          } catch (error) {
            entry.errors += 1
            summary.errors += 1
            logger.error('Mentions digest email failed', { error: error instanceof Error ? error.message : 'unknown' })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(DIGEST_SEND_CONCURRENCY, jobs.length) }, worker))
      summary.sitesNotified += sitesNotified.size

      for (const [teamId, entry] of stats) {
        if (entry.attempted === 0) {
          // Budget ran out before any email of this team started: give the claim back for the next run
          failedTeams.push(teamId)
          summary.teamsProcessed -= 1
          summary.teamsDeferred += 1
        } else if (entry.sent === 0 && entry.errors > 0) {
          failedTeams.push(teamId)
        }
      }
    } catch (error) {
      // Loading content failed for the whole batch: nothing was sent, so give the claims back
      summary.errors += 1
      failedTeams.push(...claimedTeams)
      logger.error('Mentions digest batch failed', { error: error instanceof Error ? error.message : 'unknown' })
    }
    if (failedTeams.length > 0) {
      await ledger.release([...new Set(failedTeams)], date, now).catch(() => undefined)
    }
  }

  logger.info('Mentions digest finished', { ...summary })
  return summary
}
