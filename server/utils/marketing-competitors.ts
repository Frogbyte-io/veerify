import { isIP } from 'node:net'
import { z } from 'zod'
import { createError } from 'h3'
import type { competitorChange, competitorWatch } from '~/server/database/schema/marketing'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { bareHost, hostMatchesDomain } from '~/server/services/marketing/competitors/hosts'

export const MAX_WATCHES_PER_COMPETITOR = 3
export const MAX_WATCHES_PER_SITE = 15
export const MANUAL_CHECKS_PER_DAY = 3
export const WATCH_CREATIONS_PER_DAY = 20
export const COMPETITOR_DOMAIN_REQUIRED_MESSAGE = "Set the competitor's domain in Marketing settings first"
export const RECENT_CHANGES_LIMIT = 50

export const WATCH_KINDS = ['pricing', 'changelog', 'homepage', 'other'] as const

export const createWatchSchema = z.object({
  termId: z.string().trim().min(1, 'A competitor is required'),
  url: z.string().trim().min(1, 'A URL is required').max(500, 'The URL is at most 500 characters'),
  kind: z.enum(WATCH_KINDS),
})

export const updateWatchSchema = z
  .object({
    status: z.enum(['active', 'paused']).optional(),
    kind: z.enum(WATCH_KINDS).optional(),
  })
  .refine((value) => value.status !== undefined || value.kind !== undefined, 'Nothing to update')

export const markSeenSchema = z.object({ ids: z.array(z.string().min(1)).max(100).optional() })

export const settingsSchema = z.object({ summarize: z.boolean() })

export function watchValidationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Validation failed',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

/**
 * Validates a page URL for a watch and returns its normalised form (no fragment,
 * no trailing-dot host). Public https pages only, never the site's own host, and
 * inside the competitor's domain (the domain itself or a subdomain). A domain that
 * is a bare public suffix (github.io, vercel.app) never matches.
 */
export function validateWatchUrl(
  input: string,
  siteOrigin: string,
  competitorDomain: string | null | undefined
): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    watchValidationError('Enter a full URL such as https://rival.com/pricing')
  }
  if (url.protocol !== 'https:') watchValidationError('Only https pages can be watched')
  if (url.username || url.password) watchValidationError('The URL cannot contain credentials')
  if (url.port) watchValidationError('The URL cannot use a custom port')

  const host = bareHost(url.hostname)
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.endsWith('.local')) {
    watchValidationError('Enter a public page on the competitor website')
  }

  let own = ''
  try {
    own = bareHost(new URL(siteOrigin).hostname)
  } catch {
    // an unparsable origin cannot match
  }
  if (own && host === own) watchValidationError('That is your own website. Watch a competitor page instead')

  if (!hostMatchesDomain(host, competitorDomain)) {
    watchValidationError(
      competitorDomain
        ? `The page must be on ${bareHost(competitorDomain)} (or a subdomain), the domain set for this competitor`
        : COMPETITOR_DOMAIN_REQUIRED_MESSAGE
    )
  }

  url.hostname = url.hostname.replace(/\.+$/, '')
  url.hash = ''
  return url.toString()
}

type WatchRow = typeof competitorWatch.$inferSelect
type ChangeRow = typeof competitorChange.$inferSelect

export function serializeWatch(watch: WatchRow) {
  return {
    id: watch.id,
    termId: watch.termId,
    url: watch.url,
    kind: watch.kind,
    status: watch.status,
    lastCheckedAt: watch.lastCheckedAt,
    lastChangedAt: watch.lastChangedAt,
    lastError: watch.lastError,
    createdAt: watch.createdAt,
  }
}

export function serializeChange(change: ChangeRow, watch: { url: string; kind: string; termLabel: string }) {
  return {
    id: change.id,
    watchId: change.watchId,
    competitor: watch.termLabel,
    url: watch.url,
    kind: watch.kind,
    detectedAt: change.detectedAt,
    added: change.addedText ? change.addedText.split('\n') : [],
    removed: change.removedText ? change.removedText.split('\n') : [],
    summary: change.summary,
    provider: change.provider,
    model: change.model,
    seen: change.seenAt !== null,
  }
}
