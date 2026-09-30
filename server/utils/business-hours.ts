export type BusinessHoursWindow = {
  open: string
  close: string
}

export type BusinessHoursSchedule = Record<string, BusinessHoursWindow[]>

export type BusinessHoursConfig = {
  timezone: string
  weeklySchedule: BusinessHoursSchedule
  holidays?: string[]
}

const WEEKDAY_BY_INTL_NAME: Record<string, string> = {
  Sun: 'sunday',
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
}
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string) {
  let formatter = PARTS_FORMATTER_CACHE.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    PARTS_FORMATTER_CACHE.set(timezone, formatter)
  }
  return formatter
}

function localParts(date: Date, timezone: string) {
  const parts = formatterFor(timezone).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = WEEKDAY_BY_INTL_NAME[values.weekday]
  if (!weekday) throw new Error(`Unsupported weekday returned for timezone ${timezone}`)
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  }
}

function parseClock(value: string): number {
  const match = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/.exec(value.trim())
  if (!match) throw new Error(`Invalid business-hours time: ${value}`)
  if (value.trim() === '24:00') return 24 * 60
  return Number(match[1]) * 60 + Number(match[2])
}

function windowsFor(schedule: BusinessHoursSchedule, weekday: string): BusinessHoursWindow[] {
  return schedule[weekday] || schedule[WEEKDAY_NAMES.indexOf(weekday).toString()] || []
}

function previousWeekday(weekday: string) {
  const index = WEEKDAY_NAMES.indexOf(weekday)
  return WEEKDAY_NAMES[(index + WEEKDAY_NAMES.length - 1) % WEEKDAY_NAMES.length]
}

function containsMinute(window: BusinessHoursWindow, minuteOfDay: number): boolean {
  const open = parseClock(window.open)
  const close = parseClock(window.close)
  if (open === close) return false
  if (open < close) return minuteOfDay >= open && minuteOfDay < close
  return minuteOfDay >= open || minuteOfDay < close
}

/** Return whether a UTC instant falls inside the configured local business windows. */
export function isBusinessTime(date: Date, config: BusinessHoursConfig): boolean {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date')
  const parts = localParts(date, config.timezone)
  if (new Set(config.holidays || []).has(parts.date)) return false

  if (windowsFor(config.weeklySchedule, parts.weekday).some((window) => containsMinute(window, parts.minuteOfDay))) {
    return true
  }

  // A window can span midnight. Its early-morning portion belongs to the
  // previous local weekday, and the holiday check must apply to that date.
  const previous = previousWeekday(parts.weekday)
  if (
    windowsFor(config.weeklySchedule, previous).some((window) => {
      const open = parseClock(window.open)
      const close = parseClock(window.close)
      return open > close && parts.minuteOfDay < close
    })
  ) {
    // The current local date is the date on which the early-morning portion
    // is worked, so a holiday today still excludes it.
    return true
  }

  return false
}

/**
 * Add business minutes to a UTC instant. The schedule is evaluated in its
 * configured timezone for every real minute, so DST gaps/repeated hours and
 * local-date holidays naturally follow the wall-clock schedule.
 */
export function addBusinessMinutes(start: Date, minutes: number, config: BusinessHoursConfig): Date {
  if (!Number.isFinite(minutes) || minutes < 0 || !Number.isInteger(minutes)) {
    throw new Error('Business-hours duration must be a non-negative integer')
  }
  if (minutes === 0) return new Date(start)

  let cursor = new Date(start)
  let remaining = minutes
  // 10 years of every-minute scans is a safety bound for an accidentally
  // empty schedule. Normal SLA targets complete in a few thousand steps.
  const maxSteps = 10 * 366 * 24 * 60
  for (let step = 0; step < maxSteps && remaining > 0; step += 1) {
    if (isBusinessTime(cursor, config)) remaining -= 1
    cursor = new Date(cursor.getTime() + 60_000)
  }
  if (remaining > 0) throw new Error('Business-hours schedule contains no usable working time')
  return cursor
}

/** Count business minutes in the half-open interval [start, end). */
export function businessMinutesBetween(start: Date, end: Date, config: BusinessHoursConfig): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('Invalid date')
  if (start.getTime() === end.getTime()) return 0
  if (end.getTime() < start.getTime()) return -businessMinutesBetween(end, start, config)

  let cursor = new Date(start)
  let total = 0
  const endMs = end.getTime()
  while (cursor.getTime() < endMs) {
    const next = new Date(Math.min(cursor.getTime() + 60_000, endMs))
    if (isBusinessTime(cursor, config)) total += (next.getTime() - cursor.getTime()) / 60_000
    cursor = next
  }
  return total
}
