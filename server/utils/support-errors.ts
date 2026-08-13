/**
 * Postgres error helpers for the support platform.
 *
 * Deliberately a separate file from `database-errors.ts` (which lives on the
 * sleekplan-export branch and covers connection failures) so the two cannot
 * collide if those histories ever meet.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505'

/**
 * Did this error come from a unique index?
 *
 * Used to turn a race into a clean 409 rather than a 500. Checking after the
 * fact beats a pre-flight SELECT: two concurrent creates can both pass a
 * pre-check and then one still fails, so the constraint is the only real
 * arbiter — the pre-check would just be a slower way to be wrong.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false

  const code = (error as { code?: unknown }).code
  if (code !== UNIQUE_VIOLATION) return false

  if (!constraint) return true

  const name = (error as { constraint?: unknown }).constraint
  return typeof name === 'string' && name === constraint
}
