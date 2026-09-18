const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
// eslint-disable-next-line no-unused-vars
type BoundaryPredicate = (localDate: string) => boolean
const SUPPORTED_YEAR_MIN = 1900
const SUPPORTED_YEAR_MAX = 9998

function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    throw new RangeError(`Invalid timezone: ${timezone}`)
  }
}

/** Return whether a value is accepted as an IANA timezone by the runtime. */
export function isValidReportingTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) return false
  try {
    formatter(timezone)
    return true
  } catch {
    return false
  }
}

function formatDate(instant: Date, format: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(format.formatToParts(instant).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function validateDate(date: string): void {
  const match = DATE_PATTERN.exec(date)
  if (!match) throw new RangeError(`Invalid calendar date: ${date}`)
  const [, year, month, day] = match
  const yearNumber = Number(year)
  if (yearNumber < SUPPORTED_YEAR_MIN || yearNumber > SUPPORTED_YEAR_MAX) {
    throw new RangeError(`Calendar year must be between ${SUPPORTED_YEAR_MIN} and ${SUPPORTED_YEAR_MAX}: ${date}`)
  }
  const candidate = new Date(0)
  candidate.setUTCFullYear(yearNumber, Number(month) - 1, Number(day))
  candidate.setUTCHours(0, 0, 0, 0)
  if (
    candidate.getUTCFullYear() !== yearNumber ||
    candidate.getUTCMonth() !== Number(month) - 1 ||
    candidate.getUTCDate() !== Number(day)
  ) {
    throw new RangeError(`Invalid calendar date: ${date}`)
  }
}

export function reportingDateAt(instant: Date, timezone: string): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) throw new RangeError('Invalid instant')
  const date = formatDate(instant, formatter(timezone))
  validateDate(date)
  return date
}

export function reportingDayBounds(date: string, timezone: string): { start: Date; end: Date } {
  validateDate(date)
  const format = formatter(timezone)
  const target = Date.parse(`${date}T00:00:00.000Z`)
  const findBoundary = (predicate: BoundaryPredicate): Date => {
    let low = target - 3 * 86400000
    let high = target + 3 * 86400000
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (predicate(formatDate(new Date(middle), format))) high = middle
      else low = middle + 1
    }
    return new Date(low)
  }
  const start = findBoundary((localDate) => localDate >= date)
  if (formatDate(start, format) !== date) throw new RangeError(`Calendar date does not exist in timezone: ${date}`)
  const end = findBoundary((localDate) => localDate > date)
  return { start, end }
}
