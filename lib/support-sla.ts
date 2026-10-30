// SLA countdown shared by the conversation list, thread header and details panel.
interface SlaFields {
  nextResponseDueAt?: string | Date | null
  firstResponseDueAt?: string | Date | null
  resolutionDueAt?: string | Date | null
  slaPausedAt?: string | Date | null
  behaviour?: string | null
}

export function supportSlaDueAt(item: SlaFields | null | undefined) {
  if (!item || item.behaviour === 'mail') return null
  return item.nextResponseDueAt || item.firstResponseDueAt || item.resolutionDueAt || null
}

/** `38m`, `2h 5m`, `Breached`, `Paused`, or '' when no SLA applies. */
export function supportSlaCountdown(item: SlaFields | null | undefined, nowMs: number): string {
  const dueAt = supportSlaDueAt(item)
  if (!dueAt) return ''
  if (item?.slaPausedAt) return 'Paused'
  const diffMin = Math.ceil((new Date(dueAt).getTime() - nowMs) / 60000)
  if (diffMin <= 0) return 'Breached'
  if (diffMin < 60) return `${diffMin}m`
  const hours = Math.floor(diffMin / 60)
  const minutes = diffMin % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

/** Tailwind classes for the countdown chip: red when breached, amber within the hour. */
export function supportSlaClass(item: SlaFields | null | undefined, nowMs: number): string {
  const dueAt = supportSlaDueAt(item)
  if (item?.slaPausedAt) return 'bg-muted text-muted-foreground'
  if (!dueAt || new Date(dueAt).getTime() <= nowMs) return 'bg-red-500/12 text-red-700 dark:text-red-300'
  const minutes = (new Date(dueAt).getTime() - nowMs) / 60000
  return minutes <= 60
    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
}
