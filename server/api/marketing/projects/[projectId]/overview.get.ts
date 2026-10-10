/**
 * @openapi
 * /api/marketing/projects/{projectId}/overview:
 *   get:
 *     tags: [Marketing]
 *     summary: Marketing overview for a product
 *     description: >
 *       Setup checklist state, integration status, this month's usage and the
 *       latest audit, AI visibility run and new mention count, plus compact
 *       summaries for Search Console, reviews, announcements, customer language
 *       and the changelog (each reports whether it is set up).
 *     operationId: getMarketingOverview
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Overview }
 *       403: { description: Not a team member, or Marketing is off for the team or product }
 *       404: { description: Product not found }
 */
import { and, asc, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  aiVisibilityAnswer,
  aiVisibilityRun,
  customerLanguageInsight,
  gscDailyMetric,
  marketingAnnouncementDraft,
  marketingDataConsent,
  marketingTerm,
  mention,
  reviewRequest,
  reviewRequestSettings,
  seoAudit,
  testimonial,
} from '~/server/database/schema/marketing'
import { changelogEntry } from '~/server/database/schema/changelog'
import { resolveProductModules } from '~/lib/modules'
import { findGscConnection, isGscConfigured } from '~/server/services/marketing/search/connection'
import { computeTotals, shiftDate, splitPeriods } from '~/server/services/marketing/search/summary'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { findMarketingSite, requireRouteParam, serializeSite } from '~/server/utils/marketing-site'
import { getIntegrationStatus } from '~/server/utils/marketing-integrations'
import { getUsage } from '~/server/utils/marketing-usage'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project, teamId } = await requireMarketingAccess(projectId, session.user.id)

  const [site, integrations, usage] = await Promise.all([
    findMarketingSite(projectId),
    getIntegrationStatus(teamId),
    getUsage(teamId),
  ])

  let hasBrandTerm = false
  let latestAudit = null
  let latestVisibilityRun = null
  let newMentions = 0

  if (site) {
    const [brandRows, auditRows, runRows, mentionRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(marketingTerm)
        .where(and(eq(marketingTerm.siteId, site.id), eq(marketingTerm.kind, 'brand'))),
      db
        .select({
          id: seoAudit.id,
          score: seoAudit.score,
          mode: seoAudit.mode,
          status: seoAudit.status,
          finishedAt: seoAudit.finishedAt,
        })
        .from(seoAudit)
        .where(eq(seoAudit.siteId, site.id))
        .orderBy(desc(seoAudit.createdAt))
        .limit(1),
      db
        .select({ id: aiVisibilityRun.id, status: aiVisibilityRun.status, finishedAt: aiVisibilityRun.finishedAt })
        .from(aiVisibilityRun)
        .where(eq(aiVisibilityRun.siteId, site.id))
        .orderBy(desc(aiVisibilityRun.createdAt))
        .limit(1),
      db
        .select({ total: count() })
        .from(mention)
        .where(and(eq(mention.siteId, site.id), eq(mention.status, 'new'))),
    ])

    hasBrandTerm = (brandRows[0]?.total ?? 0) > 0
    latestAudit = auditRows[0] ?? null
    newMentions = mentionRows[0]?.total ?? 0

    const run = runRows[0]
    if (run) {
      const answers = await db
        .select({ brandMentioned: aiVisibilityAnswer.brandMentioned })
        .from(aiVisibilityAnswer)
        .where(and(eq(aiVisibilityAnswer.runId, run.id), isNotNull(aiVisibilityAnswer.brandMentioned)))
      const mentioned = answers.filter((a) => a.brandMentioned === true).length
      latestVisibilityRun = { ...run, mentionRate: answers.length > 0 ? mentioned / answers.length : null }
    }
  }

  // Each loader is a handful of count/limit queries; run in order so the
  // response cost stays predictable.
  const search = await loadSearch(site?.id ?? null)
  const reviews = await loadReviews(projectId)
  const announcements = await loadAnnouncements(projectId, changelogOn(project))
  const language = await loadLanguage(site?.id ?? null, teamId)
  const changelog = await loadChangelog(projectId, changelogOn(project))

  const state = (id: string) => integrations.find((i) => i.id === id)?.state
  const usable = (id: string) => state(id) === 'ready'

  return createSuccessResponse({
    site: site ? serializeSite(site) : null,
    setup: {
      siteAdded: site !== null,
      siteVerified: site?.verifiedAt != null,
      hasBrandTerm,
      hasLlmKey: usable('anthropic') || usable('openai'),
      hasCrawlKey: usable('firecrawl'),
    },
    integrations,
    usage,
    latestAudit,
    latestVisibilityRun,
    newMentions,
    search,
    reviews,
    announcements,
    language,
    changelog,
  })
})

