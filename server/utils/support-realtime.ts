import { conversationChannel, inboxChannel, publishRealtime } from '~/server/services/realtime'

/**
 * Every conversation-domain write publishes on both `conversation:<id>` (the
 * thread pane, open on this one ticket) and `inbox:<id>` (the list pane,
 * showing every ticket in the inbox) - see `design.md` → Stage 02 →
 * Realtime. One envelope, two channel-scoped publishes: `envelopeMatchesChannel`
 * checks the envelope's own ids against each channel independently, so the
 * same envelope (carrying both `inboxId` and `conversationId`) legitimately
 * matches both.
 */
export interface ConversationEventInput {
  type: string
  teamId: string
  inboxId: string
  conversationId: string
  messageId?: string
}

export async function publishConversationEvent(input: ConversationEventInput): Promise<void> {
  const envelope = {
    type: input.type,
    teamId: input.teamId,
    inboxId: input.inboxId,
    conversationId: input.conversationId,
    ...(input.messageId ? { messageId: input.messageId } : {}),
  }

  await Promise.all([
    publishRealtime(conversationChannel(input.conversationId), envelope),
    publishRealtime(inboxChannel(input.inboxId), envelope),
  ])
}
