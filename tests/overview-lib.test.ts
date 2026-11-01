import { describe, expect, it } from 'vitest'
import { buildTodos, dueLabel, formatDelta, formatMinutes, plural } from '~/lib/overview'
import type { OverviewResponse } from '~/lib/overview'

const NOW = new Date('2026-11-01T12:00:00Z')
const ref = (id: string) => ({ id, name: `Project ${id}`, slug: id })
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString()

const empty = (): OverviewResponse['needsYou'] => ({
  slaAtRisk: { total: 0, items: [] },
  waiting: { total: 0, byProject: [], oldest: null },
  untriaged: { total: 0, byProject: [] },
  drafts: { total: 0, items: [] },
})

describe('formatMinutes', () => {
  it('reads like a duration', () => {
    expect(formatMinutes(null)).toBe('–')
    expect(formatMinutes(0)).toBe('<1m')
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(120)).toBe('2h')
    expect(formatMinutes(190)).toBe('3h 10m')
    expect(formatMinutes(60 * 72)).toBe('3d')
  })
})

describe('formatDelta', () => {
  it('compares with the previous 7 days and keeps volumes neutral', () => {
    expect(formatDelta(18, 15)).toEqual({ arrow: '↑', text: '20% vs previous 7 days', tone: 'neutral' })
    expect(formatDelta(7, 9)).toEqual({ arrow: '↓', text: '22% vs previous 7 days', tone: 'neutral' })
    expect(formatDelta(8, 8).text).toBe('No change vs previous 7 days')
  })

  it('colours reply time only: faster is good, slower is bad', () => {
    expect(formatDelta(100, 120, true).tone).toBe('good')
    expect(formatDelta(150, 120, true).tone).toBe('bad')
  })

  it('does not divide by zero or invent a percentage', () => {
    expect(formatDelta(5, 0)).toMatchObject({ arrow: '↑', text: 'from 0 in the previous 7 days' })
    expect(formatDelta(0, 0).text).toBe('No change vs previous 7 days')
    expect(formatDelta(5, null).text).toBe('Nothing to compare in the previous 7 days')
    expect(formatDelta(null, 5).text).toBe('')
    // 0.4% rounds to nothing: say so rather than "↑ 0%"
    expect(formatDelta(1004, 1000).text).toBe('No change vs previous 7 days')
  })
})

describe('dueLabel', () => {
  it('says when the SLA runs out or ran out', () => {
    expect(dueLabel(minutesFromNow(12), NOW)).toBe('runs out in 12 minutes')
    expect(dueLabel(minutesFromNow(1), NOW)).toBe('runs out in 1 minute')
    expect(dueLabel(minutesFromNow(-25), NOW)).toBe('ran out 25 minutes ago')
    expect(dueLabel(minutesFromNow(-180), NOW)).toBe('ran out 3 hours ago')
    expect(dueLabel(minutesFromNow(0), NOW)).toBe('is about to run out')
  })
})

describe('plural', () => {
  it('picks the form', () => {
    expect(plural(1, 'post has', 'posts have')).toBe('1 post has')
    expect(plural(3, 'post has', 'posts have')).toBe('3 posts have')
  })
})

describe('buildTodos', () => {
  it('is empty when nothing needs a person', () => {
    expect(buildTodos(empty(), { allProjects: false, now: NOW })).toEqual([])
  })

  it('orders SLA, waiting, untriaged, then drafts, each with one action', () => {
    const needsYou: OverviewResponse['needsYou'] = {
      slaAtRisk: {
        total: 1,
        items: [
          {
            conversationId: 'c1',
            inboxId: 'i1',
            subject: 'Refund',
            contactName: 'Marta',
            dueAt: minutesFromNow(12),
            project: ref('a'),
          },
        ],
      },
      waiting: {
        total: 4,
        byProject: [
          { project: ref('a'), count: 3 },
          { project: ref('b'), count: 1 },
        ],
        oldest: {
          conversationId: 'c2',
          inboxId: 'i1',
          subject: 'Old one',
          since: NOW.toISOString(),
          project: ref('a'),
        },
      },
      untriaged: {
        total: 5,
        byProject: [{ project: ref('b'), count: 5, statusValue: 'new', statusName: 'New' }],
      },
      drafts: {
        total: 1,
        items: [{ id: 'd1', title: 'Faster imports', createdAt: '2026-10-12T00:00:00Z', project: ref('b') }],
      },
    }
    const todos = buildTodos(needsYou, { allProjects: true, now: NOW, activeProjectId: 'a' })
    expect(todos.map((t) => t.key)).toEqual(['sla-c1', 'waiting', 'untriaged', 'draft-d1'])
    expect(todos[0]).toMatchObject({
      title: 'Reply to Marta: the SLA runs out in 12 minutes',
      action: { label: 'Reply', to: '/inbox?inboxId=i1&conversationId=c1' },
      primary: true,
    })
    expect(todos[1]).toMatchObject({
      title: '4 conversations are waiting for a reply',
      action: { label: 'Open inbox' },
    })
    expect(todos[1]!.breakdown).toHaveLength(2)
    // Only one project is stuck: open its board on that status
    expect(todos[2]).toMatchObject({
      title: '5 feedback posts have no status yet',
      action: { label: 'Triage', to: '/feedback?status=new&projects=b' },
    })
    // The draft's project is not the active one: its tools need that project
    expect(todos[3]!.action).toEqual({
      label: 'Review draft',
      to: '/dashboard/changelog/d1',
      switchProjectId: 'b',
    })
  })

  it('shows the oldest waiting conversation in a single project instead of a breakdown', () => {
    const needsYou = empty()
    needsYou.waiting = {
      total: 1,
      byProject: [{ project: ref('a'), count: 1 }],
      oldest: { conversationId: 'c2', inboxId: 'i1', subject: 'Old one', since: NOW.toISOString(), project: ref('a') },
    }
    const [todo] = buildTodos(needsYou, { allProjects: false, now: NOW })
    expect(todo).toMatchObject({ title: '1 conversation is waiting for a reply', lead: 'Oldest:', quote: 'Old one' })
    expect(todo!.breakdown).toBeUndefined()
  })

  it('opens the plain board when several projects are untriaged, and does not switch for the active project', () => {
    const needsYou = empty()
    needsYou.untriaged = {
      total: 3,
      byProject: [
        { project: ref('a'), count: 2, statusValue: 'open', statusName: 'Open' },
        { project: ref('b'), count: 1, statusValue: 'new', statusName: 'New' },
      ],
    }
    needsYou.drafts = {
      total: 1,
      items: [{ id: 'd1', title: 'Notes', createdAt: '2026-10-12T00:00:00Z', project: ref('a') }],
    }
    const todos = buildTodos(needsYou, { allProjects: true, now: NOW, activeProjectId: 'a' })
    expect(todos[0]!.action.to).toBe('/feedback')
    expect(todos[1]!.action.switchProjectId).toBeUndefined()
  })

  it('adds a row for conversations and drafts beyond the listed ones', () => {
    const needsYou = empty()
    needsYou.slaAtRisk = { total: 7, items: [] }
    needsYou.drafts = { total: 3, items: [] }
    const todos = buildTodos(needsYou, { allProjects: false, now: NOW })
    expect(todos.map((t) => t.title)).toEqual([
      '7 more conversations are about to breach the SLA',
      '3 more changelog drafts are waiting to be published',
    ])
  })
})
