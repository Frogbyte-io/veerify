import { describe, expect, it } from 'vitest'

import { buildContactTimeline, isAutoLinkEnabled } from '../server/utils/support-timeline'

describe('support contact timeline', () => {
  it('keeps authoritative links separate and removes linked feedback from suggestions', () => {
    const linked = [{ id: 'link-1', entityType: 'feedback', entityId: 'feedback-1', source: 'agent' }]
    const probableFeedback = [
      { id: 'feedback-1', projectId: 'project-1', authorEmail: 'customer@example.com' },
      { id: 'feedback-2', projectId: 'project-1', authorEmail: 'customer@example.com' },
    ]

    expect(buildContactTimeline(linked, probableFeedback)).toEqual({
      linked,
      probableFeedback: [probableFeedback[1]],
    })
  })

  it('defaults auto-linking off when no team setting exists', () => {
    expect(isAutoLinkEnabled(undefined)).toBe(false)
    expect(isAutoLinkEnabled({ autoLinkFeedback: false })).toBe(false)
    expect(isAutoLinkEnabled({ autoLinkFeedback: true })).toBe(true)
  })

  it('returns independent page metadata for linked and probable sections', () => {
    const linked = [{ id: 'link-1', entityType: 'feedback', entityId: 'feedback-1', createdAt: new Date('2026-08-13T12:00:00.000Z') }]
    const probableFeedback = [{ id: 'feedback-2', createdAt: new Date('2026-08-13T11:00:00.000Z') }]

    expect(buildContactTimeline(linked, probableFeedback, { limit: 25 })).toMatchObject({
      linked,
      probableFeedback,
      linkedHasMore: false,
      linkedNextCursor: null,
      probableHasMore: false,
      probableNextCursor: null,
    })
  })
})
