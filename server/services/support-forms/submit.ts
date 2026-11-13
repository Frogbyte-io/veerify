/**
 * Filing a website form submission into its inbox, the same way an inbound
 * email from the submitter is filed: contact upsert, a new conversation with
 * SLA, the inbox's (or the form's) auto-reply, automation and realtime all go
 * through `server/utils/inbound-intake.ts`. See docs/forms-api.md.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { supportForm, supportFormSubmission, supportInbox } from '~/server/database/schema/support'
import { emailDomain, type InboundMessage } from '~/server/services/support-channels'
import { announceInboundMessage, fileInboundMessage, type InboundIntakeResult } from '~/server/utils/inbound-intake'
import { getProjectById } from '~/server/utils/project-access'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { createLogger } from '~/server/utils/logger'
import { isModuleEnabled } from '~/lib/modules'
import {
  FORM_LIMITS,
  cleanFormText,
  formatSubmissionText,
  validateFormSubmission,
  type FormSubmissionMetadata,
  type SubmissionFieldValue,
} from '~/lib/support-forms'

const logger = createLogger('support-forms')

export type SupportFormRow = typeof supportForm.$inferSelect

export const FORM_ERROR = {
  FORM_NOT_FOUND: 'FORM_NOT_FOUND',
  FORM_DISABLED: 'FORM_DISABLED',
  INBOX_UNAVAILABLE: 'INBOX_UNAVAILABLE',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
} as const

function formError(statusCode: number, statusMessage: string, code: string, message: string, details?: unknown) {
  return createError({ statusCode, statusMessage, data: createErrorResponse(code, message, details) })
}

export function formNotFound() {
  return formError(404, 'Not Found', FORM_ERROR.FORM_NOT_FOUND, 'Form not found')
}

const metadataString = z.string().trim().max(FORM_LIMITS.metadataValue).optional()

/** Optional context a site sends along. Shown to agents, never sent to the customer. */
export const submissionMetadataSchema = z
  .object({
    pageUrl: metadataString,
    locale: z.string().trim().max(35).optional(),
    brand: z.string().trim().max(120).optional(),
    orderNumber: z.string().trim().max(120).optional(),
    clientIp: z.string().trim().max(64).optional(),
    userAgent: metadataString,
    referrer: metadataString,
    extra: z
      .record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/), z.string().max(FORM_LIMITS.metadataValue))
      .refine((value) => Object.keys(value).length <= FORM_LIMITS.extraKeys, {
        message: `At most ${FORM_LIMITS.extraKeys} extra keys`,
      })
      .optional(),
  })
  .strict()

export const submissionBodySchema = z
  .object({
    fields: z.record(z.string(), z.unknown()),
    metadata: submissionMetadataSchema.optional(),
  })
  .strict()

export type SubmissionBody = z.infer<typeof submissionBodySchema>

