import { eq, desc } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, feedbackStatus } from '~/server/database/schema/feedback'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const { team: t, project: proj } = await resolvePublicProjectByTeam(teamSlug!, projectSlug!)

  // Load custom statuses for this project, falling back to system defaults
  const customStatuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, proj.id))
    .orderBy(feedbackStatus.sortOrder)

  const statuses = customStatuses.length > 0 ? customStatuses : SYSTEM_STATUSES

  // Load all visible feedback for the project with categories
  const items = await db
    .select({ feedback: feedback, category: feedbackCategory })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(eq(feedback.projectId, proj.id))
    .orderBy(desc(feedback.isPinned), desc(feedback.voteCount))

  const visibleItems = items.filter((i) => !i.feedback.isHidden)

  // Group feedback by status
  const grouped: Record<string, typeof visibleItems> = {}
  for (const item of visibleItems) {
    const s = item.feedback.status
    if (!grouped[s]) grouped[s] = []
    grouped[s].push(item)
  }

  const columns = statuses.map((status) => ({
    value: status.value,
    name: status.name,
    color: status.color,
    description: (status as any).description ?? null,
    sortOrder: status.sortOrder,
    items: (grouped[status.value] || []).map((item) => ({
      id: item.feedback.id,
      title: item.feedback.title,
      body: item.feedback.body,
      status: item.feedback.status,
      tag: item.feedback.metadata?.feedbackType || null,
      voteCount: item.feedback.voteCount,
      commentCount: item.feedback.commentCount,
      authorName: item.feedback.authorName,
      isPinned: item.feedback.isPinned,
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

  return createSuccessResponse({
    project: {
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      description: proj.description,
      customDomain: proj.customDomain,
      settings: proj.settings,
    },
    team: {
      name: t.name,
      slug: t.slug,
    },
    columns,
  })
})
