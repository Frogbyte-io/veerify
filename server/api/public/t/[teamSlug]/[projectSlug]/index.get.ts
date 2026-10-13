import { and, eq, count } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { testimonial } from '~/server/database/schema/marketing'
import { isModuleEnabledForProject } from '~/server/utils/public-modules'

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const { team: t, project: proj } = await resolvePublicProjectByTeam(teamSlug!, projectSlug!)

  const [feedbackCount] = await db.select({ count: count() }).from(feedback).where(eq(feedback.projectId, proj.id))

  const categories = await db
    .select()
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, proj.id))
    .orderBy(feedbackCategory.sortOrder)

  const statusCounts = await db
    .select({ status: feedback.status, count: count() })
    .from(feedback)
    .where(eq(feedback.projectId, proj.id))
    .groupBy(feedback.status)

  const statusMap: Record<string, number> = {}
  for (const s of statusCounts) {
    statusMap[s.status] = s.count
  }

  // Drives the "Testimonials" tab: Marketing on (team + product) and at least one
  // approved, publicly consented testimonial. A single LIMIT 1 probe.
  let hasTestimonials = false
  if (await isModuleEnabledForProject(t.id, proj.settings as Record<string, unknown> | null, 'marketingEnabled')) {
    const [visible] = await db
      .select({ id: testimonial.id })
      .from(testimonial)
      .where(
        and(eq(testimonial.projectId, proj.id), eq(testimonial.status, 'approved'), eq(testimonial.consentPublic, true))
      )
      .limit(1)
    hasTestimonials = Boolean(visible)
  }

  return createSuccessResponse({
    hasTestimonials,
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
    categories,
    stats: {
      total: feedbackCount?.count || 0,
      open: statusMap.open || 0,
      inProgress: statusMap.in_progress || 0,
      planned: statusMap.planned || 0,
      completed: statusMap.completed || 0,
    },
  })
})
