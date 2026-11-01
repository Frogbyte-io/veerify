import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { member, organization } from '~/server/database/schema/auth'
import { feedback, product, project } from '~/server/database/schema/feedback'
import { notification } from '~/server/database/schema/notifications'
import type { AuthSession } from '~/server/utils/auth-middleware'
import { resolveActiveProjectForSession, resolveProjectScope } from '~/server/utils/project-context'
import { listAccessibleProjects } from '~/server/utils/project-access'
import {
  buildActiveProjectContext,
  listProjectMembers,
  toScopeProjects,
  type ActiveProjectContext,
  type ScopeProject,
} from '~/server/utils/project-summary'

export const emptyWorkspaceStats = {
  totalFeedback: 0,
  openFeedback: 0,
  inProgressFeedback: 0,
  completedFeedback: 0,
  productCount: 0,
  memberCount: 0,
  recentFeedback: [],
}

export async function listOrganizationsForUser(userId: string) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name), asc(organization.id))
}

export async function getWorkspaceStatsForProject(projectId: string) {
  const [projectRows, members, feedbackCounts, recentRows] = await Promise.all([
    db.select().from(project).where(eq(project.id, projectId)).limit(1),
    db.select({ count: count() }).from(product).where(eq(product.projectId, projectId)),
    db
      .select({ status: feedback.status, count: count() })
      .from(feedback)
      .where(eq(feedback.projectId, projectId))
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
        productId: feedback.productId,
        productName: product.name,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .innerJoin(project, eq(feedback.projectId, project.id))
      .innerJoin(product, eq(feedback.productId, product.id))
      .where(eq(feedback.projectId, projectId))
      .orderBy(desc(feedback.createdAt))
      .limit(8),
  ])

  const statusMap: Record<string, number> = {}
  let totalFeedback = 0
  for (const row of feedbackCounts) {
    statusMap[row.status] = row.count
    totalFeedback += row.count
  }

  const proj = projectRows[0]
  const memberCount = proj ? (await listProjectMembers(proj)).length : 0

  return {
    totalFeedback,
    openFeedback: statusMap.open ?? 0,
    inProgressFeedback: (statusMap.in_progress ?? 0) + (statusMap.planned ?? 0),
    completedFeedback: statusMap.completed ?? 0,
    productCount: members[0]?.count ?? 0,
    memberCount,
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

export type DashboardProjectContext = {
  organizations: Awaited<ReturnType<typeof listOrganizationsForUser>>
  activeOrganization: typeof organization.$inferSelect | null
  projects: ScopeProject[]
  activeProject: ActiveProjectContext | null
}

export async function getDashboardBootstrapData(session: AuthSession) {
  const organizations = await listOrganizationsForUser(session.user.id)
  const activeProject = organizations.length > 0 ? await resolveActiveProjectForSession(session) : null

  // With no project yet, fall back to the session's organization (or the first one) so onboarding
  // can show the workspace the first project will be created in.
  const activeOrganizationId =
    activeProject?.organizationId ??
    organizations.find((org) => org.id === session.session.activeOrganizationId)?.id ??
    organizations[0]?.id ??
    null

  const [activeOrganizationRows, accessibleProjects, activeContext, workspaceStats, personalSummary, unreadCount] =
    await Promise.all([
      activeOrganizationId
        ? db.select().from(organization).where(eq(organization.id, activeOrganizationId)).limit(1)
        : Promise.resolve([]),
      activeOrganizationId ? listAccessibleProjects(activeOrganizationId, session.user.id) : Promise.resolve([]),
      activeProject
        ? resolveProjectScope(session, activeProject).then(({ scope }) =>
            buildActiveProjectContext(activeProject, session.user.id, scope)
          )
        : Promise.resolve(null),
      activeProject ? getWorkspaceStatsForProject(activeProject.id) : Promise.resolve(null),
      activeProject ? Promise.resolve(null) : getPersonalDashboardSummary(session.user.id),
      getUnreadNotificationCount(session.user.id),
    ])

  const projectContext: DashboardProjectContext = {
    organizations,
    activeOrganization: activeOrganizationRows[0] ?? null,
    projects: activeOrganizationId ? await toScopeProjects(activeOrganizationId, accessibleProjects) : [],
    activeProject: activeContext,
  }

  return {
    session,
    projectContext,
    workspace: activeProject
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
