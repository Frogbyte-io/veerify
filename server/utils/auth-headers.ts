import { getRequestHeaders } from 'h3'
import type { H3Event } from 'h3'

export function getAuthHeaders(event: H3Event) {
  return getRequestHeaders(event)
}
