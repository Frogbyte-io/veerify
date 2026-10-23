import { describe, expect, it } from 'vitest'
import { DEFAULT_TEAM_MODULES, type ModuleSettings } from '~/lib/modules'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups, type OrgState } from '~/lib/sidebar-nav'

function visible(org: OrgState, modules: Partial<ModuleSettings> = {}) {
  const groups = getVisibleNavGroups(SIDEBAR_NAV_GROUPS, {
    hasActiveOrganization: org,
    modules: { ...DEFAULT_TEAM_MODULES, ...modules },
  })
  return Object.fromEntries(groups.map((g) => [g.id, g.items.map((i) => i.title)]))
}

describe('sidebar nav visibility', () => {
  it('shows only personal and system for a personal account, without Dashboard', () => {
    expect(visible(false)).toEqual({
      personal: ['My Submissions', 'Notifications'],
      system: ['Settings'],
    })
  })

  it('keeps Dashboard while the org is loading but hides workspace groups', () => {
    expect(visible(null)).toEqual({
      personal: ['Dashboard', 'My Submissions', 'Notifications'],
      system: ['Settings'],
    })
  })

  it('shows default workspace nav for an org (feedback only, no support/marketing)', () => {
    expect(visible(true)).toEqual({
      personal: ['Dashboard', 'My Submissions', 'Notifications'],
      feedback: ['Feedback'],
      management: ['Products', 'Members'],
      system: ['Settings'],
    })
  })

  it('toggles roadmap and changelog independently', () => {
    expect(visible(true, { roadmapEnabled: true }).feedback).toEqual(['Feedback', 'Roadmap'])
    expect(visible(true, { changelogEnabled: true }).feedback).toEqual(['Feedback', 'Changelog'])
  })

  it('drops the feedback group when it has no visible items', () => {
    expect(visible(true, { feedbackEnabled: false }).feedback).toBeUndefined()
    expect(visible(true, { feedbackEnabled: false, roadmapEnabled: true }).feedback).toEqual(['Roadmap'])
  })

  it('gates support and marketing groups on their modules', () => {
    const on = visible(true, { supportEnabled: true, marketingEnabled: true })
    expect(on.support).toEqual(['Inbox', 'Contacts', 'Settings'])
    expect(on.marketing?.[0]).toBe('Overview')
    expect(visible(true, { supportEnabled: true }).marketing).toBeUndefined()
  })

  it('never shows module groups without an org even if modules are on', () => {
    const all = { supportEnabled: true, marketingEnabled: true, roadmapEnabled: true }
    expect(Object.keys(visible(false, all))).toEqual(['personal', 'system'])
    expect(Object.keys(visible(null, all))).toEqual(['personal', 'system'])
  })
})
