import { describe, expect, it } from 'vitest'
import {
  defaultCreateProjectId,
  mergeScopeStatuses,
  projectStatus,
  type FeedbackScopeProject,
} from '~/lib/feedback-scope'
import { statusesByProject } from '~/server/utils/feedback-scope'

const status = (value: string, name: string, sortOrder: number, color: string | null = null) => ({
  value,
  name,
  color,
  sortOrder,
  isDefault: sortOrder === 0,
})

const project = (id: string, statuses: ReturnType<typeof status>[]): FeedbackScopeProject => ({
  id,
  feedbackCount: 0,
  products: [],
  statuses,
})

describe('mergeScopeStatuses', () => {
  it('unions statuses by value; the first project names and colours a shared status', () => {
    const merged = mergeScopeStatuses([
      project('a', [status('open', 'Open', 0, '#3b82f6'), status('planned', 'Planned', 1)]),
      project('b', [status('open', 'New', 0, '#000000'), status('beta', 'In beta', 1)]),
    ])
    expect(merged.map((s) => s.value)).toEqual(['open', 'planned', 'beta'])
    expect(merged[0]).toMatchObject({ name: 'Open', color: '#3b82f6', projectIds: ['a', 'b'] })
    expect(merged[2]).toMatchObject({ name: 'In beta', projectIds: ['b'] })
  })

  it('orders by the lowest sort order, then first appearance', () => {
    const merged = mergeScopeStatuses([
      project('a', [status('open', 'Open', 0), status('done', 'Done', 5)]),
      project('b', [status('beta', 'Beta', 2), status('done', 'Done', 1)]),
    ])
    expect(merged.map((s) => s.value)).toEqual(['open', 'done', 'beta'])
  })

  it('is empty without projects', () => {
    expect(mergeScopeStatuses([])).toEqual([])
  })
})

describe('projectStatus', () => {
  const projects = [project('a', [status('open', 'Open', 0)]), project('b', [status('beta', 'Beta', 0, '#111111')])]

  it("returns the item's own project's status", () => {
    expect(projectStatus(projects, 'b', 'beta')).toMatchObject({ name: 'Beta', color: '#111111' })
  })

  it('is null when that project has no such status', () => {
    expect(projectStatus(projects, 'a', 'beta')).toBeNull()
    expect(projectStatus(projects, 'missing', 'open')).toBeNull()
  })
})

describe('defaultCreateProjectId', () => {
  it('prefers the last used project, then the active one, then the first', () => {
    expect(defaultCreateProjectId(['a', 'b', 'c'], 'c', 'b')).toBe('c')
    expect(defaultCreateProjectId(['a', 'b', 'c'], 'gone', 'b')).toBe('b')
    expect(defaultCreateProjectId(['a', 'b', 'c'], null, 'gone')).toBe('a')
    expect(defaultCreateProjectId([], 'a', 'a')).toBe('')
  })
})

describe('statusesByProject', () => {
  it('uses custom statuses in display order, and system statuses for projects without any', () => {
    const result = statusesByProject(
      [
        { projectId: 'a', value: 'done', name: 'Done', color: null, sortOrder: 2, isDefault: false },
        { projectId: 'a', value: 'new', name: 'New', color: '#fff', sortOrder: 0, isDefault: true },
      ],
      ['a', 'b']
    )
    expect(result.a!.map((s) => s.value)).toEqual(['new', 'done'])
    expect(result.b!.map((s) => s.value)).toEqual(['open', 'planned', 'in_progress', 'completed', 'closed'])
  })
})
