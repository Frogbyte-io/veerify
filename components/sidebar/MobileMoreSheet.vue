<template>
  <Sheet :open="open" @update:open="setOpen">
    <SheetContent
      side="bottom"
      data-testid="mobile-more-sheet"
      class="max-h-[85svh] gap-0 rounded-t-2xl bg-sidebar p-0 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:mx-auto md:max-w-xl md:border-x [&>button]:hidden"
    >
      <SheetHeader class="sr-only">
        <SheetTitle>Menu</SheetTitle>
        <SheetDescription>Every page of the dashboard and your account</SheetDescription>
      </SheetHeader>
      <div class="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
      <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="More">
        <section v-for="group in groups" :key="group.id" class="pt-2">
          <h2 class="px-2 pb-1 text-xs font-medium text-muted-foreground">{{ group.label }}</h2>
          <ul>
            <li v-for="item in group.items" :key="item.url">
              <NuxtLink
                :to="item.url"
                prefetch-on="interaction"
                :data-testid="`mobile-more-link-${item.url}`"
                :class="linkClass(isActive(item.url))"
                @click="setOpen(false)"
              >
                <Icon :name="item.icon" class="size-5 shrink-0 text-[20px] text-muted-foreground" />
                <span class="truncate">{{ item.title }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </nav>
      <div class="border-t p-2">
        <NavUser />
      </div>
    </SheetContent>
  </Sheet>
</template>

<script>
import { cn } from '~/lib/utils'
import { activeProjectStore } from '~/lib/active-project'
import { SIDEBAR_NAV_GROUPS, getVisibleNavGroups } from '~/lib/sidebar-nav'
import { mobileShell, moreNavGroups, navVisibilityContext, pickMobileTabs } from '~/lib/mobile-shell'

export default {
  name: 'MobileMoreSheet',
  data() {
    return {
      hasActiveOrganization: useState('hasActiveOrganization', () => null),
    }
  },
  computed: {
    open() {
      return mobileShell.moreOpen
    },
    groups() {
      const ctx = navVisibilityContext(activeProjectStore.context, this.hasActiveOrganization)
      const visible = getVisibleNavGroups(SIDEBAR_NAV_GROUPS, ctx)
      return moreNavGroups(visible, pickMobileTabs(visible))
    },
  },
  watch: {
    '$route.fullPath'() {
      this.setOpen(false)
    },
  },
  methods: {
    setOpen(value) {
      mobileShell.moreOpen = value
    },
    isActive(url) {
      const [path, query] = url.split('?')
      if (this.$route.path !== path) return false
      if (!query) return true
      const params = new URLSearchParams(query)
      return [...params.entries()].every(([key, value]) => this.$route.query[key] === value)
    },
    linkClass(active) {
      return cn(
        'flex h-11 items-center gap-3 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      )
    },
  },
}
</script>
