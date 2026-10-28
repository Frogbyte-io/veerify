/**
 * Bounded JSON body reader for `/mcp`. The MCP SDK caps request bodies at 4 MiB when it reads
 * the stream itself; the route hands it a pre-parsed body, so the same cap is enforced here.
 */
import type { H3Event } from 'h3'
import { readJsonBodyWithLimit } from '~/server/utils/json-body-limit'

/** Same as the SDK's DEFAULT_MAX_REQUEST_BODY_SIZE. */
export const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024

/**
 * Reads and parses the request body, refusing anything above MCP_MAX_BODY_BYTES: up front from
 * `Content-Length`, and while streaming for chunked bodies (it stops buffering at the cap).
 */
export function readMcpJsonBody(event: H3Event): Promise<unknown> {
  return readJsonBodyWithLimit(event, MCP_MAX_BODY_BYTES)
}
