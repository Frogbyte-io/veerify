import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, eq, gte, lte, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  contact,
  conversation,
  conversationMessage,
  csatResponse,
  csatSurvey,
  supportInbox,
} from '~/server/database/schema/support'
import { enqueueOutboundDelivery } from '~/server/utils/outbound-delivery'
import { publishConversationEvent } from '~/server/utils/support-realtime'

export const DEFAULT_CSAT_CONTACT_COOLDOWN_MINUTES = 43_200

export type CsatDispatchResult = {
  scanned: number
  sent: number
  skipped: number
}

export function csatRatings(scale: 'csat_5' | 'thumbs' | 'nps_10'): number[] {
  if (scale === 'thumbs') return [1, 2]
  if (scale === 'nps_10') return Array.from({ length: 11 }, (_, index) => index)
  return [1, 2, 3, 4, 5]
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character
  )
}

function csatPublicBaseUrl(): string {
  const configured = process.env.NUXT_PUBLIC_SITE_URL || process.env.APP_URL || process.env.SITE_URL || ''
  return configured.replace(/\/$/, '')
}

export function csatRatingUrl(token: string, rating: number): string {
  const path = `/support/csat/${encodeURIComponent(token)}?rating=${encodeURIComponent(String(rating))}`
  return `${csatPublicBaseUrl()}${path}`
}

export function buildCsatSurveyEmail(input: {
  scale: 'csat_5' | 'thumbs' | 'nps_10'
  question: string
  followUpQuestion?: string | null
  token: string
  contactName?: string | null
}): { subject: string; html: string; text: string } {
  const greeting = input.contactName ? `Hi ${input.contactName},` : 'Hi,'
  const labels = input.scale === 'thumbs' ? ['Not helpful', 'Helpful'] : csatRatings(input.scale).map(String)
  const links = csatRatings(input.scale).map((rating, index) => ({
    rating,
    label: labels[index],
    url: csatRatingUrl(input.token, rating),
  }))
  const htmlLinks = links
    .map(
      ({ label, url }) =>
        `<a href="${escapeHtml(url)}" style="display:inline-block;margin:4px;padding:10px 14px;border:1px solid #d0d7de;border-radius:6px;color:#17202a;text-decoration:none">${escapeHtml(label)}</a>`
    )
    .join('')
  const textLinks = links.map(({ label, url }) => `${label}: ${url}`).join('\n')
  const question = escapeHtml(input.question)
  const followUp = input.followUpQuestion ? `<p>${escapeHtml(input.followUpQuestion)}</p>` : ''

  return {
    subject: 'How did we do?',
    html: `<p>${escapeHtml(greeting)}</p><p>${question}</p><p>${htmlLinks}</p>${followUp}<p>Thanks for helping us improve.</p>`,
    text: `${greeting}\n\n${input.question}\n\n${textLinks}\n\n${input.followUpQuestion ?? ''}\nThanks for helping us improve.`,
  }
}

function hasCsatOptedOut(attributes: Record<string, unknown> | null | undefined): boolean {
  if (!attributes) return false
  return attributes.csatOptOut === true || attributes.csat_opt_out === true
}

function surveyEventAt(row: {
  sendTrigger: 'on_resolve' | 'on_close'
  resolvedAt: Date | null
  updatedAt: Date
}): Date {
  return row.sendTrigger === 'on_resolve' ? (row.resolvedAt ?? row.updatedAt) : row.updatedAt
}

type CsatCandidate = {
  survey: typeof csatSurvey.$inferSelect
  conversation: typeof conversation.$inferSelect
  contact: typeof contact.$inferSelect
  inbox: typeof supportInbox.$inferSelect
}

async function hasAgentReply(conversationId: string): Promise<boolean> {
  const [reply] = await db
    .select({ id: conversationMessage.id })
    .from(conversationMessage)
    .where(
      and(
        eq(conversationMessage.conversationId, conversationId),
        eq(conversationMessage.kind, 'outgoing'),
        eq(conversationMessage.senderKind, 'agent')
      )
    )
    .limit(1)
  return Boolean(reply)
}

async function contactWasRecentlySurveyed(contactId: string, cooldownMinutes: number, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - cooldownMinutes * 60_000)
  const [recent] = await db
    .select({ id: csatResponse.id })
    .from(csatResponse)
    .where(and(eq(csatResponse.contactId, contactId), gte(csatResponse.sentAt, cutoff)))
    .limit(1)
  return Boolean(recent)
}

