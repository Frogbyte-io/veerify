import { and, asc, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { session as sessionTable, team, teamMember } from '~/server/database/schema/auth'
import { createErrorResponse, ErrorCode } from './response'
import type { AuthSession } from './auth-middleware'

export const DEFAULT_TEAM_NAME = 'Default'

export async function setActiveTeamAndOrganization(params: {
  sessionToken: string
  userId: string
  teamId: string
}) {
  const [selectedTeam] = await db.select().from(team).where(eq(team.id, params.teamId)).limit(1)
  if (!selectedTeam) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Team not found'),
    })
  }

  const [membership] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, selectedTeam.id), eq(teamMember.userId, params.userId)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this team'),
    })
  }

  await db
    .update(sessionTable)
    .set({
      activeTeamId: selectedTeam.id,
      activeOrganizationId: selectedTeam.organizationId,
    })
    .where(eq(sessionTable.token, params.sessionToken))

  return selectedTeam
}

async function getValidActiveTeam(session: AuthSession) {
  if (!session.session.activeTeamId) {
    return null
  }

  const [result] = await db
    .select({ team })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(and(eq(teamMember.teamId, session.session.activeTeamId), eq(teamMember.userId, session.user.id)))
    .limit(1)

  return result?.team ?? null
}

async function getDefaultTeamForActiveOrganization(session: AuthSession) {
  if (!session.session.activeOrganizationId) {
    return null
  }

  const [result] = await db
    .select({ team })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(
      and(
        eq(teamMember.userId, session.user.id),
        eq(team.organizationId, session.session.activeOrganizationId),
        eq(team.name, DEFAULT_TEAM_NAME)
      )
    )
    .limit(1)

  return result?.team ?? null
}

async function getFirstTeamForUser(session: AuthSession) {
  const [result] = await db
    .select({ team })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(eq(teamMember.userId, session.user.id))
    .orderBy(asc(team.createdAt), asc(team.id))
    .limit(1)

  return result?.team ?? null
}

export async function resolveActiveTeamForSession(session: AuthSession) {
  const active = await getValidActiveTeam(session)
  if (active) {
    if (session.session.activeOrganizationId !== active.organizationId) {
      await db
        .update(sessionTable)
        .set({ activeOrganizationId: active.organizationId })
        .where(eq(sessionTable.token, session.session.token))
    }
    return active
  }

  const defaultTeam = await getDefaultTeamForActiveOrganization(session)
  if (defaultTeam) {
    await setActiveTeamAndOrganization({
      sessionToken: session.session.token,
      userId: session.user.id,
      teamId: defaultTeam.id,
    })
    return defaultTeam
  }

  const firstTeam = await getFirstTeamForUser(session)
  if (firstTeam) {
    await setActiveTeamAndOrganization({
      sessionToken: session.session.token,
      userId: session.user.id,
      teamId: firstTeam.id,
    })
    return firstTeam
  }

  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: createErrorResponse(
      ErrorCode.CONFLICT,
      'No team membership found. Join or create a team to continue.'
    ),
  })
}

export async function requireAuthWithResolvedTeam(event: H3Event) {
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: createErrorResponse(ErrorCode.UNAUTHORIZED, 'Authentication required'),
    })
  }

  const typedSession = session as AuthSession
  const activeTeam = await resolveActiveTeamForSession(typedSession)

  return {
    session: typedSession,
    activeTeam,
  }
}
