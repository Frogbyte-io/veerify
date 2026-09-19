import type { CsatScale } from '~/server/database/schema/support'
import { createReportingDateFormatter } from '~/server/utils/support-reporting-calendar'

export type CsatReportRow = {
  rating: number
  scale: CsatScale
  inboxId: string
  inboxName: string
  agentUserId: string | null
  agentName: string | null
  respondedAt: Date
}

export type CsatScore = {
  responseCount: number
  averageRating: number | null
  scorePercent: number | null
}

export type CsatSummary = CsatScore & {
  distribution: Array<{ rating: number; count: number }>
  byInbox: Array<CsatScore & { inboxId: string; inboxName: string }>
  byAgent: Array<CsatScore & { agentUserId: string | null; agentName: string }>
  trend: Array<CsatScore & { date: string }>
}

function scorePercentForRating(rating: number, scale: CsatScale): number {
  if (scale === 'thumbs') return (rating - 1) * 100
  if (scale === 'csat_5') return (rating / 5) * 100
  return (rating / 10) * 100
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function scoreForRows(rows: CsatReportRow[]): CsatScore {
  if (rows.length === 0) {
    return { responseCount: 0, averageRating: null, scorePercent: null }
  }

  const ratingTotal = rows.reduce((total, row) => total + row.rating, 0)
  const percentTotal = rows.reduce((total, row) => total + scorePercentForRating(row.rating, row.scale), 0)
  return {
    responseCount: rows.length,
    averageRating: round(ratingTotal / rows.length),
    scorePercent: round(percentTotal / rows.length),
  }
}

export function summarizeCsatRows(rows: CsatReportRow[], timezone = 'UTC'): CsatSummary {
  const byInbox = new Map<string, CsatReportRow[]>()
  const byAgent = new Map<string, CsatReportRow[]>()
  const byDate = new Map<string, CsatReportRow[]>()
  const distribution = new Map<number, number>()
  const formatReportingDate = createReportingDateFormatter(timezone)

  for (const row of rows) {
    const inboxRows = byInbox.get(row.inboxId) || []
    inboxRows.push(row)
    byInbox.set(row.inboxId, inboxRows)

    const agentKey = row.agentUserId || '__unassigned__'
    const agentRows = byAgent.get(agentKey) || []
    agentRows.push(row)
    byAgent.set(agentKey, agentRows)

    const date = formatReportingDate(row.respondedAt)
    const dateRows = byDate.get(date) || []
    dateRows.push(row)
    byDate.set(date, dateRows)

    distribution.set(row.rating, (distribution.get(row.rating) || 0) + 1)
  }

  return {
    ...scoreForRows(rows),
    distribution: [...distribution.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rating, count]) => ({ rating, count })),
    byInbox: [...byInbox.entries()]
      .map(([inboxId, inboxRows]) => ({
        inboxId,
        inboxName: inboxRows[0].inboxName,
        ...scoreForRows(inboxRows),
      }))
      .sort((left, right) => right.responseCount - left.responseCount || left.inboxName.localeCompare(right.inboxName)),
    byAgent: [...byAgent.entries()]
      .map(([agentUserId, agentRows]) => ({
        agentUserId: agentUserId === '__unassigned__' ? null : agentUserId,
        agentName: agentRows[0].agentName || 'Unassigned',
        ...scoreForRows(agentRows),
      }))
      .sort((left, right) => right.responseCount - left.responseCount || left.agentName.localeCompare(right.agentName)),
    trend: [...byDate.entries()]
      .map(([date, dateRows]) => ({ date, ...scoreForRows(dateRows) }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  }
}
