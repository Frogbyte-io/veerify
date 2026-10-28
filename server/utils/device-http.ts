import type { H3Event } from 'h3'

/** Device endpoints are public, so bodies are capped before anything is read. */
export const DEVICE_MAX_BODY_BYTES = 8 * 1024

export function deviceBodyTooLarge(event: H3Event): boolean {
  return Number(getHeader(event, 'content-length') || 0) > DEVICE_MAX_BODY_BYTES
}
