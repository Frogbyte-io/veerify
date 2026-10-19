/**
 * @openapi
 * /api/roadmap/projects/{projectId}:
 *   get:
 *     tags: [Roadmap]
 *     summary: Roadmap board of a product (team members)
 *     description: >
 *       Feedback grouped by status, one column per status. Unlike the public
 *       roadmap this includes hidden items (flagged `isHidden`) and real titles
 *       of support-derived items.
 *     operationId: getRoadmapBoard
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Columns with items, plus the public roadmap URL when the product is public }
 *       403: { description: Not a team member, or Roadmap is off }
 *       404: { description: Product not found }
 */
import { eq, desc } from 'drizzle-orm'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireRoadmapAccess } from '~/server/utils/roadmap-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { db } from '~/server/database/drizzle'
import { team } from '~/server/database/schema/auth'
import { feedback, feedbackCategory, feedbackStatus } from '~/server/database/schema/feedback'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { buildPublicBoardUrl } from '~/lib/public-board-url'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project: proj, teamId } = await requireRoadmapAccess(projectId, session.user.id)

  const customStatuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, proj.id))
    .orderBy(feedbackStatus.sortOrder)
  const statuses = customStatuses.length > 0 ? customStatuses : SYSTEM_STATUSES

  const items = await db
    .select({ feedback: feedback, category: feedbackCategory })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(eq(feedback.projectId, proj.id))
    .orderBy(desc(feedback.isPinned), desc(feedback.voteCount))

  const grouped: Record<string, typeof items> = {}
  for (const item of items) {
    const s = item.feedback.status
    if (!grouped[s]) grouped[s] = []
    grouped[s]!.push(item)
  }

  const columns = statuses.map((status) => ({
    value: status.value,
    name: status.name,
    color: status.color,
    description: (status as { description?: string | null }).description ?? null,
    sortOrder: status.sortOrder,
    items: (grouped[status.value] || []).map((item) => ({
      id: item.feedback.id,
      title: item.feedback.title,
      status: item.feedback.status,
      voteCount: item.feedback.voteCount,
      commentCount: item.feedback.commentCount,
      isPinned: item.feedback.isPinned,
      isHidden: item.feedback.isHidden === true,
      fromSupport: item.feedback.metadata?.source === 'support_conversation',
      createdAt: item.feedback.createdAt,
      category: item.category
        ? {
            id: item.category.id,
            name: item.category.name,
            slug: item.category.slug,
            icon: item.category.icon,
            color: item.category.color,
          }
        : null,
    })),
  }))

  let publicUrl: string | null = null
  if (proj.isPublic) {
    const [t] = await db.select({ slug: team.slug }).from(team).where(eq(team.id, teamId)).limit(1)
    const requestUrl = getRequestURL(event)
    publicUrl = `${buildPublicBoardUrl({
      project: { slug: proj.slug, customDomain: proj.customDomain, settings: proj.settings },
      teamSlug: t?.slug,
      projectSlug: proj.slug,
      appDomain: useRuntimeConfig().public.appDomain || 'localhost',
      protocol: requestUrl.protocol,
      port: requestUrl.port,
    })}/roadmap`
  }

  return createSuccessResponse({
    project: { id: proj.id, name: proj.name, slug: proj.slug, isPublic: proj.isPublic === true },
    publicUrl,
    columns,
  })
})