const DAY_MS = 24 * 60 * 60 * 1000
const SEARCH_DAYS = 28
const REVIEW_DAYS = 30

function changelogOn(project: { settings?: unknown }): boolean {
  return resolveProductModules(project.settings as Record<string, unknown> | null).changelogEnabled === true
}

/** Clicks and impressions for the last 28 synced days against the 28 before. At most 56 rows. */
async function loadSearch(siteId: string | null) {
  const configured = isGscConfigured()
  const conn = siteId ? await findGscConnection(siteId) : null
  if (!siteId || !conn) return { configured, connected: false, status: null, totals: null }

  const [latest] = await db
    .select({ date: gscDailyMetric.date })
    .from(gscDailyMetric)
    .where(eq(gscDailyMetric.siteId, siteId))
    .orderBy(desc(gscDailyMetric.date))
    .limit(1)
  const rows = latest
    ? await db
        .select({
          date: gscDailyMetric.date,
          clicks: gscDailyMetric.clicks,
          impressions: gscDailyMetric.impressions,
          ctr: gscDailyMetric.ctr,
          position: gscDailyMetric.position,
        })
        .from(gscDailyMetric)
        .where(
          and(
            eq(gscDailyMetric.siteId, siteId),
            gte(gscDailyMetric.date, shiftDate(latest.date, -(2 * SEARCH_DAYS - 1)))
          )
        )
        .orderBy(asc(gscDailyMetric.date))
    : []
  const { current, previous } = splitPeriods(rows, SEARCH_DAYS)
  const totals = current.length
    ? {
        days: SEARCH_DAYS,
        current: computeTotals(current),
        previous: previous ? computeTotals(previous) : null,
      }
    : null
  return { configured, connected: true, status: conn.status, totals }
}

async function loadReviews(projectId: string) {
  const since = new Date(Date.now() - REVIEW_DAYS * DAY_MS)
  const settingsRows = await db
    .select({ enabled: reviewRequestSettings.enabled })
    .from(reviewRequestSettings)
    .where(eq(reviewRequestSettings.projectId, projectId))
    .limit(1)
  const sentRows = await db
    .select({ total: count() })
    .from(reviewRequest)
    .where(and(eq(reviewRequest.projectId, projectId), gte(reviewRequest.sentAt, since)))
  const pendingRows = await db
    .select({ total: count() })
    .from(testimonial)
    .where(and(eq(testimonial.projectId, projectId), eq(testimonial.status, 'pending')))
  return {
    enabled: settingsRows[0]?.enabled === true,
    requestsSent: sentRows[0]?.total ?? 0,
    sinceDays: REVIEW_DAYS,
    pendingTestimonials: pendingRows[0]?.total ?? 0,
  }
}

/** Published entries that have no announcement draft yet. */
async function loadAnnouncements(projectId: string, changelogEnabled: boolean) {
  if (!changelogEnabled) return { changelogEnabled: false, withoutDrafts: 0 }
  const [row] = await db
    .select({ total: count() })
    .from(changelogEntry)
    .where(
      and(
        eq(changelogEntry.projectId, projectId),
        eq(changelogEntry.status, 'published'),
        sql`not exists (select 1 from ${marketingAnnouncementDraft} where ${marketingAnnouncementDraft.entryId} = ${changelogEntry.id})`
      )
    )
  return { changelogEnabled: true, withoutDrafts: row?.total ?? 0 }
}

async function loadLanguage(siteId: string | null, teamId: string) {
  const consentRows = await db
    .select({ feedback: marketingDataConsent.allowFeedbackText, support: marketingDataConsent.allowSupportText })
    .from(marketingDataConsent)
    .where(eq(marketingDataConsent.teamId, teamId))
    .limit(1)
  const insightRows = siteId
    ? await db
        .select({ createdAt: customerLanguageInsight.createdAt })
        .from(customerLanguageInsight)
        .where(eq(customerLanguageInsight.siteId, siteId))
        .orderBy(desc(customerLanguageInsight.createdAt))
        .limit(1)
    : []
  const consent = consentRows[0]
  return {
    consented: consent?.feedback === true || consent?.support === true,
    lastRunAt: insightRows[0]?.createdAt ?? null,
  }
}

async function loadChangelog(projectId: string, changelogEnabled: boolean) {
  if (!changelogEnabled) return { enabled: false, latest: null }
  const [latest] = await db
    .select({
      id: changelogEntry.id,
      title: changelogEntry.title,
      slug: changelogEntry.slug,
      publishedAt: changelogEntry.publishedAt,
    })
    .from(changelogEntry)
    .where(and(eq(changelogEntry.projectId, projectId), eq(changelogEntry.status, 'published')))
    .orderBy(desc(changelogEntry.publishedAt))
    .limit(1)
  return { enabled: true, latest: latest ?? null }
}
