import { describe, expect, it } from 'vitest'
import { assembleOverview, type OverviewProject, type OverviewRaw } from '~/server/services/overview/assemble'

const NOW = new Date('2026-11-01T12:00:00Z')

const project = (id: string, over: Partial<OverviewProject> = {}): OverviewProject => ({
  id,
  name: `Project ${id}`,
  slug: id,
  inboxOn: true,
  feedbackOn: true,
  changelogOn: true,
  inboxAccess: true,
  ...over,
})

const raw = (over: Partial<OverviewRaw> = {}): OverviewRaw => ({
  now: NOW,
  projects: [project('a'), project('b')],
  conversationCounts: [],
  conversationWeek: [],
  firstReplyTotal: { current: null, previous: null },
  slaItems: [],
  oldestWaiting: [],
  postsWeek: [],
  votesWeek: [],
  defaultStatuses: [],
  statusCounts: [],
  drafts: [],
  draftTotal: 0,
  releases: [],
  ...over,
})

describe('assembleOverview', () => {
  it('is all zeros and empty when nothing happened', () => {
    const result = assembleOverview(raw())
    expect(result.needsYou.slaAtRisk).toEqual({ total: 0, items: [] })
    expect(result.needsYou.waiting).toEqual({ total: 0, byProject: [], oldest: null })
    expect(result.needsYou.untriaged.total).toBe(0)
    expect(result.needsYou.drafts).toEqual({ total: 0, items: [] })
    expect(result.week.received).toMatchObject({ available: true, current: 0, previous: 0 })
    expect(result.week.firstReply.current).toBeNull()
    expect(result.projects).toHaveLength(2)
  })

  it('states the 7-day window and the one before it', () => {
    const { week } = assembleOverview(raw())
    expect(week.to).toBe('2026-11-01T12:00:00.000Z')
    expect(week.from).toBe('2026-10-25T12:00:00.000Z')
    expect(week.previousFrom).toBe('2026-10-18T12:00:00.000Z')
  })

  it('sums volumes over the projects in view and keeps the split', () => {
    const { week } = assembleOverview(
      raw({
        conversationWeek: [
          { projectId: 'a', received: 18, receivedPrevious: 15, firstReply: 110, firstReplyPrevious: 120 },
          { projectId: 'b', received: 8, receivedPrevious: 8, firstReply: 190, firstReplyPrevious: 150 },
        ],
        firstReplyTotal: { current: 130, previous: 125 },
        postsWeek: [
          { projectId: 'a', current: 7, previous: 9 },
          { projectId: 'b', current: 3, previous: 4 },
        ],
        votesWeek: [{ projectId: 'a', current: 96, previous: 80 }],
      })
    )
    expect(week.received).toEqual({ available: true, current: 26, previous: 23, byProject: { a: 18, b: 8 } })
    expect(week.posts).toMatchObject({ current: 10, previous: 13 })
    expect(week.votes).toMatchObject({ current: 96, previous: 80, byProject: { a: 96 } })
    // The overall median comes from the query, not from averaging the per-project medians
    expect(week.firstReply.current).toBe(130)
    expect(week.firstReply.previous).toBe(125)
    expect(week.firstReply.slowest).toMatchObject({ minutes: 190, project: { id: 'b' } })
  })

  it('ignores a tool that is off in a project', () => {
    const result = assembleOverview(
      raw({
        projects: [project('a', { inboxOn: false, feedbackOn: false, changelogOn: false }), project('b')],
        conversationCounts: [
          { projectId: 'a', waiting: 4, waitingOther: 3, atRisk: 1 },
          { projectId: 'b', waiting: 2, waitingOther: 2, atRisk: 0 },
        ],
        conversationWeek: [{ projectId: 'a', received: 9, receivedPrevious: 1, firstReply: 5, firstReplyPrevious: 5 }],
        postsWeek: [{ projectId: 'a', current: 5, previous: 5 }],
        statusCounts: [{ projectId: 'a', status: 'open', count: 6 }],
        drafts: [{ id: 'd1', projectId: 'a', title: 'Hidden', createdAt: NOW }],
        draftTotal: 1,
        releases: [{ projectId: 'a', title: 'Old', publishedAt: NOW }],
      })
    )
    expect(result.needsYou.waiting.total).toBe(2)
    expect(result.needsYou.slaAtRisk.total).toBe(0)
    expect(result.needsYou.untriaged.total).toBe(0)
    expect(result.needsYou.drafts.items).toEqual([])
    expect(result.week.received.current).toBe(0)
    expect(result.week.posts.current).toBe(0)
    const rowA = result.projects.find((p) => p.project.id === 'a')!
    expect(rowA).toMatchObject({
      tools: { inbox: false, feedback: false, changelog: false },
      waiting: 0,
      newFeedback: 0,
      lastRelease: null,
    })
  })

  it('marks a metric unavailable when no project in view has its tool on', () => {
    const { week } = assembleOverview(
      raw({
        projects: [project('a', { inboxOn: false, feedbackOn: true })],
        firstReplyTotal: { current: 30, previous: 40 },
      })
    )
    expect(week.received.available).toBe(false)
    expect(week.firstReply).toMatchObject({ available: false, current: null, previous: null })
    expect(week.posts.available).toBe(true)
  })

  it('leaves inboxes the user cannot work in out of the numbers', () => {
    const result = assembleOverview(
      raw({
        projects: [project('a', { inboxAccess: false }), project('b')],
        conversationCounts: [
          { projectId: 'a', waiting: 5, waitingOther: 5, atRisk: 2 },
          { projectId: 'b', waiting: 1, waitingOther: 1, atRisk: 0 },
        ],
        slaItems: [
          {
            conversationId: 'c1',
            inboxId: 'i1',
            projectId: 'a',
            subject: 'x',
            contactName: 'X',
            contactEmail: null,
            dueAt: NOW,
          },
        ],
      })
    )
    expect(result.needsYou.waiting.total).toBe(1)
    expect(result.needsYou.slaAtRisk).toEqual({ total: 0, items: [] })
    expect(result.projects[0]).toMatchObject({ inboxAccess: false, waiting: 0, slaAtRisk: 0 })
  })

  it('lists SLA conversations most urgent first, capped, falling back to the email for a nameless contact', () => {
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
    const item = (id: string, minutes: number, name: string | null) => ({
      conversationId: id,
      inboxId: 'i',
      projectId: 'a',
      subject: id,
      contactName: name,
      contactEmail: `${id}@example.com`,
      dueAt: at(minutes),
    })
    const result = assembleOverview(
      raw({
        conversationCounts: [{ projectId: 'a', waiting: 7, waitingOther: 0, atRisk: 7 }],
        slaItems: [
          item('c1', 40, 'One'),
          item('c2', -10, null),
          item('c3', 5, 'Three'),
          item('c4', 50, 'Four'),
          item('c5', 20, 'Five'),
          item('c6', 55, 'Six'),
        ],
      })
    )
    expect(result.needsYou.slaAtRisk.total).toBe(7)
    expect(result.needsYou.slaAtRisk.items.map((i) => i.conversationId)).toEqual(['c2', 'c3', 'c5', 'c1', 'c4'])
    expect(result.needsYou.slaAtRisk.items[0]!.contactName).toBe('c2@example.com')
  })

  it('counts waiting conversations per project, excluding the SLA ones, and picks the oldest', () => {
    const result = assembleOverview(
      raw({
        conversationCounts: [
          { projectId: 'a', waiting: 4, waitingOther: 3, atRisk: 1 },
          { projectId: 'b', waiting: 0, waitingOther: 0, atRisk: 0 },
        ],
        oldestWaiting: [
          {
            conversationId: 'c1',
            inboxId: 'ia',
            projectId: 'a',
            subject: 'Newer',
            since: new Date('2026-11-01T08:00:00Z'),
          },
          {
            conversationId: 'c2',
            inboxId: 'ib',
            projectId: 'b',
            subject: 'Older',
            since: new Date('2026-10-30T08:00:00Z'),
          },
        ],
      })
    )
    expect(result.needsYou.waiting.total).toBe(3)
    expect(result.needsYou.waiting.byProject).toEqual([
      { project: { id: 'a', name: 'Project a', slug: 'a' }, count: 3 },
    ])
    expect(result.needsYou.waiting.oldest).toMatchObject({ conversationId: 'c2', project: { id: 'b' } })
    // The Projects table counts everything waiting, SLA ones included
    expect(result.projects[0]).toMatchObject({ waiting: 4, slaAtRisk: 1 })
  })

  it('counts untriaged posts on each project’s own default status', () => {
    const result = assembleOverview(
      raw({
        projects: [project('a'), project('b'), project('c')],
        defaultStatuses: [
          { projectId: 'a', value: 'new', name: 'New' },
          { projectId: 'a', value: 'open', name: 'Open' },
        ],
        statusCounts: [
          { projectId: 'a', status: 'new', count: 4 },
          { projectId: 'a', status: 'open', count: 9 },
          // b has no default status: posts start on `open`
          { projectId: 'b', status: 'open', count: 2 },
          { projectId: 'b', status: 'new', count: 7 },
        ],
      })
    )
    expect(result.needsYou.untriaged.total).toBe(6)
    expect(result.needsYou.untriaged.byProject).toEqual([
      { project: { id: 'a', name: 'Project a', slug: 'a' }, count: 4, statusValue: 'new', statusName: 'New' },
      { project: { id: 'b', name: 'Project b', slug: 'b' }, count: 2, statusValue: 'open', statusName: 'Open' },
    ])
  })

  it('lists changelog drafts newest first and the last release per project', () => {
    const result = assembleOverview(
      raw({
        drafts: [
          { id: 'd1', projectId: 'a', title: 'Older', createdAt: new Date('2026-10-12T00:00:00Z') },
          { id: 'd2', projectId: 'b', title: 'Newer', createdAt: new Date('2026-10-30T00:00:00Z') },
        ],
        draftTotal: 2,
        releases: [
          { projectId: 'a', title: 'v1', publishedAt: new Date('2026-10-20T00:00:00Z') },
          { projectId: 'b', title: 'Draft-ish', publishedAt: null },
        ],
      })
    )
    expect(result.needsYou.drafts.total).toBe(2)
    expect(result.needsYou.drafts.items.map((d) => d.id)).toEqual(['d2', 'd1'])
    expect(result.projects[0]!.lastRelease).toEqual({ title: 'v1', publishedAt: '2026-10-20T00:00:00.000Z' })
    expect(result.projects[1]!.lastRelease).toBeNull()
  })
})
