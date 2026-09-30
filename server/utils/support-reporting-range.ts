import { reportingDateAt, reportingDayBounds } from '~/server/utils/support-reporting-calendar'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 366

export interface ReportingRangeDay {
  date: string
  start: Date
  end: Date
}

export interface ReportingRange {
  from: string
  to: string
  timezone: string
  start: Date
  end: Date
  days: ReportingRangeDay[]
}

interface ReportingRangeInput {
  from?: string
  to?: string
  timezone: string
  now?: Date
}

function validateDateLabel(date: string): void {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    throw new RangeError(`Invalid calendar date: ${date}`)
  }

  const candidate = new Date(`${date}T00:00:00.000Z`)
  const [, year, month, day] = DATE_PATTERN.exec(date) as RegExpExecArray
  if (
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() !== Number(month) - 1 ||
    candidate.getUTCDate() !== Number(day)
  ) {
    throw new RangeError(`Invalid calendar date: ${date}`)
  }

  if (Number(year) < 1900 || Number(year) > 9998) {
    throw new RangeError(`Calendar year must be between 1900 and 9998: ${date}`)
  }
}

function civilDateAtUtcMidnight(date: string): Date {
  validateDateLabel(date)
  const instant = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Invalid calendar date: ${date}`)
  return instant
}

function shiftCivilDate(date: string, days: number): string {
  const shifted = civilDateAtUtcMidnight(date)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  const result = shifted.toISOString().slice(0, 10)
  validateDateLabel(result)
  return result
}

function inclusiveLabelCount(from: string, to: string): number {
  const first = civilDateAtUtcMidnight(from).getTime()
  const last = civilDateAtUtcMidnight(to).getTime()
  return Math.floor((last - first) / DAY_MS) + 1
}

function isMissingCalendarDate(error: unknown): boolean {
  return error instanceof RangeError && /calendar date does not exist in timezone/i.test(error.message)
}

export function resolveReportingRange(input: ReportingRangeInput): ReportingRange {
  const now = input.now === undefined ? new Date() : input.now
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('Invalid now')

  const today = reportingDateAt(now, input.timezone)
  const to = input.to ?? today
  validateDateLabel(to)
  if (to > today) throw new RangeError(`Reporting range cannot end in the future: ${to}`)

  const from = input.from ?? shiftCivilDate(to, -29)
  validateDateLabel(from)
  if (from > to) throw new RangeError(`Reporting range starts after it ends: ${from} > ${to}`)

  if (inclusiveLabelCount(from, to) > MAX_RANGE_DAYS) {
    throw new RangeError(`Reporting range cannot exceed ${MAX_RANGE_DAYS} civil dates`)
  }

  // Resolve both endpoints before enumerating interior labels. An absent endpoint is invalid,
  // while an absent interior label is simply omitted from the returned day list.
  const firstBounds = reportingDayBounds(from, input.timezone)
  const lastBounds = reportingDayBounds(to, input.timezone)
  const days: ReportingRangeDay[] = []

  for (let offset = 0; offset < inclusiveLabelCount(from, to); offset += 1) {
    const date = shiftCivilDate(from, offset)
    try {
      const bounds = reportingDayBounds(date, input.timezone)
      days.push({ date, start: bounds.start, end: bounds.end })
    } catch (error) {
      if (!isMissingCalendarDate(error)) throw error
    }
  }

  return {
    from,
    to,
    timezone: input.timezone,
    start: firstBounds.start,
    end: lastBounds.end,
    days,
  }
}
