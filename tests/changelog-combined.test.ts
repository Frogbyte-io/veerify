import { describe, expect, it } from 'vitest'
import { changelogEntryPath, pickNewEntryProject } from '~/lib/changelog-combined'

const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]

describe('pickNewEntryProject', () => {
  it('prefers the last used project', () => {
    expect(pickNewEntryProject(projects, 'p3', 'p2')?.id).toBe('p3')
  })

  it('falls back to the active project when the last used one is gone or unset', () => {
    expect(pickNewEntryProject(projects, 'gone', 'p2')?.id).toBe('p2')
    expect(pickNewEntryProject(projects, null, 'p2')?.id).toBe('p2')
  })

  it('falls back to the first project, and to null with none', () => {
    expect(pickNewEntryProject(projects, null, 'other')?.id).toBe('p1')
    expect(pickNewEntryProject([], 'p1', 'p1')).toBeNull()
  })
})

describe('changelogEntryPath', () => {
  it('names the project in the link when given', () => {
    expect(changelogEntryPath('e1', 'p 1')).toBe('/dashboard/changelog/e1?project=p%201')
    expect(changelogEntryPath('new')).toBe('/dashboard/changelog/new')
  })
})
