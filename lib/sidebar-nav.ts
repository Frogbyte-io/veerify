/**
 * Declarative sidebar visibility model.
 *
 * Every group and item states what it needs (`requiresOrg`, `module`, ...) and
 * `getVisibleNavGroups()` is the single place that decides whether it shows.
 * A group's requirements apply to all of its items, and a group with no
 * visible items is dropped, so empty headings never render.
 *
 * Tools are switched per project: `modules` is the active project's resolved
 * tool switches, `productCount` its number of products and `isProjectAdmin`
 * whether the user can change project settings.
 */
import { MODULE_KEYS, type ModuleKey } from '~/lib/modules'

/** `null` while the active organization is still loading (ProjectSwitcher). */
export type OrgState = boolean | null

export interface SidebarVisibilityRule {
  /**
   * Needs an active organization. Strict by default: hidden while the
   * organization is loading (`null`) as well as for personal accounts.
   */
  requiresOrg?: boolean
  /** With `requiresOrg`, also show while the organization is still loading. */
  showWhileOrgLoading?: boolean
  /** Hidden unless this tool is enabled for the active project. */
  module?: ModuleKey
  /** Hidden unless the user is an admin of the active project. */
  requiresProjectAdmin?: boolean
  /** Hidden when every tool is already switched on (nothing left to add). */
  requiresDisabledModule?: boolean
}

export interface SidebarNavItem extends SidebarVisibilityRule {
  title: string
  url: string
  icon: string
  /** Renders one sub-item per product (`<url>?product=<slug>`), only when the project has more than one. */
  productSubItems?: boolean
}

export interface SidebarNavGroup extends SidebarVisibilityRule {
  id: string
  label: string
  items: SidebarNavItem[]
  testId?: string
  /** Rendered as a collapsible section (e.g. Marketing's many sub-pages). */
  collapsible?: boolean
  /** Icon for a collapsible group's header. */
  icon?: string
}

export interface SidebarVisibilityContext {
  hasActiveOrganization: OrgState
  modules: Partial<Record<ModuleKey, boolean>>
  /** Number of products in the active project; `0` while unknown. */
  productCount: number
  isProjectAdmin: boolean
}

export function isNavEntryVisible(rule: SidebarVisibilityRule, ctx: SidebarVisibilityContext): boolean {
  if (rule.requiresOrg) {
    const orgOk =
      ctx.hasActiveOrganization === true || (rule.showWhileOrgLoading === true && ctx.hasActiveOrganization === null)
    if (!orgOk) return false
  }
  if (rule.module && !ctx.modules[rule.module]) return false
  if (rule.requiresProjectAdmin && !ctx.isProjectAdmin) return false
  if (rule.requiresDisabledModule && !MODULE_KEYS.some((key) => !ctx.modules[key])) return false
  return true
}

/** Whether per-product sub-items should render (single-product projects hide the product layer). */
export function showProductSubItems(ctx: Pick<SidebarVisibilityContext, 'productCount'>): boolean {
  return ctx.productCount > 1
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
    id: 'project',
    label: 'Project',
    requiresOrg: true,
    items: [
      // Shown while loading to avoid layout jump.
      {
        title: 'Overview',
        url: '/dashboard',
        icon: 'lucide:layout-dashboard',
        requiresOrg: true,
        showWhileOrgLoading: true,
      },
      {
        title: 'Feedback',
        url: '/feedback',
        icon: 'lucide:message-square',
        module: 'feedbackEnabled',
        productSubItems: true,
      },
      { title: 'Roadmap', url: '/dashboard/roadmap', icon: 'lucide:map', module: 'roadmapEnabled' },
      { title: 'Changelog', url: '/dashboard/changelog', icon: 'lucide:scroll-text', module: 'changelogEnabled' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: 'lucide:megaphone',
    requiresOrg: true,
    module: 'marketingEnabled',
    collapsible: true,
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
    id: 'support',
    label: 'Support',
    requiresOrg: true,
    module: 'supportEnabled',
    items: [
      { title: 'Inbox', url: '/support', icon: 'lucide:inbox' },
      { title: 'Contacts', url: '/support/contacts', icon: 'lucide:contact' },
      { title: 'Settings', url: '/support/settings', icon: 'lucide:settings' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    requiresOrg: true,
    items: [
      { title: 'Project settings', url: '/project/settings', icon: 'lucide:sliders-horizontal' },
      {
        title: 'Add tool',
        url: '/project/settings#tools',
        icon: 'lucide:plus',
        requiresProjectAdmin: true,
        requiresDisabledModule: true,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    requiresOrg: true,
    items: [{ title: 'Workspace settings', url: '/workspace', icon: 'lucide:building-2' }],
  },
  {
    id: 'you',
    label: 'You',
    items: [
      { title: 'My submissions', url: '/submissions', icon: 'lucide:list' },
      { title: 'Notifications', url: '/settings#notifications', icon: 'lucide:bell' },
      { title: 'Settings', url: '/settings', icon: 'lucide:settings' },
    ],
  },
]
