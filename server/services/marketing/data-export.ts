import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  aiVisibilityAnswer,
  aiVisibilityPrompt,
  aiVisibilityRun,
  competitorChange,
  competitorWatch,
  customerLanguageInsight,
  gscConnection,
  gscDailyMetric,
  launchKitItem,
  marketingAnnouncementDraft,
  marketingSite,
  marketingTerm,
  mention,
  reviewRequest,
  seoAudit,
  seoAuditPage,
  seoIssue,
  testimonial,
} from '~/server/database/schema/marketing'

/** Upper bound per table so one export cannot exhaust memory. The newest rows win. */
export const EXPORT_ROW_LIMIT = 5000

/**
 * A JSON snapshot of one product's Marketing data. Never includes secrets: no site verification token,
 * no encrypted keys or refresh tokens, no review request tokens. Audit pages are reduced to url, status
 * and title; crawled page bodies and competitor page text are not exported.
 */
export async function exportProductMarketingData(projectId: string, productSlug: string) {
  const [site] = await db.select().from(marketingSite).where(eq(marketingSite.projectId, projectId)).limit(1)

  const reviewRequests = await db
    .select({
      id: reviewRequest.id,
      email: reviewRequest.email,
      name: reviewRequest.name,
      trigger: reviewRequest.trigger,
      status: reviewRequest.status,
      skipReason: reviewRequest.skipReason,
      sentAt: reviewRequest.sentAt,
      clickedAt: reviewRequest.clickedAt,
      createdAt: reviewRequest.createdAt,
    })
    .from(reviewRequest)
    .where(eq(reviewRequest.projectId, projectId))
    .orderBy(desc(reviewRequest.createdAt))
    .limit(EXPORT_ROW_LIMIT)
  const testimonials = await db
    .select()
    .from(testimonial)
    .where(eq(testimonial.projectId, projectId))
    .orderBy(desc(testimonial.createdAt))
    .limit(EXPORT_ROW_LIMIT)
  const launchKit = await db.select().from(launchKitItem).where(eq(launchKitItem.projectId, projectId))
  const announcementDrafts = await db
    .select({
      entryId: marketingAnnouncementDraft.entryId,
      channel: marketingAnnouncementDraft.channel,
      content: marketingAnnouncementDraft.content,
      edited: marketingAnnouncementDraft.edited,
      createdAt: marketingAnnouncementDraft.createdAt,
      updatedAt: marketingAnnouncementDraft.updatedAt,
    })
    .from(marketingAnnouncementDraft)
    .where(eq(marketingAnnouncementDraft.projectId, projectId))

  const exported: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    product: { id: projectId, slug: productSlug },
    site: site
      ? {
          id: site.id,
          origin: site.origin,
          verified: site.verifiedAt !== null,
          verifiedAt: site.verifiedAt,
          verificationMethod: site.verificationMethod,
          createdAt: site.createdAt,
        }
      : null,
    reviewRequests,
    testimonials,
    launchKit,
    announcementDrafts,
  }

  if (!site) return exported

  const siteId = site.id
  const audits = await db
    .select({
      id: seoAudit.id,
      trigger: seoAudit.trigger,
      mode: seoAudit.mode,
      status: seoAudit.status,
      score: seoAudit.score,
      pagesFetched: seoAudit.pagesFetched,
      error: seoAudit.error,
      startedAt: seoAudit.startedAt,
      finishedAt: seoAudit.finishedAt,
      createdAt: seoAudit.createdAt,
    })
    .from(seoAudit)
    .where(eq(seoAudit.siteId, siteId))
    .orderBy(desc(seoAudit.createdAt))
    .limit(EXPORT_ROW_LIMIT)
  const auditIds = audits.map((row) => row.id)
  const pages = auditIds.length
    ? await db
        .select({
          auditId: seoAuditPage.auditId,
          url: seoAuditPage.url,
          statusCode: seoAuditPage.statusCode,
          facts: seoAuditPage.facts,
        })
        .from(seoAuditPage)
        .where(inArray(seoAuditPage.auditId, auditIds))
        .limit(EXPORT_ROW_LIMIT)
    : []
  const issues = auditIds.length
    ? await db
        .select({
          auditId: seoIssue.auditId,
          ruleId: seoIssue.ruleId,
          severity: seoIssue.severity,
          pageUrl: seoIssue.pageUrl,
        })
        .from(seoIssue)
        .where(inArray(seoIssue.auditId, auditIds))
        .limit(EXPORT_ROW_LIMIT)
    : []

  exported.terms = await db.select().from(marketingTerm).where(eq(marketingTerm.siteId, siteId))
  exported.audits = audits.map((audit) => ({
    ...audit,
    pages: pages
      .filter((page) => page.auditId === audit.id)
      .map((page) => ({ url: page.url, statusCode: page.statusCode, title: page.facts?.title ?? null })),
    issues: issues
      .filter((issue) => issue.auditId === audit.id)
      .map(({ ruleId, severity, pageUrl }) => ({ ruleId, severity, pageUrl })),
  }))

  exported.visibility = {
    prompts: await db.select().from(aiVisibilityPrompt).where(eq(aiVisibilityPrompt.siteId, siteId)),
    runs: await db
      .select()
      .from(aiVisibilityRun)
      .where(eq(aiVisibilityRun.siteId, siteId))
      .orderBy(desc(aiVisibilityRun.createdAt))
      .limit(EXPORT_ROW_LIMIT),
    answers: await db
      .select({
        runId: aiVisibilityAnswer.runId,
        promptId: aiVisibilityAnswer.promptId,
        provider: aiVisibilityAnswer.provider,
        model: aiVisibilityAnswer.model,
        sample: aiVisibilityAnswer.sample,
        status: aiVisibilityAnswer.status,
        answer: aiVisibilityAnswer.answer,
        citations: aiVisibilityAnswer.citations,
        brandMentioned: aiVisibilityAnswer.brandMentioned,
        brandRank: aiVisibilityAnswer.brandRank,
        competitorsMentioned: aiVisibilityAnswer.competitorsMentioned,
        brandSentiment: aiVisibilityAnswer.brandSentiment,
        createdAt: aiVisibilityAnswer.createdAt,
      })
      .from(aiVisibilityAnswer)
      .innerJoin(aiVisibilityRun, eq(aiVisibilityRun.id, aiVisibilityAnswer.runId))
      .where(eq(aiVisibilityRun.siteId, siteId))
      .orderBy(desc(aiVisibilityAnswer.createdAt))
      .limit(EXPORT_ROW_LIMIT),
  }

  exported.mentions = await db
    .select()
    .from(mention)
    .where(eq(mention.siteId, siteId))
    .orderBy(desc(mention.publishedAt))
    .limit(EXPORT_ROW_LIMIT)

  exported.competitors = {
    watches: await db
      .select({
        id: competitorWatch.id,
        termId: competitorWatch.termId,
        url: competitorWatch.url,
        kind: competitorWatch.kind,
        status: competitorWatch.status,
        lastCheckedAt: competitorWatch.lastCheckedAt,
        lastChangedAt: competitorWatch.lastChangedAt,
        createdAt: competitorWatch.createdAt,
      })
      .from(competitorWatch)
      .where(eq(competitorWatch.siteId, siteId)),
    changes: await db
      .select({
        watchId: competitorChange.watchId,
        detectedAt: competitorChange.detectedAt,
        addedText: competitorChange.addedText,
        removedText: competitorChange.removedText,
        summary: competitorChange.summary,
      })
      .from(competitorChange)
      .where(eq(competitorChange.siteId, siteId))
      .orderBy(desc(competitorChange.detectedAt))
      .limit(EXPORT_ROW_LIMIT),
  }

  exported.customerLanguageInsights = await db
    .select({
      id: customerLanguageInsight.id,
      provider: customerLanguageInsight.provider,
      model: customerLanguageInsight.model,
      itemCount: customerLanguageInsight.itemCount,
      sources: customerLanguageInsight.sources,
      phrases: customerLanguageInsight.phrases,
      suggestedTerms: customerLanguageInsight.suggestedTerms,
      suggestedPrompts: customerLanguageInsight.suggestedPrompts,
      createdAt: customerLanguageInsight.createdAt,
    })
    .from(customerLanguageInsight)
    .where(eq(customerLanguageInsight.siteId, siteId))
    .orderBy(desc(customerLanguageInsight.createdAt))

  const [connection] = await db
    .select({
      googleAccountEmail: gscConnection.googleAccountEmail,
      propertyUrl: gscConnection.propertyUrl,
      status: gscConnection.status,
      lastSyncAt: gscConnection.lastSyncAt,
    })
    .from(gscConnection)
    .where(eq(gscConnection.siteId, siteId))
    .limit(1)
  exported.searchConsole = {
    connection: connection ?? null,
    dailyMetrics: await db
      .select()
      .from(gscDailyMetric)
      .where(eq(gscDailyMetric.siteId, siteId))
      .orderBy(asc(gscDailyMetric.date)),
  }

  return exported
}
