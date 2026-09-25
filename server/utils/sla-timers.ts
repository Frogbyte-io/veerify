import { businessMinutesBetween, type BusinessHoursConfig } from './business-hours'
import { addSlaMinutes } from './sla'

export type SlaDeadlines = {
  firstResponseDueAt: Date | null
  nextResponseDueAt: Date | null
  resolutionDueAt: Date | null
}

function minutesBetween(start: Date, end: Date, businessHours?: BusinessHoursConfig | null): number {
  if (businessHours) return businessMinutesBetween(start, end, businessHours)
  return (end.getTime() - start.getTime()) / 60_000
}

/**
 * Resume a paused SLA without consuming time while the conversation was
 * pending. Each unexpired deadline is rebuilt from its remaining business
 * minutes at the resume instant; already-breached deadlines remain breached.
 */
export function resumeSlaDeadlines(input: {
  deadlines: SlaDeadlines
  pausedAt: Date
  resumedAt: Date
  businessHours?: BusinessHoursConfig | null
}): SlaDeadlines & { pausedMinutes: number } {
  const pausedMinutes = Math.max(0, Math.ceil(minutesBetween(input.pausedAt, input.resumedAt, input.businessHours)))
  const shifted = Object.fromEntries(
    (Object.keys(input.deadlines) as (keyof SlaDeadlines)[]).map((key) => {
      const due = input.deadlines[key]
      if (!due || due.getTime() <= input.pausedAt.getTime()) return [key, due]
      const remaining = Math.max(0, Math.ceil(minutesBetween(input.pausedAt, due, input.businessHours)))
      return [key, addSlaMinutes(input.resumedAt, remaining, input.businessHours)]
    })
  ) as SlaDeadlines

  return { ...shifted, pausedMinutes }
}
