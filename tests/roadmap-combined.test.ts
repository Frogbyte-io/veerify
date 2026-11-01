import { describe, expect, it } from 'vitest'
import {
  canMoveToColumn,
  mergeRoadmapColumns,
  mergeStatusOrder,
  sortRoadmapItems,
  type RoadmapStatus,
} from '~/lib/roadmap-combined'

const status = (value: string, sortOrder: number, name = value, color: string | null = '#000000'): RoadmapStatus => ({
  value,
  name,
  color,
  sortOrder,
})
const item = (id: string, st: string, voteCount = 0, isPinned = false) => ({
  id,
  status: st,
  voteCount,
  isPinned,
})
const A = { id: 'a', name: 'Alpha', slug: 'alpha' }
const B = { id: 'b', name: 'Beta Co', slug: 'beta-co' }

describe('mergeStatusOrder', () => {
  it('keeps the first project order and places a new status before its next known one', () => {
    const first = [status('open', 0), status('planned', 1), status('in_progress', 2), status('done', 3)]
    const second = [status('open', 0), status('planned', 1), status('beta', 2), status('done', 3)]
    expect(mergeStatusOrder([first, second])).toEqual(['open', 'planned', 'in_progress', 'beta', 'done'])
  })

  it('appends a status with no known successor and reads sort order, not array order', () => {
    const first = [status('open', 0), status('done', 1)]
    const second = [status('extra', 2), status('open', 0)]
    expect(mergeStatusOrder([first, second])).toEqual(['open', 'done', 'extra'])
  })

  it('is empty without projects', () => {
    expect(mergeStatusOrder([])).toEqual([])
  })
})

describe('mergeRoadmapColumns', () => {
  const boards = () => [
    {
      project: A,
      statuses: [status('open', 0, 'Open', '#111111'), status('planned', 1, 'Planned', '#222222')],
      items: [item('a1', 'planned', 5), item('a2', 'open', 1)],
    },
    {
      project: B,
      statuses: [
        status('open', 0, 'New', '#999999'),
        status('planned', 1, 'Roadmap', '#888888'),
        status('beta', 2, 'Beta', '#777777'),
      ],
      items: [item('b1', 'planned', 9), item('b2', 'beta', 2), item('b3', 'planned', 1)],
    },
  ]

  it('merges columns by status value and lets the first project name and colour win', () => {
    const columns = mergeRoadmapColumns(boards())
    expect(columns.map((c) => c.value)).toEqual(['open', 'planned', 'beta'])
    const planned = columns.find((c) => c.value === 'planned')!
    expect(planned.name).toBe('Planned')
    expect(planned.color).toBe('#222222')
    expect(planned.projectIds).toEqual(['a', 'b'])
    expect(planned.onlyProject).toBeNull()
  })

  it('marks a status only one project has and tags every item with its project', () => {
    const columns = mergeRoadmapColumns(boards())
    const beta = columns.find((c) => c.value === 'beta')!
    expect(beta.onlyProject).toEqual(B)
    expect(beta.items.map((i) => [i.id, i.project.id])).toEqual([['b2', 'b']])
    expect(columns.find((c) => c.value === 'open')!.onlyProject).toBeNull()
  })

  it('sorts a merged column by pinned, then votes, across projects', () => {
    const input = boards()
    input[0]!.items.push(item('a3', 'planned', 0, true))
    const planned = mergeRoadmapColumns(input).find((c) => c.value === 'planned')!
    expect(planned.items.map((i) => i.id)).toEqual(['a3', 'b1', 'a1', 'b3'])
  })

  it('marks nothing as "only" with a single project', () => {
    const columns = mergeRoadmapColumns([boards()[1]!])
    expect(columns.every((c) => c.onlyProject === null)).toBe(true)
  })

  it('drops items whose status the project no longer defines, like the single-project board', () => {
    const input = boards()
    input[0]!.items.push(item('stray', 'archived'))
    const ids = mergeRoadmapColumns(input).flatMap((c) => c.items.map((i) => i.id))
    expect(ids).not.toContain('stray')
  })

  it('returns no columns without projects', () => {
    expect(mergeRoadmapColumns([])).toEqual([])
  })
})

describe('canMoveToColumn', () => {
  it('only allows an item into a column its project has', () => {
    const beta = mergeRoadmapColumns([
      { project: A, statuses: [status('open', 0)], items: [] },
      { project: B, statuses: [status('open', 0), status('beta', 1)], items: [] },
    ]).find((c) => c.value === 'beta')!
    expect(canMoveToColumn(beta, 'b')).toBe(true)
    expect(canMoveToColumn(beta, 'a')).toBe(false)
  })
})

describe('sortRoadmapItems', () => {
  it('does not mutate its input', () => {
    const items = [item('x', 's', 1), item('y', 's', 2)]
    sortRoadmapItems(items)
    expect(items.map((i) => i.id)).toEqual(['x', 'y'])
  })
})
