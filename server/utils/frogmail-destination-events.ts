import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { mailForwardDestination } from '~/server/database/schema/support'

const DESTINATION_EVENT_STATUS: Record<string, 'verified' | 'revoked' | 'suspended'> = {
  'forward_destination.verified': 'verified',
  'forward_destination.revoked': 'revoked',
  'forward_destination.suspended': 'suspended',
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Applies a native `forward_destination.*` webhook to the matching row (by `frogmailDestinationId`). Unknown
 * event types and ids are a no-op (returns false).
 */
export async function applyForwardDestinationEvent(payload: unknown, now = new Date()): Promise<boolean> {
  if (!payload || typeof payload !== 'object') return false
  const body = payload as { type?: unknown; data?: unknown }
  const status = typeof body.type === 'string' ? DESTINATION_EVENT_STATUS[body.type] : undefined
  if (!status || !body.data || typeof body.data !== 'object') return false

  const data = body.data as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id.trim() : ''
  if (!id) return false

  const reason = typeof data.status_reason === 'string' && data.status_reason ? data.status_reason : null
  const verifiedAt = toDate(data.verified_at)
  const updated = await db
    .update(mailForwardDestination)
    .set({
      status,
      statusReason: status === 'verified' ? null : reason,
      ...(verifiedAt ? { verifiedAt } : status === 'verified' ? { verifiedAt: now } : {}),
      lastEventAt: now,
      updatedAt: now,
    })
    .where(eq(mailForwardDestination.frogmailDestinationId, id))
    .returning({ id: mailForwardDestination.id })
  return updated.length > 0
}

/** Stamps `last_event_at` for a forward delivery event (Mailgun webhook, tag `frogmail-forward`). */
export async function touchForwardDestination(frogmailDestinationId: string, at: Date = new Date()): Promise<void> {
  await db
    .update(mailForwardDestination)
    .set({ lastEventAt: at })
    .where(eq(mailForwardDestination.frogmailDestinationId, frogmailDestinationId))
}
