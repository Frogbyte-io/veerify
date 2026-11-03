import { reactive } from 'vue'
import type { ActiveProjectContext } from '~/lib/active-project'
import { isAllProjects, scopeModules } from '~/lib/project-scope'
import {
  showProductSubItems,
  type OrgState,
  type SidebarNavGroup,
  type SidebarNavItem,
  type SidebarVisibilityContext,
} from '~/lib/sidebar-nav'

/**
 * Compact shell for phones and tablets (below `lg`, 1024px): one top bar and a bottom tab bar instead of
 * the app sidebar (layouts/dashboard.vue, components/sidebar/Mobile*.vue).
 *
 * Pages customise the top bar through `setMobileHeader(owner, …)` and give it back with
 * `clearMobileHeader(owner)`; the owner (usually the component instance) makes sure a page that
 * unmounts late cannot clear the header the next page has just set.
 */

/**
 * Phones and tablets get the compact shell; mirrors Tailwind's `lg` breakpoint (the desktop sidebar
 * starts at 1024px, so landscape iPads keep it).
 */
export const COMPACT_MEDIA_QUERY = '(max-width: 1023px)'

/** Screens with an on-screen keyboard, where the tab bar steps aside while typing. */
export const TOUCH_MEDIA_QUERY = '(pointer: coarse)'

/** Tool tabs before the More tab, in priority order. Roadmap falls back to Changelog. */
const TAB_CANDIDATES: readonly (readonly string[])[] = [
  ['/dashboard'],
  ['/feedback'],
  ['/inbox'],
  ['/dashboard/roadmap', '/dashboard/changelog'],
]

const TAB_LABELS: Record<string, string> = {
  '/dashboard': 'Overview',
}

export interface MobileTab {
  title: string
  url: string
  icon: string
}

export interface MobileHeaderState {
  /** Replaces the project name; rendered as a button when `onTitleClick` is set. */
  title: string
  /** Shown next to the title (e.g. the number of conversations). */
  count: string
  onTitleClick: (() => void) | null
  titleTestId: string
  /** Hide both bars (e.g. an open conversation, which brings its own header and composer). */
  hidden: boolean
}

interface MobileShellStore {
  /** `null` until the layout has measured the viewport on the client. */
  isCompact: boolean | null
  header: MobileHeaderState
  moreOpen: boolean
}

function emptyHeader(): MobileHeaderState {
  return { title: '', count: '', onTitleClick: null, titleTestId: '', hidden: false }
}

export const mobileShell = reactive<MobileShellStore>({
  isCompact: null,
  header: emptyHeader(),
  moreOpen: false,
})

// Kept outside the reactive store, which would wrap it in a proxy and break the identity check.
let headerOwner: unknown = null

export function setMobileHeader(owner: unknown, patch: Partial<MobileHeaderState>) {
  if (headerOwner !== owner) {
    mobileShell.header = emptyHeader()
    headerOwner = owner
  }
  Object.assign(mobileShell.header, patch)
}

export function clearMobileHeader(owner: unknown) {
  if (headerOwner !== owner) return
  mobileShell.header = emptyHeader()
  headerOwner = null
}

/** Inputs for `getVisibleNavGroups`, shared by the sidebar and the phone shell. */
export function navVisibilityContext(
  context: ActiveProjectContext | null | undefined,
  hasActiveOrganization: OrgState
): SidebarVisibilityContext {
  const orgRole = context?.organization?.role
  return {
    hasActiveOrganization,
    modules: scopeModules(context),
    productCount: context?.products?.length || 0,
    isProjectAdmin: context?.project?.role === 'admin' || orgRole === 'owner' || orgRole === 'admin',
    isAllProjects: isAllProjects(context),
  }
}

function visibleItems(groups: readonly SidebarNavGroup[]): SidebarNavItem[] {
  return groups.flatMap((group) => group.items)
}

/** Up to four tool tabs from what the sidebar would show; the rest lives under More. */
export function pickMobileTabs(groups: readonly SidebarNavGroup[]): MobileTab[] {
  const items = visibleItems(groups)
  const tabs: MobileTab[] = []
  for (const candidates of TAB_CANDIDATES) {
    const item = candidates.map((url) => items.find((entry) => entry.url === url)).find(Boolean)
    if (item) tabs.push({ title: TAB_LABELS[item.url] || item.title, url: item.url, icon: item.icon })
  }
  return tabs
}

/** Sidebar groups minus the entries that already have a tab; empty groups are dropped. */
export function moreNavGroups(groups: readonly SidebarNavGroup[], tabs: readonly MobileTab[]): SidebarNavGroup[] {
  const tabUrls = new Set(tabs.map((tab) => tab.url))
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !tabUrls.has(item.url)) }))
    .filter((group) => group.items.length > 0)
}

function pathMatches(path: string, url: string) {
  return path === url || path.startsWith(`${url}/`)
}

/**
 * The tab for `path`: the one with the longest matching URL. `navUrls` are every sidebar entry; when a
 * deeper entry without a tab matches (e.g. /dashboard/changelog while Roadmap has the tab), no tab is
 * active rather than Overview.
 */
export function activeTabUrl(path: string, tabs: readonly MobileTab[], navUrls: readonly string[] = []): string | null {
  let best: string | null = null
  for (const tab of tabs) {
    if (pathMatches(path, tab.url) && (!best || tab.url.length > best.length)) best = tab.url
  }
  if (!best) return null
  const deeper = navUrls.some((url) => url.length > best!.length && pathMatches(path, url))
  return deeper ? null : best
}

/** Every sidebar entry's path (query strings dropped), for `activeTabUrl`. */
export function navPaths(groups: readonly SidebarNavGroup[]): string[] {
  return visibleItems(groups).map((item) => item.url.split('?')[0])
}

export interface MobileProduct {
  name: string
  slug: string
}

/**
 * The sidebar's per-product boards (`<url>?product=<slug>`, only with more than one product), as their own
 * More section: their parent entries (Feedback) are tabs, so the sub-items would otherwise be lost.
 */
export function productNavGroup(
  groups: readonly SidebarNavGroup[],
  ctx: Pick<SidebarVisibilityContext, 'productCount' | 'isAllProjects'>,
  products: readonly MobileProduct[]
): SidebarNavGroup | null {
  if (!showProductSubItems(ctx)) return null
  const items = visibleItems(groups)
    .filter((item) => item.productSubItems)
    .flatMap((item) =>
      products.map((product) => ({
        title: product.name,
        url: `${item.url}?product=${encodeURIComponent(product.slug)}`,
        icon: item.icon,
      }))
    )
  return items.length ? { id: 'products', label: 'Feedback boards', items } : null
}

/**
 * The one entry to highlight for the current route. Entries can share a path and differ by query
 * (`/settings` and `/settings?tab=notifications`): the entry whose query parameters all match and has
 * the most of them wins, so only one is active.
 */
export function activeNavUrl(urls: readonly string[], path: string, query: Record<string, unknown>): string | null {
  let best: { url: string; params: number } | null = null
  for (const url of urls) {
    const [urlPath, search] = url.split('?')
    if (urlPath !== path) continue
    const params = [...new URLSearchParams(search || '').entries()]
    if (!params.every(([key, value]) => query[key] === value)) continue
    if (!best || params.length > best.params) best = { url, params: params.length }
  }
  return best?.url ?? null
}
