import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { hasProjectAccess } from './project-access'
import { parseChannel } from '~/server/services/realtime'
import { requireConversationAccess, requireInboxAccess } from '~/server/utils/support-access'

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
  hasProjectAccess(projectId: string, userId: string): Promise<boolean>
  canAccessInbox(inboxId: string, userId: string): Promise<boolean>
  canAccessConversation(conversationId: string, userId: string): Promise<boolean>
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

    case 'project':
      return (await deps.hasProjectAccess(parsed.id, userId)) ? ALLOW : deny('Forbidden')

    case 'inbox':
      return (await deps.canAccessInbox(parsed.id, userId)) ? ALLOW : deny('Forbidden')

    case 'conversation':
      return (await deps.canAccessConversation(parsed.id, userId)) ? ALLOW : deny('Forbidden')

    default:
      return deny('Unknown channel')
  }
}

// `requireInboxAccess` / `requireConversationAccess` throw 404/403 to carry
// API-facing detail. That distinction is not useful at subscribe time — a
// peer that cannot see an inbox and a peer whose inbox does not exist should
// both simply fail to join the channel — so both outcomes collapse to false.
async function canAccessInbox(inboxId: string, userId: string): Promise<boolean> {
  try {
    await requireInboxAccess(inboxId, userId)
    return true
  } catch {
    return false
  }
}

async function canAccessConversation(conversationId: string, userId: string): Promise<boolean> {
  try {
    await requireConversationAccess(conversationId, userId)
    return true
  } catch {
    return false
  }
}

/** Authorize a peer's subscription request against the database. */
export function authorizeChannel(channel: string, userId: string): Promise<ChannelAuthResult> {
  return authorizeChannelWith(channel, userId, { hasProjectAccess, canAccessInbox, canAccessConversation })
}
