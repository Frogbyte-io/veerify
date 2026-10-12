<script setup lang="ts">
import TeamSwitcher from './TeamSwitcher.vue'
import NavUser from './NavUser.vue'
import { useSidebar } from '~/components/ui/sidebar'
import { DEFAULT_TEAM_MODULES } from '~/lib/modules'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups } from '~/lib/sidebar-nav'

interface SidebarProps {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  class?: string
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
const hasActiveOrganization = useState<boolean | null>('hasActiveOrganization', () => null)

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

// One rule decides every group and item; see lib/sidebar-nav.ts.
const visibleGroups = computed(() =>
  getVisibleNavGroups(SIDEBAR_NAV_GROUPS, {
    hasActiveOrganization: hasActiveOrganization.value,
    modules: teamModules.value,
  })
)
</script>

<template>
  <Sidebar data-testid="app-sidebar" :style="sidebarStyle" v-bind="props">
    <SidebarHeader>
      <TeamSwitcher />
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="group in visibleGroups" :key="group.id" :data-testid="group.testId">
        <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in group.items" :key="item.url">
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
