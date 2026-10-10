<script setup lang="ts">
import TeamSwitcher from './TeamSwitcher.vue'
import NavUser from './NavUser.vue'
import { useSidebar } from '~/components/ui/sidebar'
import { DEFAULT_TEAM_MODULES, type ModuleKey } from '~/lib/modules'

interface SidebarProps {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  class?: string
}

interface SidebarNavItem {
  title: string
  url: string
  icon: string
  disabled?: boolean
  /** Hidden unless this module is enabled for the active team */
  module?: ModuleKey
}

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

const SIDEBAR_WIDTH_STORAGE_KEY = 'veerify_sidebar_width'
const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 224
const MAX_SIDEBAR_WIDTH = 420

const { state } = useSidebar()
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const isResizingSidebar = ref(false)
const resizeStartX = ref(0)
const resizeStartWidth = ref(DEFAULT_SIDEBAR_WIDTH)

const sidebarStyle = computed(() => ({
  '--sidebar-width': `${sidebarWidth.value}px`,
}))

const canResizeSidebar = computed(() => state.value === 'expanded')

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}

function applySidebarWidth(width: number) {
  sidebarWidth.value = width
  if (!import.meta.client) return
  const wrapper = document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')
  wrapper?.style.setProperty('--sidebar-width', `${width}px`)
}

function persistSidebarWidth(width: number) {
  if (!import.meta.client) return
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Ignore storage failures.
  }
}

function restoreSidebarWidth() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    const parsed = Number(raw)
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      applySidebarWidth(clampSidebarWidth(parsed))
    }
  } catch {
    // Ignore storage failures.
  }
}

function stopSidebarResize() {
  if (!isResizingSidebar.value) return
  isResizingSidebar.value = false
  persistSidebarWidth(sidebarWidth.value)
  if (import.meta.client) {
    window.removeEventListener('pointermove', onSidebarResizeMove)
    window.removeEventListener('pointerup', stopSidebarResize)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }
}

function onSidebarResizeMove(event: PointerEvent) {
  if (!isResizingSidebar.value) return
  const direction = props.side === 'right' ? -1 : 1
  const delta = (event.clientX - resizeStartX.value) * direction
  const nextWidth = clampSidebarWidth(resizeStartWidth.value + delta)
  applySidebarWidth(nextWidth)
}

function startSidebarResize(event: PointerEvent) {
  if (!canResizeSidebar.value || !import.meta.client) return
  isResizingSidebar.value = true
  resizeStartX.value = event.clientX
  resizeStartWidth.value = sidebarWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', onSidebarResizeMove)
  window.addEventListener('pointerup', stopSidebarResize)
}

function handleResizeHandleClick() {
  persistSidebarWidth(sidebarWidth.value)
}

onMounted(() => {
  restoreSidebarWidth()
  void loadTeamModules()

  if (import.meta.client) {
    // Module settings are per team, so both a team switch and a Tools-tab
    // toggle change what this sidebar should render.
    window.addEventListener('veerify:active-team-changed', loadTeamModules)
    window.addEventListener('veerify:team-modules-changed', loadTeamModules)
  }
})

onBeforeUnmount(() => {
  persistSidebarWidth(sidebarWidth.value)
  stopSidebarResize()

  if (import.meta.client) {
    window.removeEventListener('veerify:active-team-changed', loadTeamModules)
    window.removeEventListener('veerify:team-modules-changed', loadTeamModules)
  }
})

// Shared state set by TeamSwitcher — null = loading, true = has org, false = personal account
const hasActiveOrganization = useState('hasActiveOrganization', () => null)

// All personal nav items
const personalItems: SidebarNavItem[] = [
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: 'lucide:layout-dashboard',
  },
  {
    title: 'My Submissions',
    url: '/submissions',
    icon: 'lucide:list',
  },
  {
    title: 'Notifications',
    url: '/settings#notifications',
    icon: 'lucide:bell',
  },
]

// Dashboard is only relevant in workspace context; show it while loading (null) too
const personalNavItems = computed(() =>
  hasActiveOrganization.value !== false ? personalItems : personalItems.filter((item) => item.title !== 'Dashboard')
)

// Workspace navigation items (only shown when org is active)
const feedbackItems: SidebarNavItem[] = [
  {
    title: 'Feedback',
    url: '/feedback',
    icon: 'lucide:message-square',
    module: 'feedbackEnabled',
  },
  {
    title: 'Roadmap',
    url: '/roadmap',
    icon: 'lucide:map',
    disabled: true,
    module: 'roadmapEnabled',
  },
  {
    title: 'Changelog',
    url: '/changelog',
    icon: 'lucide:scroll-text',
    module: 'changelogEnabled',
  },
]

const managementItems: SidebarNavItem[] = [
  {
    title: 'Products',
    url: '/products',
    icon: 'lucide:package',
  },
  {
    title: 'Members',
    url: '/settings#organization',
    icon: 'lucide:user-plus',
  },
]

const systemItems: SidebarNavItem[] = [
  {
    title: 'Settings',
    url: '/settings',
    icon: 'lucide:settings',
  },
]

const supportModuleItems: SidebarNavItem[] = [
  {
    title: 'Inbox',
    url: '/support',
    icon: 'lucide:inbox',
  },
  {
    title: 'Contacts',
    url: '/support/contacts',
    icon: 'lucide:contact',
  },
]

