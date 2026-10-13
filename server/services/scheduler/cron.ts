/**
 * Minimal, dependency-free validator for standard 5-field cron expressions:
 * `minute hour day-of-month month day-of-week`.
 *
 * Supports the wildcard, step values (e.g. every-n), single values, ranges
 * (`a-b`), stepped ranges, and comma-separated lists of any of those per
 * field. This is deliberately a
 * subset of what some cron implementations accept (no named months/days, no
 * `L`/`W`/`#`) — good enough to catch malformed input at registration time
 * without pulling in a parser dependency.
 */

const FIELD_RANGES: ReadonlyArray<readonly [min: number, max: number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 both mean Sunday)
]

function isValidCronPart(part: string, min: number, max: number): boolean {
  const [rangePart, stepPart, ...rest] = part.split('/')
  if (rest.length > 0) return false

  if (stepPart !== undefined) {
    if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) return false
  }

  if (rangePart === '*') return true

  if (/^\d+$/.test(rangePart)) {
    const value = Number(rangePart)
    return value >= min && value <= max
  }

  const rangeMatch = rangePart.match(/^(\d+)-(\d+)$/)
  if (!rangeMatch) return false

  const start = Number(rangeMatch[1])
  const end = Number(rangeMatch[2])
  return start >= min && end <= max && start <= end
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (!field) return false
  return field.split(',').every((part) => isValidCronPart(part, min, max))
}

export function isValidCronExpression(expression: unknown): expression is string {
  if (typeof expression !== 'string') return false

  const trimmed = expression.trim()
  if (!trimmed) return false

  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) return false

  return fields.every((field, index) => {
    const range = FIELD_RANGES[index]
    return isValidCronField(field, range[0], range[1])
  })
}
