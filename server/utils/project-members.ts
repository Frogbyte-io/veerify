import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectMember, type ProjectMemberRole } from '~/server/database/schema/feedback'
import { getOrganizationRole, isOrganizationAdminRole, type ProjectRow } from './project-access'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Validates that `userId` is a non-admin member of the project's organization
 * (owners/admins already administer every project and never need a row).
 */
export async function requireAssignableUser(proj: ProjectRow, userId: string) {
  const orgRole = await getOrganizationRole(proj.organizationId, userId)
  if (!orgRole) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'User is not a member of this workspace'),
    })
  }
  if (isOrganizationAdminRole(orgRole)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'Workspace owners and admins already administer every project'),
    })
  }
}

/** Creates or updates the explicit project membership. */
export async function upsertProjectMember(projectId: string, userId: string, role: ProjectMemberRole) {
  await db
    .insert(projectMember)
    .values({ id: randomUUID(), projectId, userId, role, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [projectMember.projectId, projectMember.userId],
      set: { role },
    })
}

export async function deleteProjectMember(projectId: string, userId: string) {
  const removed = await db
    .delete(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
    .returning({ id: projectMember.id })
  return removed.length > 0
}
