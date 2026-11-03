import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_MODULES, type ModuleSettings } from '~/lib/modules'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups } from '~/lib/sidebar-nav'
import {
  activeTabUrl,
  clearMobileHeader,
  mobileShell,
  moreNavGroups,
  navPaths,
  navVisibilityContext,
  pickMobileTabs,
  setMobileHeader,
} from '~/lib/mobile-shell'

function groupsFor(modules: Partial<ModuleSettings> = {}, isProjectAdmin = false) {
  return getVisibleNavGroups(SIDEBAR_NAV_GROUPS, {
    hasActiveOrganization: true,
    modules: { ...DEFAULT_PROJECT_MODULES, ...modules },
    productCount: 1,
    isProjectAdmin,
  })
}

const urls = (tabs: { url: string }[]) => tabs.map((tab) => tab.url)

describe('mobile tabs', () => {
  it('picks Overview, Feedback, Inbox and Roadmap when they are on', () => {
    const tabs = pickMobileTabs(groupsFor({ supportEnabled: true, roadmapEnabled: true, changelogEnabled: true }))
    expect(urls(tabs)).toEqual(['/dashboard', '/feedback', '/inbox', '/dashboard/roadmap'])
  })

  it('falls back to Changelog when Roadmap is off', () => {
    expect(urls(pickMobileTabs(groupsFor({ changelogEnabled: true })))).toEqual([
      '/dashboard',
      '/feedback',
      '/dashboard/changelog',
    ])
  })

  it('leaves out tools that are switched off', () => {
    expect(urls(pickMobileTabs(groupsFor({ feedbackEnabled: false, supportEnabled: true })))).toEqual([
      '/dashboard',
      '/inbox',
    ])
  })

  it('has no tool tabs for an account without a workspace', () => {
    const groups = getVisibleNavGroups(SIDEBAR_NAV_GROUPS, navVisibilityContext(null, false))
    expect(pickMobileTabs(groups)).toEqual([])
    expect(moreNavGroups(groups, []).map((g) => g.id)).toEqual(['you'])
  })

  it('puts everything without a tab under More', () => {
    const groups = groupsFor({ supportEnabled: true, roadmapEnabled: true, changelogEnabled: true }, true)
    const more = moreNavGroups(groups, pickMobileTabs(groups))
    const items = Object.fromEntries(more.map((g) => [g.id, g.items.map((i) => i.url)]))
    expect(items.project).toEqual(['/dashboard/changelog'])
    expect(items.support).toEqual(['/inbox/contacts', '/inbox/settings'])
    expect(items.you).toContain('/settings')
  })
})

describe('active tab', () => {
  const groups = groupsFor({ supportEnabled: true, roadmapEnabled: true, changelogEnabled: true })
  const tabs = pickMobileTabs(groups)
  const paths = navPaths(groups)

  it('matches the longest tab URL', () => {
    expect(activeTabUrl('/dashboard', tabs, paths)).toBe('/dashboard')
    expect(activeTabUrl('/dashboard/roadmap', tabs, paths)).toBe('/dashboard/roadmap')
    expect(activeTabUrl('/feedback/abc', tabs, paths)).toBe('/feedback')
    expect(activeTabUrl('/inbox', tabs, paths)).toBe('/inbox')
  })

  it('selects no tab for pages under More', () => {
    expect(activeTabUrl('/dashboard/changelog', tabs, paths)).toBeNull()
    expect(activeTabUrl('/inbox/settings', tabs, paths)).toBeNull()
    expect(activeTabUrl('/settings', tabs, paths)).toBeNull()
  })
})

describe('mobile header', () => {
  it('belongs to the page that set it', () => {
    const inbox = {}
    const next = {}
    setMobileHeader(inbox, { title: 'Inbox', count: '2' })
    setMobileHeader(next, { title: 'Next' })
    expect(mobileShell.header.count).toBe('')
    clearMobileHeader(inbox)
    expect(mobileShell.header.title).toBe('Next')
    clearMobileHeader(next)
    expect(mobileShell.header.title).toBe('')
  })
})
