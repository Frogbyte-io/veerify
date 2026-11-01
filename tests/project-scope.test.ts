import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCENT_COLOR, PROJECT_PALETTE, projectIdentity, projectInitials } from '~/lib/project-identity'
import {
  isAllProjects,
  isProjectOnlyRoute,
  parseProjectFilter,
  projectFilterParam,
  projectShortcutIndex,
  scopeModules,
  scopeProjects,
  scopeProjectsWithModule,
} from '~/lib/project-scope'

const modules = (on: Partial<Record<string, boolean>>) => ({
  feedbackEnabled: false,
  roadmapEnabled: false,
  changelogEnabled: false,
  supportEnabled: false,
  marketingEnabled: false,
  ...on,
})

const p1 = { id: 'p1', name: 'Dotmatrixlabs', modules: modules({ feedbackEnabled: true, supportEnabled: true }) }
const p2 = { id: 'p2', name: 'Decker', modules: modules({ feedbackEnabled: true, roadmapEnabled: true }) }

function context(scope: 'project' | 'all') {
  return {
    scope,
    project: { id: 'p2', name: 'Decker', slug: 'decker' },
    modules: p2.modules,
    projects: [p1, p2],
  } as never
}

describe('project identity', () => {
  it('uses one or two initials', () => {
    expect(projectInitials('Dotmatrixlabs')).toBe('D')
    expect(projectInitials('dot matrix labs')).toBe('DM')
    expect(projectInitials('')).toBe('?')
  })

  it('takes a changed accent colour, else the palette by position', () => {
    expect(projectIdentity({ name: 'A', settings: { accentColor: '#112233' } }, 0).color).toBe('#112233')
    expect(projectIdentity({ name: 'A', settings: { accentColor: DEFAULT_ACCENT_COLOR } }, 1).color).toBe(
      PROJECT_PALETTE[1]
    )
    expect(projectIdentity({ name: 'A', settings: { accentColor: 'red' } }, 2).color).toBe(PROJECT_PALETTE[2])
    expect(projectIdentity({ name: 'A' }, PROJECT_PALETTE.length).color).toBe(PROJECT_PALETTE[0])
  })

  it('passes the logo through', () => {
    expect(projectIdentity({ name: 'A', settings: { logoUrl: '/logo.png' } }, 0).logoUrl).toBe('/logo.png')
    expect(projectIdentity({ name: 'A' }, 0).logoUrl).toBeNull()
  })
})

describe('scope helpers', () => {
  it('combines every project in All projects and only the active one otherwise', () => {
    expect(isAllProjects(context('all'))).toBe(true)
    expect(scopeProjects(context('all')).map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(scopeProjects(context('project')).map((p) => p.id)).toEqual(['p2'])
    expect(scopeProjectsWithModule(context('all'), 'supportEnabled').map((p) => p.id)).toEqual(['p1'])
  })

  it('unions tool switches only in All projects', () => {
    expect(scopeModules(context('all'))).toMatchObject({
      feedbackEnabled: true,
      roadmapEnabled: true,
      supportEnabled: true,
      marketingEnabled: false,
    })
    expect(scopeModules(context('project'))).toMatchObject({ supportEnabled: false, roadmapEnabled: true })
  })

  it('parses and builds the projects filter', () => {
    expect(parseProjectFilter('a, b,,c')).toEqual(['a', 'b', 'c'])
    expect(parseProjectFilter(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseProjectFilter(undefined)).toEqual([])
    expect(projectFilterParam([])).toBeUndefined()
    expect(projectFilterParam(['a', 'b'])).toBe('a,b')
  })

  it('knows the project-only pages', () => {
    expect(isProjectOnlyRoute('/marketing')).toBe(true)
    expect(isProjectOnlyRoute('/marketing/audit?x=1')).toBe(true)
    expect(isProjectOnlyRoute('/project/settings')).toBe(true)
    expect(isProjectOnlyRoute('/inbox/contacts')).toBe(true)
    expect(isProjectOnlyRoute('/inbox')).toBe(false)
    expect(isProjectOnlyRoute('/marketingx')).toBe(false)
  })

  it('maps Alt+digit to a shortcut index', () => {
    const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
      ({ code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...mods }) as KeyboardEvent
    expect(projectShortcutIndex(key('Digit0'))).toBe(0)
    expect(projectShortcutIndex(key('Digit3'))).toBe(3)
    expect(projectShortcutIndex(key('Digit3', { altKey: false }))).toBeNull()
    expect(projectShortcutIndex(key('Digit3', { metaKey: true }))).toBeNull()
    expect(projectShortcutIndex(key('KeyA'))).toBeNull()
  })
})
