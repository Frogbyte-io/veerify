/**
 * The workspace and project (or All projects) a user worked in last, kept on `user.settings.lastContext`
 * so a new sign-in starts there. Written on every explicit switch from a browser session
 * (server/utils/project-context.ts); API keys keep their own context and never touch it.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { logger } from '~/server/utils/logger'

export type LastContext = {
  organizationId: string
  projectId: string | null
  scope: 'project' | 'all'
}

type Executor = Pick<typeof db, 'update'>

export async function rememberLastContext(userId: string, context: LastContext, tx: Executor = db) {
  await tx
    .update(user)
    .set({
      settings: sql`coalesce(${user.settings}, '{}'::jsonb) || jsonb_build_object('lastContext', ${JSON.stringify(context)}::jsonb)`,
    })
    .where(eq(user.id, userId))
}

function readLastContext(settings: unknown): LastContext | null {
  const value = (settings as { lastContext?: Partial<LastContext> } | null)?.lastContext
  if (!value || typeof value.organizationId !== 'string' || !value.organizationId) return null
  return {
    organizationId: value.organizationId,
    projectId: typeof value.projectId === 'string' && value.projectId ? value.projectId : null,
    scope: value.scope === 'all' ? 'all' : 'project',
  }
}

/**
 * Better-Auth `session.create.before` hook: fills the new session's context from the user's last one.
 * Leaves sessions that already carry a context alone. Never blocks sign-in: failures are logged.
 */
export async function restoreLastContext<
  T extends { userId: string; activeOrganizationId?: string | null; activeProjectId?: string | null },
>(newSession: T): Promise<(T & { activeProjectScope: string | null }) | null> {
  if (newSession.activeOrganizationId || newSession.activeProjectId) return null
  try {
    const [row] = await db.select({ settings: user.settings }).from(user).where(eq(user.id, newSession.userId)).limit(1)
    const last = readLastContext(row?.settings)
    if (!last) return null
    return {
      ...newSession,
      activeOrganizationId: last.organizationId,
      activeProjectId: last.projectId,
      activeProjectScope: last.scope === 'all' ? 'all' : null,
    }
  } catch (error) {
    logger.warn('Failed to restore last context for new session', {
      userId: newSession.userId,
      error: error instanceof Error ? error.message : error,
    })
    return null
  }
}
