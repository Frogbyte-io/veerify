/**
 * Postgres error classification for the import engine. drizzle wraps the `pg` error (which carries `.code`) in
 * `.cause`, so the chain is unwrapped (same approach as server/utils/support-errors.ts).
 */

const MAX_CAUSE_DEPTH = 5

/** SQLSTATEs worth retrying: deadlock, serialization failure, connection exceptions, admin shutdown. */
const TRANSIENT_CODES = new Set(['40P01', '40001', '57P01'])
/** Node socket errors seen when the connection drops. */
const CONNECTION_ERRNOS = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'])
const CONNECTION_MESSAGES = [
  /connection terminated/i,
  /connection (?:is )?closed/i,
  /client has encountered a connection error/i,
]

function* errorChain(error: unknown): Generator<Record<string, unknown>> {
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < MAX_CAUSE_DEPTH; depth++) {
    yield current as Record<string, unknown>
    current = (current as { cause?: unknown }).cause
  }
}

/** The first SQLSTATE (or errno code) found in the error chain. */
export function pgErrorCode(error: unknown): string | undefined {
  for (const e of errorChain(error)) if (typeof e.code === 'string') return e.code
  return undefined
}

/** A failure that may succeed when the same work is run again later (nothing about the data is wrong). */
export function isTransientDbError(error: unknown): boolean {
  for (const e of errorChain(error)) {
    const code = typeof e.code === 'string' ? e.code : undefined
    if (code && (TRANSIENT_CODES.has(code) || code.startsWith('08') || CONNECTION_ERRNOS.has(code))) return true
    const message = typeof e.message === 'string' ? e.message : ''
    if (CONNECTION_MESSAGES.some((re) => re.test(message))) return true
  }
  return false
}
