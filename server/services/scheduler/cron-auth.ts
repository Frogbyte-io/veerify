import { timingSafeEqual } from 'node:crypto'

/**
 * Verify that a request to a cron HTTP endpoint really came from the
 * scheduler and not an anonymous caller.
 *
 * Vercel Cron invokes the configured path with `Authorization: Bearer
 * <CRON_SECRET>` (see https://vercel.com/docs/cron-jobs/manage-cron-jobs).
 * An unauthenticated cron endpoint that triggers real work is a genuine
 * vulnerability, so this fails closed: a missing or empty secret means
 * "never authorize", not "allow everything".
 *
 * Uses `timingSafeEqual` so a mistimed comparison can't leak how many
 * leading bytes of the secret an attacker has guessed correctly. Buffers are
 * length-checked first because `timingSafeEqual` throws on mismatched
 * lengths rather than returning false.
 */
export function verifyCronSecret(authorizationHeader: string | null | undefined, secret: string | undefined): boolean {
  const trimmedSecret = (secret ?? '').trim()
  if (!trimmedSecret) return false

  if (!authorizationHeader) return false

  const prefix = 'Bearer '
  const provided = authorizationHeader.startsWith(prefix)
    ? authorizationHeader.slice(prefix.length).trim()
    : authorizationHeader.trim()
  if (!provided) return false

  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(trimmedSecret, 'utf8')

  if (providedBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(providedBuffer, expectedBuffer)
}
