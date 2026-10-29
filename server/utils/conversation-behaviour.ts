/**
 * Which conversations the helpdesk machinery (auto-reply, SLA, CSAT, automation
 * rules) acts on. Conversations started on a `mail` address, and conversations
 * in the Spam or Trash folder, are left alone. See
 * docs/plans/2026-10-28-email-addresses/design.md → Naming: Inbox.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { conversation } from '~/server/database/schema/support'

export interface ConversationBehaviourState {
  behaviour: string | null | undefined
  spamAt: Date | null | undefined
  deletedAt: Date | null | undefined
}

/** True when auto-reply, SLA, CSAT and automation rules apply to the conversation. */
export function helpdeskAppliesTo(state: ConversationBehaviourState): boolean {
  return state.behaviour !== 'mail' && !state.spamAt && !state.deletedAt
}

/** SQL form of `helpdeskAppliesTo` for the background sweeps. */
export function helpdeskConversationFilter() {
  return and(eq(conversation.behaviour, 'helpdesk'), isNull(conversation.spamAt), isNull(conversation.deletedAt))
}
