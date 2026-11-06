<template>
  <!--
    The bar is fixed to the viewport: `sticky` let it ride up with short pages, since the layout's min-h-svh is
    shorter than the visible area once mobile browsers hide their URL bar. This wrapper stays in the flow and
    reserves the bar's height (--mobile-tab-bar-height in main.css), so page content and flush panes end above it.
  -->
  <div class="h-(--mobile-tab-bar-height) shrink-0">
    <nav
      data-testid="mobile-tab-bar"
      aria-label="Main"
      class="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <!-- Tablets: the tabs stay together in the middle instead of spreading across the screen -->
      <div
        class="mx-auto grid w-full md:max-w-2xl"
        :style="{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }"
      >
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.url"
          :to="tab.url"
          prefetch-on="interaction"
          :data-testid="`mobile-tab-${tab.url.split('/').pop()}`"
          :aria-current="activeUrl === tab.url ? 'page' : undefined"
          :class="tabClass(activeUrl === tab.url)"
        >
          <Icon :name="tab.icon" class="size-5 shrink-0 text-[20px]" />
          <span class="max-w-full truncate px-1 md:px-0">{{ tab.title }}</span>
        </NuxtLink>
        <button
          type="button"
          data-testid="mobile-tab-more"
          :aria-expanded="String(moreOpen)"
          :class="tabClass(moreOpen || activeUrl === null)"
          @click="openMore"
        >
          <Icon name="lucide:menu" class="size-5 shrink-0 text-[20px]" />
          <span>More</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<script>
import { cn } from '~/lib/utils'
import { activeProjectStore, loadActiveProject } from '~/lib/active-project'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups } from '~/lib/sidebar-nav'
import { activeTabUrl, mobileShell, navPaths, navVisibilityContext, pickMobileTabs } from '~/lib/mobile-shell'

const PROJECT_EVENTS = ['veerify:active-project-changed', 'veerify:project-modules-changed']

export default {
  name: 'MobileTabBar',
  data() {
    return {
      // Set on the server from the session (plugins/user-context.server.ts) and by ProjectSwitcher.
      hasActiveOrganization: useState('hasActiveOrganization', () => null),
    }
  },
  computed: {
    visibleGroups() {
      const ctx = navVisibilityContext(activeProjectStore.context, this.hasActiveOrganization)
      return getVisibleNavGroups(SIDEBAR_NAV_GROUPS, ctx)
    },
    tabs() {
      return pickMobileTabs(this.visibleGroups)
    },
    activeUrl() {
      // Every sidebar route, also those of tools that are off, so their pages never light up Overview.
      return activeTabUrl(this.$route.path, this.tabs, navPaths(SIDEBAR_NAV_GROUPS))
    },
    moreOpen() {
      return mobileShell.moreOpen
    },
  },
  mounted() {
    // The app sidebar loads the active project on desktop; below 1024px it is not mounted, so the tabs do.
    this.refreshActiveProject()
    for (const name of PROJECT_EVENTS) window.addEventListener(name, this.refreshActiveProject)
  },
  beforeUnmount() {
    for (const name of PROJECT_EVENTS) window.removeEventListener(name, this.refreshActiveProject)
  },
  methods: {
    async refreshActiveProject(event) {
      try {
        // Tools are switched per project, so a project switch or a Tools toggle changes the tabs.
        await loadActiveProject({ force: Boolean(event) })
      } catch {
        // Failures keep the last tabs (lib/active-project.ts keeps the cached context); the next
        // project event or remount tries again.
      }
    },
    openMore() {
      mobileShell.moreOpen = true
    },
    tabClass(active) {
      return cn(
        'flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
        'md:flex-row md:gap-2 md:text-sm',
        active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
      )
    },
  },
}
</script>
