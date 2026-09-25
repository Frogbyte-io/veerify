import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { organization, team, teamMember } from '~/server/database/schema/auth'
import { feedback, project } from '~/server/database/schema/feedback'
import { notification } from '~/server/database/schema/notifications'
import type { AuthSession } from '~/server/utils/auth-middleware'
import { resolveActiveTeamForSession } from '~/server/utils/team-context'

export const emptyWorkspaceStats = {
  totalFeedback: 0,
  openFeedback: 0,
  inProgressFeedback: 0,
  completedFeedback: 0,
  projectCount: 0,
  memberCount: 0,
  recentFeedback: [],
}

export async function listTeamsForUser(userId: string) {
  return db
    .select({
      id: team.id,
      name: team.name,
      slug: team.slug,
      organizationId: team.organizationId,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      role: teamMember.role,
    })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(eq(teamMember.userId, userId))
    .orderBy(asc(team.createdAt), asc(team.id))
}

export async function getWorkspaceStatsForTeam(teamId: string) {
  const [projectCountRows, memberCountRows, feedbackCounts, recentRows] = await Promise.all([
    db.select({ count: count() }).from(project).where(eq(project.teamId, teamId)),
    db.select({ count: count() }).from(teamMember).where(eq(teamMember.teamId, teamId)),
    db
      .select({ status: feedback.status, count: count() })
      .from(feedback)
      .innerJoin(project, eq(feedback.projectId, project.id))
      .where(eq(project.teamId, teamId))
      .groupBy(feedback.status),
    db
      .select({
        id: feedback.id,
        title: feedback.title,
        status: feedback.status,
        voteCount: feedback.voteCount,
        projectId: feedback.projectId,
        projectName: project.name,
        projectSlug: project.slug,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .innerJoin(project, eq(feedback.projectId, project.id))
      .where(eq(project.teamId, teamId))
      .orderBy(desc(feedback.createdAt))
      .limit(8),
  ])

  const statusMap: Record<string, number> = {}
  let totalFeedback = 0
  for (const row of feedbackCounts) {
    statusMap[row.status] = row.count
    totalFeedback += row.count
  }

  return {
    totalFeedback,
    openFeedback: statusMap.open ?? 0,
    inProgressFeedback: (statusMap.in_progress ?? 0) + (statusMap.planned ?? 0),
    completedFeedback: statusMap.completed ?? 0,
    projectCount: projectCountRows[0]?.count ?? 0,
    memberCount: memberCountRows[0]?.count ?? 0,
    recentFeedback: recentRows,
  }
}

export async function getPersonalDashboardSummary(userId: string) {
  const [recentSubmissions, totalsRows] = await Promise.all([
    db
      .select({
        id: feedback.id,
        title: feedback.title,
        body: feedback.body,
        status: feedback.status,
        voteCount: feedback.voteCount,
        commentCount: feedback.commentCount,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
        projectId: feedback.projectId,
        projectName: project.name,
        projectSlug: project.slug,
      })
      .from(feedback)
      .leftJoin(project, eq(feedback.projectId, project.id))
      .where(eq(feedback.authorUserId, userId))
      .orderBy(desc(feedback.createdAt))
      .limit(5),
    db
      .select({
        submissionCount: sql<number>`count(*)::int`,
        completedCount: sql<number>`count(*) filter (where ${feedback.status} = 'completed')::int`,
        totalVotes: sql<number>`coalesce(sum(${feedback.voteCount}), 0)::int`,
      })
      .from(feedback)
      .where(eq(feedback.authorUserId, userId)),
  ])

  const totals = totalsRows[0]

  return {
    recentSubmissions,
    submissionCount: totals?.submissionCount ?? 0,
    completedCount: totals?.completedCount ?? 0,
    totalVotes: totals?.totalVotes ?? 0,
  }
}

export async function getUnreadNotificationCount(userId: string) {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.userId, userId), eq(notification.isRead, false)))

  return result?.count ?? 0
}

export async function getDashboardBootstrapData(session: AuthSession) {
  const teams = await listTeamsForUser(session.user.id)
  const hasWorkspace = teams.length > 0
  const activeTeam = hasWorkspace ? await resolveActiveTeamForSession(session) : null

  const [activeOrganization, workspaceStats, personalSummary, unreadCount] = await Promise.all([
    activeTeam
      ? db.select().from(organization).where(eq(organization.id, activeTeam.organizationId)).limit(1)
      : Promise.resolve([]),
    activeTeam ? getWorkspaceStatsForTeam(activeTeam.id) : Promise.resolve(null),
    activeTeam ? Promise.resolve(null) : getPersonalDashboardSummary(session.user.id),
    getUnreadNotificationCount(session.user.id),
  ])

  return {
    session,
    teamContext: {
      teams,
      activeTeam,
      activeOrganization: activeOrganization[0] ?? null,
    },
    workspace: activeTeam
      ? {
          stats: workspaceStats ?? emptyWorkspaceStats,
        }
      : null,
    personal: personalSummary,
    notifications: {
      unreadCount,
    },
  }
}
