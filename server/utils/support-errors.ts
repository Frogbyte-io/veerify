/**
 * Postgres error helpers for the support platform.
 *
 * Deliberately a separate file from `database-errors.ts` (which lives on the
 * sleekplan-export branch and covers connection failures) so the two cannot
 * collide if those histories ever meet.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505'

/** Postgres `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503'

/** How many `.cause` links to unwrap before giving up. Real chains are one deep; this is a safety bound, not a design target. */
const MAX_CAUSE_DEPTH = 5

/**
 * Did this error come from a unique index?
 *
 * Used to turn a race into a clean 409 rather than a 500. Checking after the
 * fact beats a pre-flight SELECT: two concurrent creates can both pass a
 * pre-check and then one still fails, so the constraint is the only real
 * arbiter — the pre-check would just be a slower way to be wrong.
 *
 * drizzle-orm's node-postgres driver throws `DrizzleQueryError`, which wraps
 * the real `pg` error (the one that actually carries `.code`) in `.cause`
 * rather than exposing it directly. Checking only the top-level error means
 * this never matches and every conflict leaks as a raw 500 with a stack
 * trace — which is exactly what happened here until a live request against a
 * duplicate name caught it. Standard `Error.cause` unwrapping, not
 * drizzle-specific, so it keeps working if another layer starts wrapping too.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current = error
  let depth = 0

  while (current && typeof current === 'object' && depth < MAX_CAUSE_DEPTH) {
    const code = (current as { code?: unknown }).code

    if (code === UNIQUE_VIOLATION) {
      if (!constraint) return true
      const name = (current as { constraint?: unknown }).constraint
      return typeof name === 'string' && name === constraint
    }

    current = (current as { cause?: unknown }).cause
    depth++
  }

  return false
}

/**
 * Did this error come from an `onDelete: 'restrict'` foreign key?
 *
 * Used to turn a delete blocked by a dependent row (e.g. an inbox that still
 * has conversations) into a clean 409 rather than a 500. Same `.cause`
 * unwrapping as `isUniqueViolation`, for the same reason.
 */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  let current = error
  let depth = 0

  while (current && typeof current === 'object' && depth < MAX_CAUSE_DEPTH) {
    const code = (current as { code?: unknown }).code

    if (code === FOREIGN_KEY_VIOLATION) {
      if (!constraint) return true
      const name = (current as { constraint?: unknown }).constraint
      return typeof name === 'string' && name === constraint
    }

    current = (current as { cause?: unknown }).cause
    depth++
  }

  return false
}
