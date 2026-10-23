import { describe, expect, it } from 'vitest'
import { shouldLeaveRouteOnOrgSwitch } from '~/lib/org-switch'

describe('shouldLeaveRouteOnOrgSwitch', () => {
  it('keeps top-level, dashboard and settings pages', () => {
    for (const path of ['/dashboard', '/support', '/feedback?x=1', '/dashboard/roadmap', '/settings#profile']) {
      expect(shouldLeaveRouteOnOrgSwitch(path)).toBe(false)
    }
  })

  it('leaves record/detail pages', () => {
    expect(shouldLeaveRouteOnOrgSwitch('/support/conv-1')).toBe(true)
    expect(shouldLeaveRouteOnOrgSwitch('/feedback/abc')).toBe(true)
  })
})
