import { buildOutgoingReply, type OutgoingReplyInput, type OutgoingReplyResult } from '~/server/utils/outbound-reply'

/**
 * Auto-reply composition (SUP-04-8).
 *
 * Four guards, all required before this ever runs:
 *
 * 1. Never on a message Stage 03's `isAutoResponse` flagged - enforced by the
 *    caller's control flow (`server/api/support/inbound/[provider].post.ts`
 *    returns before reaching this code for a flagged message), not repeated
 *    here.
 * 2. Only when the inbound message opened a NEW conversation - `shouldSendAutoReply`.
 * 3. Never more than once per conversation - satisfied *structurally* by (2):
 *    the only way this runs is the "new conversation" branch, which by
 *    definition happens at most once per conversation. Guard 3 is a
 *    consequence of guard 2's implementation, not a separate check.
 * 4. `Auto-Submitted: auto-replied` on the outgoing message - `buildAutoReply`.
 *
 * The fifth requirement, per-contact rate limiting, is not pure (it needs the
 * rate-limit store) and lives in the endpoint, not here. Only the policy
 * numbers are exported from this file.
 */

/** At most one auto-reply per contact per window - a burst of separate first-contact emails must not become a burst of replies. */
export const AUTO_REPLY_RATE_LIMIT_MAX = 1
export const AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS = 60 * 60

/**
 * Guard 2 plus the mail-address rules: never for a conversation started on a
 * `mail` address, and never for a message the provider flagged as spam
 * (replying to spam confirms the address to the spammer and can backscatter
 * to a forged sender).
 */
export function shouldSendAutoReply(input: {
  isNewConversation: boolean
  autoReplyEnabled: boolean
  autoReplyTemplate: string | null
  /** The new conversation's behaviour (from the receiving address). Default `helpdesk`. */
  behaviour?: string
  /** The provider's spam verdict for the inbound message. */
  isSpam?: boolean
}): boolean {
  if (input.behaviour === 'mail' || input.isSpam) return false
  return input.isNewConversation && input.autoReplyEnabled && Boolean(input.autoReplyTemplate?.trim())
}

export type AutoReplyInput = Omit<OutgoingReplyInput, 'agentBody' | 'agentBodyHtml' | 'attachments' | 'cc'> & {
  template: string
}

/**
 * Compose the auto-reply, reusing `buildOutgoingReply` exactly as an agent
 * reply does (threading, quoting, signature) - the acknowledgment is a real
 * reply, not a special-cased send path - then layers on `Auto-Submitted`,
 * which nothing else needs.
 *
 * No cc and no attachments: `design.md` describes the auto-reply as sending
 * "the configured template" to the customer, nothing more.
 */
export function buildAutoReply(input: AutoReplyInput): OutgoingReplyResult {
  const outgoing = buildOutgoingReply({
    ...input,
    cc: [],
    agentBody: input.template,
    agentBodyHtml: null,
    attachments: [],
  })

  return {
    ...outgoing,
    deliveryPayload: {
      ...outgoing.deliveryPayload,
      headers: { ...outgoing.deliveryPayload.headers, 'Auto-Submitted': 'auto-replied' },
    },
  }
}
