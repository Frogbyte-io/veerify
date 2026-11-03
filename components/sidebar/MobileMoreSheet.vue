<template>
  <Sheet :open="open" @update:open="setOpen">
    <!-- The built-in close button (top right) stays: the grabber is decorative. -->
    <SheetContent
      side="bottom"
      data-testid="mobile-more-sheet"
      class="max-h-[85svh] gap-0 rounded-t-2xl bg-sidebar p-0 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:mx-auto md:max-w-xl md:border-x"
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
                :aria-current="activeUrl === item.url ? 'page' : undefined"
                :class="linkClass(activeUrl === item.url)"
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
import {
  activeNavUrl,
  mobileShell,
  moreNavGroups,
  navVisibilityContext,
  pickMobileTabs,
  productNavGroup,
} from '~/lib/mobile-shell'

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
      const context = activeProjectStore.context
      const ctx = navVisibilityContext(context, this.hasActiveOrganization)
      const visible = getVisibleNavGroups(SIDEBAR_NAV_GROUPS, ctx)
      const more = moreNavGroups(visible, pickMobileTabs(visible))
      // Per-product boards (Feedback has a tab, so its sub-items live here).
      const products = productNavGroup(visible, ctx, context?.products || [])
      return products ? [products, ...more] : more
    },
    activeUrl() {
      const urls = this.groups.flatMap((group) => group.items.map((item) => item.url))
      return activeNavUrl(urls, this.$route.path, this.$route.query)
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
    linkClass(active) {
      return cn(
        'flex h-11 items-center gap-3 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      )
    },
  },
}
</script>
