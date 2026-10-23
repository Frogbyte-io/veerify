import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_MODULES, type ModuleSettings } from '~/lib/modules'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups, showProductSubItems, type OrgState } from '~/lib/sidebar-nav'

function visible(
  org: OrgState,
  modules: Partial<ModuleSettings> = {},
  extra: { productCount?: number; isProjectAdmin?: boolean } = {}
) {
  const groups = getVisibleNavGroups(SIDEBAR_NAV_GROUPS, {
    hasActiveOrganization: org,
    modules: { ...DEFAULT_PROJECT_MODULES, ...modules },
    productCount: extra.productCount ?? 1,
    isProjectAdmin: extra.isProjectAdmin ?? false,
  })
  return Object.fromEntries(groups.map((g) => [g.id, g.items.map((i) => i.title)]))
}

describe('sidebar nav visibility', () => {
  it('shows only the personal group for an account without a workspace', () => {
    expect(visible(false)).toEqual({ you: ['My submissions', 'Notifications', 'Settings'] })
  })

  it('hides workspace groups while the org is loading', () => {
    expect(visible(null)).toEqual({ you: ['My submissions', 'Notifications', 'Settings'] })
  })

  it('shows the default project nav (feedback only, no support/marketing)', () => {
    expect(visible(true)).toEqual({
      project: ['Overview', 'Feedback'],
      manage: ['Project settings'],
      workspace: ['Workspace settings'],
      you: ['My submissions', 'Notifications', 'Settings'],
    })
  })

  it('toggles roadmap and changelog independently', () => {
    expect(visible(true, { roadmapEnabled: true }).project).toEqual(['Overview', 'Feedback', 'Roadmap'])
    expect(visible(true, { changelogEnabled: true }).project).toEqual(['Overview', 'Feedback', 'Changelog'])
  })

  it('drops Feedback when its tool is off but keeps Overview', () => {
    expect(visible(true, { feedbackEnabled: false }).project).toEqual(['Overview'])
  })

  it('gates support and marketing groups on their tools', () => {
    const on = visible(true, { supportEnabled: true, marketingEnabled: true })
    expect(on.support).toEqual(['Inbox', 'Contacts'])
    expect(on.marketing?.[0]).toBe('Overview')
    expect(visible(true, { supportEnabled: true }).marketing).toBeUndefined()
  })

  it('never shows tool groups without an org even if tools are on', () => {
    const all = { supportEnabled: true, marketingEnabled: true, roadmapEnabled: true }
    expect(Object.keys(visible(false, all))).toEqual(['you'])
    expect(Object.keys(visible(null, all))).toEqual(['you'])
  })

  it('offers Add tool only to project admins while some tool is off', () => {
    expect(visible(true).manage).toEqual(['Project settings'])
    expect(visible(true, {}, { isProjectAdmin: true }).manage).toEqual(['Project settings', 'Add tool'])
    const allOn = {
      feedbackEnabled: true,
      roadmapEnabled: true,
      changelogEnabled: true,
      supportEnabled: true,
      marketingEnabled: true,
    }
    expect(visible(true, allOn, { isProjectAdmin: true }).manage).toEqual(['Project settings'])
  })

  it('shows per-product sub-items only for projects with more than one product', () => {
    expect(showProductSubItems({ productCount: 0 })).toBe(false)
    expect(showProductSubItems({ productCount: 1 })).toBe(false)
    expect(showProductSubItems({ productCount: 2 })).toBe(true)
  })
})
