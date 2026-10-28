import type { H3Event } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

/** Device endpoints are public, so oversized bodies are refused before anything is read. */
export const DEVICE_MAX_BODY_BYTES = 8 * 1024

/** Checks only the declared Content-Length; a body without one (chunked) is not measured here. */
export function deviceBodyTooLarge(event: H3Event): boolean {
  return Number(getHeader(event, 'content-length') || 0) > DEVICE_MAX_BODY_BYTES
}

/** The public origin of this deployment, without a trailing slash. */
export function getPublicBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

/**
 * Defence in depth for the cookie-authenticated approve/deny posts: refuses a request the browser marks as
 * cross-site (`Sec-Fetch-Site` other than same-origin) or whose `Origin` differs from the request's own origin.
 */
export function requireSameOrigin(event: H3Event): void {
  const site = getHeader(event, 'sec-fetch-site')
  const origin = getHeader(event, 'origin')
  let blocked = site !== undefined && site !== 'same-origin'
  if (!blocked && origin !== undefined) {
    try {
      blocked = new URL(origin).origin !== getRequestURL(event).origin
    } catch {
      blocked = true
    }
  }
  if (blocked) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Cross-site request blocked'),
    })
  }
}
