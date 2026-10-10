import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { marketingTerm, mention } from '~/server/database/schema/marketing'
import {
  contact,
  contactIdentity,
  conversation,
  conversationMessage,
  supportInbox,
} from '~/server/database/schema/support'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES } from '~/lib/modules'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireInboxAccess } from '~/server/utils/support-access'
import { allocateConversationDisplayId } from '~/server/utils/support-counter'
import { publishConversationEvent } from '~/server/utils/support-realtime'

export const ESCALATION_MARKER = 'Escalated from Marketing → Mentions'
/** Identity kind of the placeholder contact. Never an email, so no outbound mail can target it. */
export const SYSTEM_IDENTITY_KIND = 'system'
export const SYSTEM_IDENTITY_VALUE = 'veerify-marketing-mentions'
export const SYSTEM_CONTACT_NAME = 'Marketing → Mentions'

const SUBJECT_MAX = 200
const FIELD_MAX = 600

const SOURCE_LABELS: Record<string, string> = { hackernews: 'Hacker News', reddit: 'Reddit', bluesky: 'Bluesky' }

export interface EscalationMention {
  source: string
  author: string | null
  title: string | null
  excerpt: string
  url: string
  termLabel: string | null
}

/** Strip control characters and collapse whitespace so third-party text stays on one line. */
function oneLine(value: string | null | undefined, max = FIELD_MAX): string {
  const cleaned = (value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned
}

/** Only http(s) links are written into the note. */
function safeLink(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

export function buildEscalationSubject(item: EscalationMention): string {
  const label = SOURCE_LABELS[item.source] ?? oneLine(item.source, 40)
  const base = oneLine(item.title || item.excerpt, SUBJECT_MAX - label.length - 13)
  return `Mention on ${label}: ${base || 'untitled'}`
}

/**
 * Plain-text body of the internal note. Stored as `body` only (no `bodyHtml`); the support UI
 * renders notes as text, so third-party content is never interpreted as markup.
 */
export function buildEscalationNote(item: EscalationMention): string {
  return [
    ESCALATION_MARKER,
    '',
    `Source: ${SOURCE_LABELS[item.source] ?? oneLine(item.source, 40)}`,
    `Author: ${oneLine(item.author, 120) || 'unknown'}`,
    `Title: ${oneLine(item.title) || '(none)'}`,
    `Matched term: ${oneLine(item.termLabel, 120) || '(none)'}`,
    `Link: ${safeLink(item.url) || '(unavailable)'}`,
    '',
    'Excerpt:',
    oneLine(item.excerpt, 1000) || '(empty)',
  ].join('\n')
}

function httpError(
  statusCode: number,
  statusMessage: string,
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message: string
): never {
  throw createError({ statusCode, statusMessage, data: createErrorResponse(code, message) })
}

/** Support is a team-level module (no product toggle). A missing team row reads as the registry default (off). */
export async function isSupportEnabled(teamId: string) {
  const [row] = await db
    .select({ supportEnabled: teamModuleSettings.supportEnabled })
    .from(teamModuleSettings)
    .where(eq(teamModuleSettings.teamId, teamId))
    .limit(1)
  return row ? row.supportEnabled === true : DEFAULT_TEAM_MODULES.supportEnabled
}

/**
 * The inbox new escalations land in: an enabled inbox linked to this product first, then the
 * team's oldest enabled inbox, restricted to inboxes where the user can work conversations.
 */
export async function pickEscalationInbox(teamId: string, projectId: string, userId: string) {
  const inboxes = await db
    .select({ id: supportInbox.id, projectId: supportInbox.projectId })
    .from(supportInbox)
    .where(and(eq(supportInbox.teamId, teamId), eq(supportInbox.isEnabled, true)))
    .orderBy(asc(supportInbox.createdAt))

  const ordered = [
    ...inboxes.filter((i) => i.projectId === projectId),
    ...inboxes.filter((i) => i.projectId !== projectId),
  ]
  for (const candidate of ordered) {
    try {
      const access = await requireInboxAccess(candidate.id, userId)
      if (access.capabilities.canWorkConversations) return access
    } catch {
      // no access to this inbox - try the next one
    }
  }
  return null
}

/** Whether the user may escalate: support is on and they can work in at least one inbox. */
export async function canEscalateMentions(teamId: string, projectId: string, userId: string): Promise<boolean> {
  if (!(await isSupportEnabled(teamId))) return false
  return (await pickEscalationInbox(teamId, projectId, userId)) !== null
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * `conversation.contactId` is NOT NULL, so an escalation needs a contact. One shared placeholder
 * contact per team is used: no email, no phone, and a `system` identity (not an email identity).
 * Outbound mail resolves recipients from the contact's email, so nothing can be sent to it.
 */
async function ensureSystemContact(tx: Tx, teamId: string): Promise<string> {
  const find = async () => {
    const [row] = await tx
      .select({ contactId: contactIdentity.contactId })
      .from(contactIdentity)
      .where(
        and(
          eq(contactIdentity.teamId, teamId),
          eq(contactIdentity.kind, SYSTEM_IDENTITY_KIND),
          eq(contactIdentity.value, SYSTEM_IDENTITY_VALUE)
        )
      )
      .limit(1)
    return row?.contactId ?? null
  }

  const existing = await find()
  if (existing) return existing

  const contactId = randomUUID()
  const now = new Date()
  await tx.insert(contact).values({ id: contactId, teamId, name: SYSTEM_CONTACT_NAME, createdAt: now, updatedAt: now })
  const claimed = await tx
    .insert(contactIdentity)
    .values({
      id: randomUUID(),
      contactId,
      teamId,
      kind: SYSTEM_IDENTITY_KIND,
      value: SYSTEM_IDENTITY_VALUE,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: contactIdentity.id })

  if (claimed.length > 0) return contactId

  // Lost a race with another escalation: use the winner's contact and drop ours.
  await tx.delete(contact).where(eq(contact.id, contactId))
  const winner = await find()
  if (!winner) throw new Error('System contact vanished during escalation')
  return winner
}

export interface EscalationResult {
  conversationId: string
  inboxId: string
  displayId: number
  alreadyEscalated: boolean
}

export interface EscalateInput {
  siteId: string
  mentionId: string
  teamId: string
  projectId: string
  userId: string
  inbox: { id: string }
}

/**
 * Creates the support conversation for a mention and marks the mention escalated, atomically.
 * The mention row is locked, so concurrent calls resolve to one conversation and a repeat
 * returns the existing one. Sends nothing to anyone.
 */
export async function escalateMention(input: EscalateInput): Promise<EscalationResult> {
  const result = await db.transaction(async (tx): Promise<EscalationResult> => {
    const [row] = await tx
      .select({
        id: mention.id,
        source: mention.source,
        author: mention.author,
        title: mention.title,
        excerpt: mention.excerpt,
        url: mention.url,
        conversationId: mention.conversationId,
        termId: mention.termId,
      })
      .from(mention)
      // Scoping by site stops a member of one product escalating another product's mention.
      .where(and(eq(mention.id, input.mentionId), eq(mention.siteId, input.siteId)))
      .limit(1)
      .for('update')

    if (!row) httpError(404, 'Not Found', ErrorCode.NOT_FOUND, 'Mention not found')

    if (row.conversationId) {
      const [existing] = await tx
        .select({ id: conversation.id, inboxId: conversation.inboxId, displayId: conversation.displayId })
        .from(conversation)
        .where(and(eq(conversation.id, row.conversationId), eq(conversation.teamId, input.teamId)))
        .limit(1)
      if (existing) {
        return {
          conversationId: existing.id,
          inboxId: existing.inboxId,
          displayId: existing.displayId,
          alreadyEscalated: true,
        }
      }
    }

    let termLabel: string | null = null
    if (row.termId) {
      const [term] = await tx
        .select({ label: marketingTerm.label })
        .from(marketingTerm)
        .where(and(eq(marketingTerm.id, row.termId), eq(marketingTerm.siteId, input.siteId)))
        .limit(1)
      termLabel = term?.label ?? null
    }

    const item: EscalationMention = { ...row, termLabel }
    const now = new Date()
    const conversationId = randomUUID()
    const contactId = await ensureSystemContact(tx, input.teamId)
    const displayId = await allocateConversationDisplayId(tx, input.teamId)

    await tx.insert(conversation).values({
      id: conversationId,
      inboxId: input.inbox.id,
      teamId: input.teamId,
      contactId,
      projectId: input.projectId,
      displayId,
      subject: buildEscalationSubject(item),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })

    // A private note authored by the escalating agent; `delivered` so no delivery worker picks it up.
    await tx.insert(conversationMessage).values({
      id: randomUUID(),
      conversationId,
      kind: 'note',
      body: buildEscalationNote(item),
      bodyHtml: null,
      senderKind: 'agent',
      senderUserId: input.userId,
      isPrivate: true,
      deliveryStatus: 'delivered',
      metadata: { source: 'marketing.mentions', mentionId: row.id },
      createdAt: now,
    })

    await tx
      .update(mention)
      .set({ status: 'escalated', conversationId, escalatedAt: now })
      .where(and(eq(mention.id, row.id), eq(mention.siteId, input.siteId)))

    return { conversationId, inboxId: input.inbox.id, displayId, alreadyEscalated: false }
  })

  if (!result.alreadyEscalated) {
    await publishConversationEvent({
      type: 'conversation.created',
      teamId: input.teamId,
      inboxId: result.inboxId,
      conversationId: result.conversationId,
    })
  }

  return result
}
