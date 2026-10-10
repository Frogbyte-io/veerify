/**
 * Error messages from pg (unique violations quote the conflicting row) and SMTP
 * (rejected recipients quote the address) can contain customer email addresses,
 * so logs get only the error kind and code, and stored messages are scrubbed.
 */
export function describeError(error: unknown): { kind: string; code: string | number | null } {
  if (!error || typeof error !== 'object') return { kind: 'unknown', code: null }
  const candidate = error as { name?: unknown; code?: unknown; responseCode?: unknown }
  const code = candidate.code ?? candidate.responseCode ?? null
  return {
    kind: typeof candidate.name === 'string' ? candidate.name : 'Error',
    code: typeof code === 'string' || typeof code === 'number' ? code : null,
  }
}

/** Removes email addresses and trims, for text that is stored and shown in the requests log. */
export function scrubEmails(message: string): string {
  return message.replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, '[email]').slice(0, 300)
}
