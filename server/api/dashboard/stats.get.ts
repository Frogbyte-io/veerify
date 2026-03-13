import { eq, count, desc, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project, feedback } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session, activeTeam } = await requireAuthWithResolvedTeam(event)

  // Get all projects for the active team
  const projects = await db
    .select({ id: project.id, name: project.name, slug: project.slug, isPublic: project.isPublic })
    .from(project)
    .where(eq(project.teamId, activeTeam.id))

  const projectIds = projects.map((p) => p.id)

  // Count team members
  const [memberCountResult] = await db
    .select({ count: count() })
    .from(teamMember)
    .where(eq(teamMember.teamId, activeTeam.id))

  const memberCount = memberCountResult?.count ?? 0

  if (projectIds.length === 0) {
    return createSuccessResponse({
      totalFeedback: 0,
      openFeedback: 0,
      inProgressFeedback: 0,
      completedFeedback: 0,
      projectCount: 0,
      memberCount,
      recentFeedback: [],
    })
  }

  // Count feedback by status
  const feedbackCounts = await db
    .select({ status: feedback.status, count: count() })
    .from(feedback)
    .where(inArray(feedback.projectId, projectIds))
    .groupBy(feedback.status)

  const statusMap: Record<string, number> = {}
  let totalFeedback = 0
  for (const row of feedbackCounts) {
    statusMap[row.status] = row.count
    totalFeedback += row.count
  }

  // Recent feedback across all team projects
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

  const recentRows = await db
    .select({
      id: feedback.id,
      title: feedback.title,
      status: feedback.status,
      voteCount: feedback.voteCount,
      projectId: feedback.projectId,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .where(inArray(feedback.projectId, projectIds))
    .orderBy(desc(feedback.createdAt))
    .limit(8)

  const recentFeedback = recentRows.map((row) => ({
    ...row,
    projectName: projectMap[row.projectId]?.name ?? null,
    projectSlug: projectMap[row.projectId]?.slug ?? null,
  }))

  return createSuccessResponse({
    totalFeedback,
    openFeedback: statusMap['open'] ?? 0,
    inProgressFeedback: (statusMap['in_progress'] ?? 0) + (statusMap['planned'] ?? 0),
    completedFeedback: statusMap['completed'] ?? 0,
    projectCount: projects.length,
    memberCount,
    recentFeedback,
  })
})
