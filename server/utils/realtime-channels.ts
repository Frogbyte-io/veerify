import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamMember } from '~/server/database/schema/auth'
import { parseChannel } from '~/server/services/realtime'

/**
 * Subscribe-time authorization for realtime channels.
 *
 * Authorization happens when a peer asks to join a channel, not when an event is
 * published. Checking at publish time would mean every event carries the cost of
 * a permission lookup, and worse, a missed check would leak to everyone already
 * listening. Checking at subscribe time fails closed once, cheaply.
 */

export type ChannelAuthResult = { allowed: true } | { allowed: false; reason: string }

const ALLOW: ChannelAuthResult = { allowed: true }

function deny(reason: string): ChannelAuthResult {
  return { allowed: false, reason }
}

export interface ChannelAuthDeps {
  isTeamMember(teamId: string, userId: string): Promise<boolean>
}

/**
 * Pure authorization logic with its dependencies injected, so the deny paths can
 * be tested without a database.
 */
export async function authorizeChannelWith(
  channel: string,
  userId: string,
  deps: ChannelAuthDeps
): Promise<ChannelAuthResult> {
  if (!userId) return deny('Not authenticated')

  const parsed = parseChannel(channel)
  if (!parsed) return deny('Unknown channel')

  switch (parsed.scope) {
    case 'user':
      // A peer may only ever listen to its own user channel.
      return parsed.id === userId ? ALLOW : deny('Forbidden')

    case 'team':
      return (await deps.isTeamMember(parsed.id, userId)) ? ALLOW : deny('Forbidden')

    case 'inbox':
    case 'conversation':
      // Stage 02 seam. `supportInbox` and `conversation` do not exist yet, so
      // there is nothing to authorize against. Fail closed rather than allow —
      // Stage 02 replaces this branch with a `requireInboxAccess` /
      // `requireConversationAccess` lookup.
      return deny('Support channels are not available yet')

    default:
      return deny('Unknown channel')
  }
}

async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1)

  return Boolean(row)
}

/** Authorize a peer's subscription request against the database. */
export function authorizeChannel(channel: string, userId: string): Promise<ChannelAuthResult> {
  return authorizeChannelWith(channel, userId, { isTeamMember })
}
