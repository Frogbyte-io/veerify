import { randomUUID } from 'node:crypto'
import { createLogger } from '~/server/utils/logger'
import { getStorageProvider } from '~/server/utils/storage'
import type { InboundAttachment } from '~/server/services/support-channels/types'

/**
 * Attachment ingest for inbound mail (SUP-03-8).
 *
 * Storage writes are not transactional, so they happen before the database
 * transaction and each attachment gets its id up front. That ordering is also
 * what makes inline rendering possible: the `cid:` rewrite needs a URL, and
 * the URL needs an id, both before the message row exists.
 *
 * A failed upload drops that one attachment rather than the whole email. An
 * email whose screenshot did not store is still worth having; losing the
 * customer's question because of it is not.
 */

const logger = createLogger('support-inbound-attachments')

/**
 * Per-message ceiling across all parts. Mail providers cap individual messages
 * well below this, so hitting it means something abnormal - a decompression
 * bomb, or a provider that inlined far more than expected.
 */
export const INBOUND_MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Per-part ceiling, so one oversized part cannot consume the whole budget. */
export const INBOUND_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface StoredAttachment {
  id: string
  storageKey: string
  fileName: string
  contentType: string | null
  sizeBytes: number
  isInline: boolean
  contentId: string | null
}

export interface AttachmentIngestResult {
  stored: StoredAttachment[]
  /** `Content-ID` → in-app path, for rewriting `cid:` references. */
  inlineByContentId: Map<string, string>
  skipped: { fileName: string; reason: string }[]
}

/**
 * The in-app path an inline attachment is served from.
 *
 * Deliberately a relative same-origin path rather than a storage URL: the
 * sanitizer can then allow `img` by prefix without needing to know the storage
 * origin, and no request ever leaves for a third party. A direct storage URL
 * would also be unauthorized, which for a customer's attachment is not
 * acceptable.
 */
export function inlineAttachmentPath(attachmentId: string): string {
  return `/api/support/attachments/${attachmentId}`
}

/**
 * Store an inbound message's attachments, enforcing the size caps.
 *
 * Returns the rows to insert plus the inline map. Never throws for an
 * individual attachment; the caller decides nothing on the basis of failures
 * beyond logging them.
 */
export async function ingestInboundAttachments(input: {
  attachments: InboundAttachment[]
  /** The `supportEmailEvent` id, so attachments sit beside the archived raw payload. */
  eventId: string
  provider: string
}): Promise<AttachmentIngestResult> {
  const stored: StoredAttachment[] = []
  const inlineByContentId = new Map<string, string>()
  const skipped: { fileName: string; reason: string }[] = []

  if (input.attachments.length === 0) {
    return { stored, inlineByContentId, skipped }
  }

  const storage = getStorageProvider()
  let usedBytes = 0

  for (const attachment of input.attachments) {
    const size = attachment.content.byteLength

    if (size === 0) {
      // Mailgun's store() action reports attachments by URL rather than
      // inlining bytes, so an empty buffer means "not fetched", not "empty
      // file". Fetching by URL is a provider-specific follow-up; skipping is
      // honest in the meantime.
      skipped.push({ fileName: attachment.fileName, reason: 'no-content' })
      continue
    }

    if (size > INBOUND_MAX_ATTACHMENT_BYTES) {
      skipped.push({ fileName: attachment.fileName, reason: 'attachment-too-large' })
      continue
    }

    if (usedBytes + size > INBOUND_MAX_MESSAGE_ATTACHMENT_BYTES) {
      skipped.push({ fileName: attachment.fileName, reason: 'message-cap-exceeded' })
      continue
    }

    const id = randomUUID()
    // Keyed by the delivery rather than the conversation, so ingest can run
    // before the transaction that resolves which conversation this belongs to.
    // The attachment id keeps two files of the same name from colliding.
    const storageKey = `support/attachments/${input.eventId}/${id}/${attachment.fileName}`

    try {
      await storage.putObject({
        key: storageKey,
        buffer: attachment.content,
        contentType: attachment.contentType || 'application/octet-stream',
      })
    } catch (error) {
      logger.error('Failed to store inbound attachment', {
        provider: input.provider,
        eventId: input.eventId,
        fileName: attachment.fileName,
        error: error instanceof Error ? error.message : error,
      })
      skipped.push({ fileName: attachment.fileName, reason: 'storage-failed' })
      continue
    }

    usedBytes += size
    stored.push({
      id,
      storageKey,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: size,
      isInline: attachment.isInline,
      contentId: attachment.contentId,
    })

    if (attachment.isInline && attachment.contentId) {
      inlineByContentId.set(attachment.contentId, inlineAttachmentPath(id))
    }
  }

  if (skipped.length > 0) {
    logger.warn('Some inbound attachments were not stored', {
      provider: input.provider,
      eventId: input.eventId,
      skipped,
    })
  }

  return { stored, inlineByContentId, skipped }
}

/**
 * Point `cid:` image references at the in-app attachment route.
 *
 * Runs **before** sanitization, so the sanitizer sees an ordinary same-origin
 * path and can judge it by its normal rules rather than being taught about
 * `cid:`. A `cid:` with no matching attachment is left alone and the sanitizer
 * drops it, which is the correct outcome for a reference to something that
 * did not arrive.
 */
export function rewriteInlineCidReferences(html: string | null, inlineByContentId: Map<string, string>): string | null {
  if (!html || inlineByContentId.size === 0) return html

  return html.replace(/(["'])cid:([^"']+)\1/gi, (match, quote: string, rawCid: string) => {
    const cid = rawCid.trim().replace(/^<|>$/g, '')
    const path = inlineByContentId.get(cid)
    return path ? `${quote}${path}${quote}` : match
  })
}
