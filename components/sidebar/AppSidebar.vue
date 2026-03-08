<script setup lang="ts">
import TeamSwitcher from './TeamSwitcher.vue'
import NavUser from './NavUser.vue'
import { useSidebar } from '~/components/ui/sidebar'

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
      sidebarWidth.value = clampSidebarWidth(parsed)
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
  sidebarWidth.value = nextWidth
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
})

onBeforeUnmount(() => {
  persistSidebarWidth(sidebarWidth.value)
  stopSidebarResize()
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
  },
  {
    title: 'Roadmap',
    url: '/roadmap',
    icon: 'lucide:map',
    disabled: true,
  },
  {
    title: 'Changelog',
    url: '/changelog',
    icon: 'lucide:scroll-text',
    disabled: true,
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

const supportItems: SidebarNavItem[] = [
  {
    title: 'Settings',
    url: '/settings',
    icon: 'lucide:settings',
  },
]
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
        <SidebarGroup>
          <SidebarGroupLabel>Feedback</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in feedbackItems" :key="item.title">
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
      </template>

      <!-- Support Section (always visible) -->
      <SidebarGroup>
        <SidebarGroupLabel>Support</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in supportItems" :key="item.title">
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
      class="absolute inset-y-0 hidden w-3 md:block group-data-[collapsible=icon]:hidden"
      :class="props.side === 'right' ? 'left-0 cursor-col-resize' : 'right-0 cursor-col-resize'"
      @click.stop="handleResizeHandleClick"
      @pointerdown.prevent="startSidebarResize"
    />
  </Sidebar>
</template>