/** Single-line, control-character-free metadata, with empty values dropped. */
export function cleanMetadata(metadata: SubmissionBody['metadata']): FormSubmissionMetadata {
  const cleaned: FormSubmissionMetadata = {}
  if (!metadata) return cleaned
  for (const key of ['pageUrl', 'locale', 'brand', 'orderNumber', 'clientIp', 'userAgent', 'referrer'] as const) {
    const value = metadata[key]
    if (typeof value === 'string') {
      const clean = cleanFormText(value, false)
      if (clean) cleaned[key] = clean
    }
  }
  if (metadata.extra) {
    const extra: Record<string, string> = {}
    for (const [key, value] of Object.entries(metadata.extra)) {
      const clean = cleanFormText(value, false)
      if (clean) extra[key] = clean
    }
    if (Object.keys(extra).length > 0) cleaned.extra = extra
  }
  return cleaned
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The same body, whatever its key order, hashes the same. */
export function hashSubmissionRequest(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

export function readIdempotencyKey(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > FORM_LIMITS.idempotencyKey || !/^[\x21-\x7E]+$/.test(trimmed)) {
    throw formError(
      400,
      'Bad Request',
      ErrorCode.VALIDATION_ERROR,
      `Idempotency-Key must be 1-${FORM_LIMITS.idempotencyKey} printable ASCII characters`
    )
  }
  return trimmed
}

export async function findFormBySlug(projectId: string, slug: string): Promise<SupportFormRow | null> {
  const [row] = await db
    .select()
    .from(supportForm)
    .where(and(eq(supportForm.projectId, projectId), eq(supportForm.slug, slug)))
    .limit(1)
  return row ?? null
}

export async function findFormByPublicId(publicId: string): Promise<SupportFormRow | null> {
  const [row] = await db.select().from(supportForm).where(eq(supportForm.publicId, publicId)).limit(1)
  return row ?? null
}

export interface SubmitFormInput {
  form: SupportFormRow
  fields: Record<string, unknown>
  metadata: FormSubmissionMetadata
  source: 'api' | 'browser'
  apiKeyId: string | null
  idempotencyKey: string | null
  /** From `hashSubmissionRequest`; compared when an idempotency key is reused. */
  requestHash: string
  receivedAt?: Date
}

export interface SubmitFormResult {
  id: string
  conversationId: string | null
  /** True when an earlier request with the same Idempotency-Key is being answered again. */
  replayed: boolean
}

/** The message metadata the inbox reads to lay a submission out (see the messages route). */
export interface FormSubmissionMessageMetadata {
  submissionId: string
  formId: string
  formName: string
  source: 'api' | 'browser'
  fields: Array<Pick<SubmissionFieldValue, 'key' | 'label' | 'type' | 'display'>>
  metadata: FormSubmissionMetadata
}

/**
 * Validate and file one submission. Throws `createError` 4xx for anything the
 * caller can fix; the form must already be authorized for the caller.
 */
export async function submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
  const { form } = input
  if (!form.isEnabled) {
    throw formError(403, 'Forbidden', FORM_ERROR.FORM_DISABLED, 'This form is not accepting submissions')
  }

  const check = validateFormSubmission({ fields: form.fields, fieldMapping: form.fieldMapping }, input.fields)
  if (!check.ok) {
    throw formError(400, 'Validation failed', ErrorCode.VALIDATION_ERROR, 'Some fields are invalid', check.issues)
  }
  const submission = check.submission

  const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, form.inboxId)).limit(1)
  const project = inbox ? await getProjectById(inbox.projectId) : null
  if (!inbox || !inbox.isEnabled || !project || !isModuleEnabled(project.settings, 'supportEnabled')) {
    throw formError(
      403,
      'Forbidden',
      FORM_ERROR.INBOX_UNAVAILABLE,
      "The form's inbox is switched off, so it is not accepting submissions"
    )
  }

  const submissionId = randomUUID()
  const receivedAt = input.receivedAt ?? new Date()
  const domain = emailDomain(inbox.emailAddress ?? '') ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'veerify.local'
  const subject = submission.subject ?? form.name
  const body = formatSubmissionText(form.name, submission.values)

  // What an email from the submitter would have carried. The synthetic
  // Message-ID gives the conversation a thread key, so the auto-reply and
  // agent replies thread, and the customer's reply to them threads back here.
  const message: InboundMessage = {
    messageId: `form-${submissionId}@${domain}`,
    inReplyTo: null,
    references: [],
    from: { address: submission.email, ...(submission.name ? { name: submission.name } : {}) },
    to: [],
    cc: [],
    envelopeRecipients: [],
    subject,
    text: body,
    html: null,
    attachments: [],
    receivedAt,
    rawHeaders: {},
    isSpam: false,
  }

  const messageMetadata: FormSubmissionMessageMetadata = {
    submissionId,
    formId: form.id,
    formName: form.name,
    source: input.source,
    fields: submission.values.map(({ key, label, type, display }) => ({ key, label, type, display })),
    metadata: input.metadata,
  }

  const autoReply =
    form.autoReplyMode === 'off'
      ? { enabled: false, template: null }
      : form.autoReplyMode === 'custom'
        ? { enabled: Boolean(form.autoReplyTemplate?.trim()), template: form.autoReplyTemplate }
        : { enabled: inbox.autoReplyEnabled, template: inbox.autoReplyTemplate }

  type Outcome =
    | { kind: 'replay'; id: string; conversationId: string | null }
    | { kind: 'filed'; filed: InboundIntakeResult }

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // The idempotency record goes in first. A concurrent request with the same
    // key waits on the unique index until this transaction ends, then finds
    // the committed row (or, if this one rolled back, proceeds itself).
    const [claimed] = await tx
      .insert(supportFormSubmission)
      .values({
        id: submissionId,
        formId: form.id,
        projectId: form.projectId,
        source: input.source,
        apiKeyId: input.apiKeyId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        createdAt: receivedAt,
      })
      .onConflictDoNothing({ target: [supportFormSubmission.formId, supportFormSubmission.idempotencyKey] })
      .returning({ id: supportFormSubmission.id })

    if (!claimed) {
      const [existing] = await tx
        .select({
          id: supportFormSubmission.id,
          conversationId: supportFormSubmission.conversationId,
          requestHash: supportFormSubmission.requestHash,
        })
        .from(supportFormSubmission)
        .where(
          and(
            eq(supportFormSubmission.formId, form.id),
            eq(supportFormSubmission.idempotencyKey, input.idempotencyKey as string)
          )
        )
        .limit(1)
      if (!existing) throw new Error('Idempotency conflict without a stored submission')
      if (existing.requestHash !== input.requestHash) {
        throw formError(
          422,
          'Unprocessable Entity',
          FORM_ERROR.IDEMPOTENCY_KEY_REUSED,
          'This Idempotency-Key was already used with a different request body'
        )
      }
      return { kind: 'replay', id: existing.id, conversationId: existing.conversationId }
    }

    const filed = await fileInboundMessage(tx, {
      inbox,
      mailAddressId: null,
      // Forms are customer support by nature: auto-reply, SLA, CSAT and automation apply.
      behaviour: 'helpdesk',
      message,
      body,
      // Submitted values are never rendered as HTML.
      bodyHtml: null,
      threading: 'new',
      ownAddresses: new Set(),
      attachments: [],
      messageMetadata: { formSubmission: messageMetadata },
      conversationMetadata: { formSubmission: { formId: form.id, submissionId } },
      autoReply,
      logContext: { formId: form.id, submissionId },
    })

    await tx
      .update(supportFormSubmission)
      .set({ conversationId: filed.conversationId, messageId: filed.messageId })
      .where(eq(supportFormSubmission.id, submissionId))

    return { kind: 'filed', filed }
  })

  if (outcome.kind === 'replay') {
    return { id: outcome.id, conversationId: outcome.conversationId, replayed: true }
  }

  await announceInboundMessage(inbox, outcome.filed).catch((error: unknown) => {
    // The conversation exists; a failed realtime or automation pass must not turn it into a 500 the site retries.
    logger.error('Post-commit side effects failed for a form submission', {
      formId: form.id,
      submissionId,
      error: error instanceof Error ? error.message : error,
    })
  })

  return { id: submissionId, conversationId: outcome.filed.conversationId, replayed: false }
}