const marketingModuleItems: SidebarNavItem[] = [
  {
    title: 'Overview',
    url: '/marketing',
    icon: 'lucide:megaphone',
  },
  {
    title: 'Site audit',
    url: '/marketing/audit',
    icon: 'lucide:search-check',
  },
  {
    title: 'AI visibility',
    url: '/marketing/ai-visibility',
    icon: 'lucide:sparkles',
  },
  {
    title: 'Search',
    url: '/marketing/search',
    icon: 'lucide:chart-line',
  },
  {
    title: 'Mentions',
    url: '/marketing/mentions',
    icon: 'lucide:at-sign',
  },
  {
    title: 'Announcements',
    url: '/marketing/announcements',
    icon: 'lucide:send',
  },
  {
    title: 'Reviews',
    url: '/marketing/reviews',
    icon: 'lucide:star',
  },
  {
    title: 'Customer language',
    url: '/marketing/language',
    icon: 'lucide:message-square-quote',
  },
  {
    title: 'Settings',
    url: '/marketing/settings',
    icon: 'lucide:sliders-horizontal',
  },
]

// Per-team module enablement (delta D-31). Defaults match the table's column
// defaults, so the sidebar renders correctly for a team that has never opened
// the Tools tab and therefore has no row.
const teamModules = ref({ ...DEFAULT_TEAM_MODULES })

async function loadTeamModules() {
  if (!import.meta.client) return
  try {
    const activeTeam = await $fetch<{ data?: { id?: string } }>('/api/teams/active')
    const teamId = activeTeam?.data?.id
    if (!teamId) return

    const response = await $fetch<{ data?: { modules?: Record<string, boolean> } }>(`/api/teams/${teamId}/modules`)
    if (response?.data?.modules) {
      teamModules.value = { ...teamModules.value, ...response.data.modules }
    }
  } catch {
    // Keep defaults — a failed lookup should not blank the navigation.
  }
}

// `Roadmap` remains `disabled` even when its module is on: the dashboard page
// genuinely does not exist yet (`pages/roadmap` is absent), so enabling the
// toggle must not produce a link to a 404. The toggle controls whether the placeholder is advertised at
// all. See Technical Debt #11.
const visibleFeedbackItems = computed(() =>
  feedbackItems.filter((item) => !item.module || teamModules.value[item.module])
)
</script>

<template>
  <Sidebar data-testid="app-sidebar" :style="sidebarStyle" v-bind="props">
    <SidebarHeader>
      <TeamSwitcher />
    </SidebarHeader>

    <SidebarContent>
      <!-- Personal Section (always visible) -->
      <SidebarGroup>
        <SidebarGroupLabel>Personal</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in personalNavItems" :key="item.title">
              <SidebarMenuButton
                as-child
                :tooltip="item.title"
                class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
              >
                <NuxtLink :to="item.url" prefetch-on="interaction">
                  <Icon :name="item.icon" class="!size-5 shrink-0" />
                  <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Workspace sections (only when org is active) -->
      <template v-if="hasActiveOrganization === true">
        <!-- Feedback Section -->
        <SidebarGroup v-if="visibleFeedbackItems.length > 0">
          <SidebarGroupLabel>Feedback</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in visibleFeedbackItems" :key="item.title">
                <SidebarMenuButton
                  v-if="item.disabled"
                  :tooltip="item.title"
                  disabled
                  aria-disabled="true"
                  class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
                >
                  <Icon :name="item.icon" class="!size-5 shrink-0" />
                  <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                </SidebarMenuButton>
                <SidebarMenuButton
                  v-else
                  as-child
                  :tooltip="item.title"
                  class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
                >
                  <NuxtLink :to="item.url" prefetch-on="interaction">
                    <Icon :name="item.icon" class="!size-5 shrink-0" />
                    <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <!-- Management Section -->
        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in managementItems" :key="item.title">
                <SidebarMenuButton
                  as-child
                  :tooltip="item.title"
                  class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
                >
                  <NuxtLink :to="item.url" prefetch-on="interaction">
                    <Icon :name="item.icon" class="!size-5 shrink-0" />
                    <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <!-- Support Section — off by default; enabled per team in Settings → Tools -->
        <SidebarGroup v-if="teamModules.supportEnabled">
          <SidebarGroupLabel>Support</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in supportModuleItems" :key="item.title">
                <SidebarMenuButton
                  as-child
                  :tooltip="item.title"
                  class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
                >
                  <NuxtLink :to="item.url" prefetch-on="interaction">
                    <Icon :name="item.icon" class="!size-5 shrink-0" />
                    <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <!-- Marketing Section — off by default; enabled per team in Settings → Tools -->
        <SidebarGroup v-if="teamModules.marketingEnabled">
          <SidebarGroupLabel>Marketing</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in marketingModuleItems" :key="item.url">
                <SidebarMenuButton
                  as-child
                  :tooltip="item.title"
                  class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
                >
                  <NuxtLink :to="item.url" prefetch-on="interaction">
                    <Icon :name="item.icon" class="!size-5 shrink-0" />
                    <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </template>

      <!-- System Section (always visible) -->
      <SidebarGroup>
        <SidebarGroupLabel>System</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in systemItems" :key="item.title">
              <SidebarMenuButton
                as-child
                :tooltip="item.title"
                class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
              >
                <NuxtLink :to="item.url" prefetch-on="interaction">
                  <Icon :name="item.icon" class="!size-5 shrink-0" />
                  <span class="group-data-[collapsible=icon]:hidden">{{ item.title }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <NavUser />
    </SidebarFooter>
    <SidebarRail />
    <button
      data-testid="app-sidebar-resize-handle"
      type="button"
      aria-label="Resize sidebar"
      class="absolute inset-y-0 z-30 hidden w-3 md:block group-data-[collapsible=icon]:hidden"
      :class="props.side === 'right' ? 'left-0 cursor-col-resize' : 'right-0 cursor-col-resize'"
      @click.stop="handleResizeHandleClick"
      @pointerdown.prevent="startSidebarResize"
    />
  </Sidebar>
</template>
