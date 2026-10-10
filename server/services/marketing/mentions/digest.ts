import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { sendMarketingMentionsDigestEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { teamMember, user } from '~/server/database/schema/auth'
import { mention, type MentionKind } from '~/server/database/schema/marketing'
import { SOCIAL_SOURCES } from '~/server/services/social-sources'
import { createLogger } from '~/server/utils/logger'
import { dbMentionsStore, isMarketingOn, type MentionsStore } from './store'

const logger = createLogger('marketing-mentions-digest')

export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000
export const DIGEST_TOP_ITEMS = 10

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

export interface DigestDeps {
  store?: Pick<MentionsStore, 'loadVerifiedSites'>
  loadDigestContent?: (siteId: string, since: Date) => Promise<DigestContent>
  loadAdminEmails?: (teamId: string) => Promise<string[]>
  sendEmail?: typeof sendMarketingMentionsDigestEmail
  baseUrl?: string
}

export interface DigestSummary {
  sitesNotified: number
  emailsSent: number
  errors: number
}

const sourceLabel = (id: string) => SOCIAL_SOURCES.find((s) => s.id === id)?.label ?? id

async function loadDigestContent(siteId: string, since: Date): Promise<DigestContent> {
  const isNew = and(eq(mention.siteId, siteId), eq(mention.status, 'new'), gte(mention.createdAt, since))

  const countRows = await db
    .select({ kind: mention.kind, total: sql<number>`count(*)::int` })
    .from(mention)
    .where(isNew)
    .groupBy(mention.kind)

  const counts = { mention: 0, competitor: 0, opportunity: 0 }
  for (const row of countRows) counts[row.kind] = Number(row.total)

  const top = await db
    .select({
      source: mention.source,
      kind: mention.kind,
      title: mention.title,
      excerpt: mention.excerpt,
      url: mention.url,
    })
    .from(mention)
    .where(isNew)
    .orderBy(sql`${mention.score} desc nulls last`, desc(mention.publishedAt))
    .limit(DIGEST_TOP_ITEMS)

  return {
    counts,
    items: top.map((row) => ({
      sourceLabel: sourceLabel(row.source),
      kind: row.kind,
      title: row.title,
      excerpt: row.excerpt,
      url: row.url,
    })),
  }
}

async function loadAdminEmails(teamId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'admin')))
  return [...new Set(rows.map((row) => row.email).filter(Boolean))]
}

/** Emails each product's team admins the mentions that arrived in the last 24 hours. */
export async function sendMentionsDigests(options: { now?: Date } = {}, deps: DigestDeps = {}): Promise<DigestSummary> {
  const now = options.now ?? new Date()
  const since = new Date(now.getTime() - DIGEST_WINDOW_MS)
  const store = deps.store ?? dbMentionsStore
  const loadContent = deps.loadDigestContent ?? loadDigestContent
  const loadEmails = deps.loadAdminEmails ?? loadAdminEmails
  const send = deps.sendEmail ?? sendMarketingMentionsDigestEmail
  const baseUrl = (deps.baseUrl ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const summary: DigestSummary = { sitesNotified: 0, emailsSent: 0, errors: 0 }

  const sites = (await store.loadVerifiedSites()).filter(isMarketingOn)

  for (const site of sites) {
    try {
      const content = await loadContent(site.siteId, since)
      const total = content.counts.mention + content.counts.competitor + content.counts.opportunity
      if (total === 0) continue

      const recipients = await loadEmails(site.teamId)
      if (recipients.length === 0) continue

      const mentionsUrl = `${baseUrl}/marketing/mentions?product=${encodeURIComponent(site.projectSlug)}`
      const results = await Promise.allSettled(
        recipients.map((to) =>
          send({ to, productName: site.projectName, counts: content.counts, items: content.items, mentionsUrl })
        )
      )
      const sent = results.filter((r) => r.status === 'fulfilled').length
      summary.emailsSent += sent
      summary.errors += results.length - sent
      if (sent > 0) summary.sitesNotified += 1
    } catch (error) {
      summary.errors += 1
      logger.error('Mentions digest failed for site', {
        siteId: site.siteId,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  logger.info('Mentions digest finished', { ...summary })
  return summary
}
