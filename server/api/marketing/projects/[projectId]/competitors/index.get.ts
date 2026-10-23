/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors:
 *   get:
 *     tags: [Marketing]
 *     summary: Competitors with their watched pages and recent changes
 *     description: >
 *       Any project member with Marketing access. Lists the competitor terms of the site
 *       with their watched pages, the 50 most recent detected changes (newest first)
 *       and the number of unseen changes.
 *     operationId: getMarketingCompetitors
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Competitors, watches and changes }
 *       403: { description: No access to this project, or Marketing is off }
 */
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorChange, competitorWatch, marketingTerm } from '~/server/database/schema/marketing'
import { SUMMARY_SETTING_KEY } from '~/server/services/marketing/competitors/checker'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import {
  MAX_WATCHES_PER_COMPETITOR,
  MAX_WATCHES_PER_SITE,
  RECENT_CHANGES_LIMIT,
  serializeChange,
  serializeWatch,
} from '~/server/utils/marketing-competitors'
import { findMarketingSite, isMarketingAdminOf, requireRouteParam, serializeSite } from '~/server/utils/marketing-site'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project, organizationId } = await requireMarketingAccess(projectId, session.user.id)
  const canManage = await isMarketingAdminOf(projectId, session.user.id)
  const summariesEnabled = (project.settings as Record<string, unknown> | null)?.[SUMMARY_SETTING_KEY] === true

  const site = await findMarketingSite(projectId)
  const limits = {
    perCompetitor: MAX_WATCHES_PER_COMPETITOR,
    perSite: MAX_WATCHES_PER_SITE,
  }
  if (!site) {
    return createSuccessResponse({
      site: null,
      canManage,
      summariesEnabled,
      limits,
      competitors: [],
      changes: [],
      unseenCount: 0,
    })
  }

  const [terms, watches, changeRows, [unseen]] = await Promise.all([
    db
      .select()
      .from(marketingTerm)
      .where(sql`${marketingTerm.siteId} = ${site.id} and ${marketingTerm.kind} = 'competitor'`)
      .orderBy(marketingTerm.label),
    db.select().from(competitorWatch).where(eq(competitorWatch.siteId, site.id)).orderBy(competitorWatch.createdAt),
    db
      .select()
      .from(competitorChange)
      .where(eq(competitorChange.siteId, site.id))
      .orderBy(desc(competitorChange.detectedAt))
      .limit(RECENT_CHANGES_LIMIT),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(competitorChange)
      .where(sql`${competitorChange.siteId} = ${site.id} and ${competitorChange.seenAt} is null`),
  ])

  const labelByTerm = new Map(terms.map((term) => [term.id, term.label]))
  const watchById = new Map(watches.map((watch) => [watch.id, watch]))

  return createSuccessResponse({
    site: serializeSite(site),
    canManage,
    summariesEnabled,
    limits,
    competitors: terms.map((term) => ({
      id: term.id,
      label: term.label,
      competitorDomain: term.competitorDomain,
      watches: watches.filter((watch) => watch.termId === term.id).map(serializeWatch),
    })),
    changes: changeRows.flatMap((change) => {
      const watch = watchById.get(change.watchId)
      if (!watch) return []
      return [
        serializeChange(change, {
          url: watch.url,
          kind: watch.kind,
          termLabel: labelByTerm.get(watch.termId) ?? '',
        }),
      ]
    }),
    unseenCount: unseen?.total ?? 0,
  })
})
