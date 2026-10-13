/**
 * Declarative sidebar visibility model.
 *
 * Every group and item states what it needs (`requiresOrg`, `module`) and
 * `getVisibleNavGroups()` is the single place that decides whether it shows.
 * A group's requirements apply to all of its items, and a group with no
 * visible items is dropped, so empty headings never render.
 */
import type { ModuleKey } from '~/lib/modules'

/** `null` while the active organization is still loading (TeamSwitcher). */
export type OrgState = boolean | null

export interface SidebarVisibilityRule {
  /**
   * Needs an active organization. Strict by default: hidden while the
   * organization is loading (`null`) as well as for personal accounts.
   */
  requiresOrg?: boolean
  /** With `requiresOrg`, also show while the organization is still loading. */
  showWhileOrgLoading?: boolean
  /** Hidden unless this module is enabled for the active team. */
  module?: ModuleKey
}

export interface SidebarNavItem extends SidebarVisibilityRule {
  title: string
  url: string
  icon: string
}

export interface SidebarNavGroup extends SidebarVisibilityRule {
  id: string
  label: string
  items: SidebarNavItem[]
  testId?: string
}

export interface SidebarVisibilityContext {
  hasActiveOrganization: OrgState
  modules: Partial<Record<ModuleKey, boolean>>
}

export function isNavEntryVisible(rule: SidebarVisibilityRule, ctx: SidebarVisibilityContext): boolean {
  if (rule.requiresOrg) {
    const orgOk =
      ctx.hasActiveOrganization === true || (rule.showWhileOrgLoading === true && ctx.hasActiveOrganization === null)
    if (!orgOk) return false
  }
  if (rule.module && !ctx.modules[rule.module]) return false
  return true
}

/** Resolves which groups and items to render; groups left empty are removed. */
export function getVisibleNavGroups(
  groups: readonly SidebarNavGroup[],
  ctx: SidebarVisibilityContext
): SidebarNavGroup[] {
  const visible: SidebarNavGroup[] = []
  for (const group of groups) {
    if (!isNavEntryVisible(group, ctx)) continue
    const items = group.items.filter((item) => isNavEntryVisible(item, ctx))
    if (items.length > 0) visible.push({ ...group, items })
  }
  return visible
}

export const SIDEBAR_NAV_GROUPS: readonly SidebarNavGroup[] = [
  {
    id: 'personal',
    label: 'Personal',
    items: [
      // Only meaningful in workspace context; shown while loading to avoid layout jump.
      {
        title: 'Dashboard',
        url: '/dashboard',
        icon: 'lucide:layout-dashboard',
        requiresOrg: true,
        showWhileOrgLoading: true,
      },
      { title: 'My Submissions', url: '/submissions', icon: 'lucide:list' },
      { title: 'Notifications', url: '/settings#notifications', icon: 'lucide:bell' },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedback',
    requiresOrg: true,
    items: [
      { title: 'Feedback', url: '/feedback', icon: 'lucide:message-square', module: 'feedbackEnabled' },
      { title: 'Roadmap', url: '/dashboard/roadmap', icon: 'lucide:map', module: 'roadmapEnabled' },
      { title: 'Changelog', url: '/dashboard/changelog', icon: 'lucide:scroll-text', module: 'changelogEnabled' },
    ],
  },
  {
    id: 'management',
    label: 'Management',
    requiresOrg: true,
    items: [
      { title: 'Products', url: '/products', icon: 'lucide:package' },
      { title: 'Members', url: '/settings#organization', icon: 'lucide:user-plus' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    requiresOrg: true,
    module: 'supportEnabled',
    items: [
      { title: 'Inbox', url: '/support', icon: 'lucide:inbox' },
      { title: 'Contacts', url: '/support/contacts', icon: 'lucide:contact' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    requiresOrg: true,
    module: 'marketingEnabled',
    testId: 'sidebar-marketing-group',
    items: [
      { title: 'Overview', url: '/marketing', icon: 'lucide:megaphone' },
      { title: 'Site audit', url: '/marketing/audit', icon: 'lucide:search-check' },
      { title: 'AI visibility', url: '/marketing/ai-visibility', icon: 'lucide:sparkles' },
      { title: 'Search', url: '/marketing/search', icon: 'lucide:chart-line' },
      { title: 'Mentions', url: '/marketing/mentions', icon: 'lucide:at-sign' },
      { title: 'Announcements', url: '/marketing/announcements', icon: 'lucide:send' },
      { title: 'Reviews', url: '/marketing/reviews', icon: 'lucide:star' },
      { title: 'Competitors', url: '/marketing/competitors', icon: 'lucide:binoculars' },
      { title: 'Launch kit', url: '/marketing/launch', icon: 'lucide:rocket' },
      { title: 'Customer language', url: '/marketing/language', icon: 'lucide:message-square-quote' },
      { title: 'Settings', url: '/marketing/settings', icon: 'lucide:sliders-horizontal' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [{ title: 'Settings', url: '/settings', icon: 'lucide:settings' }],
  },
]