async function dispatchCandidate(candidate: CsatCandidate, now: Date): Promise<boolean> {
  if (!candidate.contact.email || !candidate.inbox.emailAddress) return false
  const recipient = candidate.contact.email
  const senderAddress = candidate.inbox.emailAddress
  if (hasCsatOptedOut(candidate.contact.attributes)) return false
  if (!(await hasAgentReply(candidate.conversation.id))) return false

  const cooldown = candidate.survey.contactCooldownMinutes ?? DEFAULT_CSAT_CONTACT_COOLDOWN_MINUTES
  if (await contactWasRecentlySurveyed(candidate.contact.id, cooldown, now)) return false

  const responseId = randomUUID()
  const messageId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const email = buildCsatSurveyEmail({
    scale: candidate.survey.scale,
    question: candidate.survey.question,
    followUpQuestion: candidate.survey.followUpQuestion,
    token,
    contactName: candidate.contact.name,
  })
  const created = await db.transaction(async (tx) => {
    const [response] = await tx
      .insert(csatResponse)
      .values({
        id: responseId,
        surveyId: candidate.survey.id,
        conversationId: candidate.conversation.id,
        contactId: candidate.contact.id,
        agentUserId: candidate.conversation.assigneeUserId,
        token,
        sentAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: csatResponse.conversationId })
      .returning({ id: csatResponse.id })
    if (!response) return false

    await tx.insert(conversationMessage).values({
      id: messageId,
      conversationId: candidate.conversation.id,
      kind: 'outgoing',
      body: email.text,
      bodyHtml: email.html,
      senderKind: 'system',
      senderContactId: null,
      senderUserId: null,
      isPrivate: false,
      deliveryStatus: 'pending',
      metadata: { type: 'csat_survey', surveyId: candidate.survey.id, responseId },
      createdAt: now,
    })
    await enqueueOutboundDelivery(tx, {
      messageId,
      kind: 'csat',
      idempotencyKey: `csat:${responseId}`,
      payload: {
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        from: { address: senderAddress, name: candidate.inbox.fromName ?? undefined },
      },
    })
    return true
  })

  if (created) {
    await publishConversationEvent({
      type: 'message.created',
      teamId: candidate.conversation.teamId,
      inboxId: candidate.conversation.inboxId,
      conversationId: candidate.conversation.id,
      messageId,
    })
  }
  return created
}

/**
 * Run one bounded CSAT dispatch pass. Candidate selection is deliberately
 * read-only until `dispatchCandidate` claims the conversation through the
 * unique response index, so overlapping scheduler invocations are safe.
 */
export async function runCsatDispatchSweep(input: { now?: Date; limit?: number } = {}): Promise<CsatDispatchResult> {
  const now = input.now ?? new Date()
  const limit = input.limit ?? 250
  const surveys = await db
    .select()
    .from(csatSurvey)
    .where(eq(csatSurvey.isEnabled, true))
    .orderBy(asc(csatSurvey.createdAt), asc(csatSurvey.id))

  let scanned = 0
  let sent = 0
  let skipped = 0
  for (const survey of surveys) {
    if (scanned >= limit) break
    const status = survey.sendTrigger === 'on_resolve' ? 'resolved' : 'closed'
    const candidates = await db
      .select({ conversation, contact, inbox: supportInbox })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .innerJoin(supportInbox, eq(supportInbox.id, conversation.inboxId))
      .where(
        and(
          eq(conversation.teamId, survey.teamId),
          eq(conversation.status, status),
          survey.inboxId ? eq(conversation.inboxId, survey.inboxId) : undefined,
          or(lte(conversation.updatedAt, now), lte(conversation.resolvedAt, now))
        )
      )
      .orderBy(asc(conversation.updatedAt), asc(conversation.id))
      .limit(limit - scanned)

    for (const candidate of candidates) {
      scanned += 1
      const eventAt = surveyEventAt({
        sendTrigger: survey.sendTrigger,
        resolvedAt: candidate.conversation.resolvedAt,
        updatedAt: candidate.conversation.updatedAt,
      })
      const dueAt = new Date(eventAt.getTime() + survey.delayMinutes * 60_000)
      if (dueAt > now) {
        skipped += 1
        continue
      }
      const didSend = await dispatchCandidate({ survey, ...candidate }, now)
      if (didSend) sent += 1
      else skipped += 1
    }
  }
  return { scanned, sent, skipped }
}
