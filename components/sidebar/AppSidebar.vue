<script setup lang="ts">
import ProjectSwitcher from './ProjectSwitcher.vue'
import NavUser from './NavUser.vue'
import { useSidebar } from '~/components/ui/sidebar'
import type { ModuleSettings } from '~/lib/modules'
import {
  activeProjectStore,
  loadActiveProject as loadSharedActiveProject,
  type ActiveProjectContext,
} from '~/lib/active-project'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups, showProductSubItems } from '~/lib/sidebar-nav'
import { isAllProjects as isAllProjectsContext, scopeModules } from '~/lib/project-scope'

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
  void loadActiveProject()

  if (import.meta.client) {
    // Tools are switched per project, so both a project switch and a Tools-tab
    // toggle change what this sidebar should render.
    window.addEventListener('veerify:active-project-changed', loadActiveProject)
    window.addEventListener('veerify:project-modules-changed', loadActiveProject)
  }
})

onBeforeUnmount(() => {
  persistSidebarWidth(sidebarWidth.value)
  stopSidebarResize()

  if (import.meta.client) {
    window.removeEventListener('veerify:active-project-changed', loadActiveProject)
    window.removeEventListener('veerify:project-modules-changed', loadActiveProject)
  }
})

// Shared state set by ProjectSwitcher — null = loading, true = has org, false = personal account
const hasActiveOrganization = useState<boolean | null>('hasActiveOrganization', () => null)

type ProductSummary = { id: string; name: string; slug: string }

// Nothing is assumed on until the active project has loaded: tools stay hidden rather than
// flashing on and off, and the "Add tool" entry only appears for a known project admin.
// The shared cache (lib/active-project.ts) keeps the last value, so navigating never blanks the nav.
const lastContext = computed<ActiveProjectContext | null>(() => activeProjectStore.context ?? null)
const isAllProjects = computed(() => isAllProjectsContext(lastContext.value))
// In All projects a tool shows when any combined project has it on.
const projectModules = computed<Partial<ModuleSettings>>(() => scopeModules(lastContext.value))
const products = computed<ProductSummary[]>(() => lastContext.value?.products || [])
const isProjectAdmin = computed(() => {
  const context = lastContext.value
  const orgRole = context?.organization?.role
  return context?.project?.role === 'admin' || orgRole === 'owner' || orgRole === 'admin'
})
const marketingOpen = ref(import.meta.client ? window.location.pathname.startsWith('/marketing') : false)

async function loadActiveProject(event?: Event) {
  if (!import.meta.client) return
  try {
    await loadSharedActiveProject({ force: Boolean(event) })
  } catch {
    // Failures keep the last state; 409 (no project) resolves to null and ProjectSwitcher routes to onboarding.
  }
}

const visibilityContext = computed(() => ({
  hasActiveOrganization: hasActiveOrganization.value,
  modules: projectModules.value,
  productCount: products.value.length,
  isProjectAdmin: isProjectAdmin.value,
  isAllProjects: isAllProjects.value,
}))

// One rule decides every group and item; see lib/sidebar-nav.ts.
const visibleGroups = computed(() => getVisibleNavGroups(SIDEBAR_NAV_GROUPS, visibilityContext.value))
const hasProductSubItems = computed(() => showProductSubItems(visibilityContext.value))

function productUrl(base: string, product: ProductSummary) {
  return `${base}?product=${encodeURIComponent(product.slug)}`
}
</script>

<template>
  <Sidebar data-testid="app-sidebar" :style="sidebarStyle" v-bind="props">
    <SidebarHeader>
      <ProjectSwitcher />
    </SidebarHeader>

    <SidebarContent
      class="pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)] group-data-[collapsible=icon]:[mask-image:none]"
    >
      <template v-for="group in visibleGroups" :key="group.id">
        <p
          v-if="isAllProjects && group.id === 'workspace'"
          data-testid="sidebar-all-projects-note"
          class="mx-4 mb-1 rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
        >
          <Icon name="lucide:info" class="mr-1 inline size-3 align-[-2px]" />
          Marketing and project settings live in each project. Pick one in the switcher above.
        </p>
        <SidebarGroup :data-testid="group.testId">
          <!-- Collapsible group (Marketing) -->
          <template v-if="group.collapsible">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  :tooltip="group.label"
                  :aria-expanded="marketingOpen"
                  class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2.5"
                  @click="marketingOpen = !marketingOpen"
                >
                  <Icon :name="group.icon || 'lucide:folder'" class="!size-5 shrink-0" />
                  <span class="group-data-[collapsible=icon]:hidden">{{ group.label }}</span>
                  <Icon
                    name="lucide:chevron-right"
                    class="ml-auto size-4 transition-transform group-data-[collapsible=icon]:hidden"
                    :class="marketingOpen ? 'rotate-90' : ''"
                  />
                </SidebarMenuButton>
                <SidebarMenuSub v-if="marketingOpen">
                  <SidebarMenuSubItem v-for="item in group.items" :key="item.url">
                    <SidebarMenuSubButton as-child>
                      <NuxtLink :to="item.url" prefetch-on="interaction">
                        <span>{{ item.title }}</span>
                      </NuxtLink>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </template>

          <template v-else>
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
                  <!-- Per-product boards: only when the project has more than one product -->
                  <SidebarMenuSub v-if="item.productSubItems && hasProductSubItems">
                    <SidebarMenuSubItem v-for="product in products" :key="product.id">
                      <SidebarMenuSubButton as-child>
                        <NuxtLink :to="productUrl(item.url, product)" prefetch-on="interaction">
                          <span>{{ product.name }}</span>
                        </NuxtLink>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </template>
        </SidebarGroup>
      </template>
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
