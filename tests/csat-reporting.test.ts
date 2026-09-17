import { describe, expect, it } from 'vitest'
import { summarizeCsatRows, type CsatReportRow } from '~/server/utils/csat-reporting'

const row = (overrides: Partial<CsatReportRow> = {}): CsatReportRow => ({
  rating: 5,
  scale: 'csat_5',
  inboxId: 'inbox-1',
  inboxName: 'Support',
  agentUserId: 'agent-1',
  agentName: 'Ada',
  respondedAt: new Date('2026-09-17T12:00:00Z'),
  ...overrides,
})

describe('summarizeCsatRows', () => {
  it('returns normalized overall, inbox, agent, trend, and distribution scores', () => {
    const summary = summarizeCsatRows([
      row(),
      row({ rating: 4, respondedAt: new Date('2026-09-17T14:00:00Z') }),
      row({
        rating: 1,
        scale: 'thumbs',
        inboxId: 'inbox-2',
        inboxName: 'Billing',
        agentUserId: null,
        agentName: null,
        respondedAt: new Date('2026-09-16T14:00:00Z'),
      }),
    ])

    expect(summary).toMatchObject({
      responseCount: 3,
      averageRating: 3.33,
      scorePercent: 93.33,
      distribution: [
        { rating: 1, count: 1 },
        { rating: 4, count: 1 },
        { rating: 5, count: 1 },
      ],
    })
    expect(summary.byInbox.map(({ inboxName, responseCount }) => ({ inboxName, responseCount }))).toEqual([
      { inboxName: 'Support', responseCount: 2 },
      { inboxName: 'Billing', responseCount: 1 },
    ])
    expect(summary.byAgent.map(({ agentName, responseCount }) => ({ agentName, responseCount }))).toEqual([
      { agentName: 'Ada', responseCount: 2 },
      { agentName: 'Unassigned', responseCount: 1 },
    ])
    expect(summary.trend.map(({ date, responseCount }) => ({ date, responseCount }))).toEqual([
      { date: '2026-09-16', responseCount: 1 },
      { date: '2026-09-17', responseCount: 2 },
    ])
  })

  it('returns empty score values when no response is rated', () => {
    expect(summarizeCsatRows([])).toEqual({
      responseCount: 0,
      averageRating: null,
      scorePercent: null,
      distribution: [],
      byInbox: [],
      byAgent: [],
      trend: [],
    })
  })
})
