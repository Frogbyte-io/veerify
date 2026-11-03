<template>
  <!-- The one bar on phones: project, page title (when a page sets one), notifications. -->
  <header
    data-testid="mobile-top-bar"
    class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
  >
    <template v-if="ready">
      <div :class="hasTitle ? 'shrink-0' : 'min-w-0 flex-1'">
        <ProjectSwitcher :compact="hasTitle" />
      </div>
      <template v-if="hasTitle">
        <button
          v-if="header.onTitleClick"
          type="button"
          :data-testid="header.titleTestId || 'mobile-top-bar-title'"
          aria-haspopup="dialog"
          class="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-base font-semibold hover:bg-accent"
          @click="header.onTitleClick()"
        >
          <span class="truncate">{{ header.title }}</span>
          <Icon name="lucide:chevron-down" class="size-4 shrink-0 text-muted-foreground" />
        </button>
        <h1
          v-else
          :data-testid="header.titleTestId || 'mobile-top-bar-title'"
          class="min-w-0 truncate px-1.5 text-base font-semibold"
        >
          {{ header.title }}
        </h1>
        <span v-if="header.count" class="shrink-0 text-sm tabular-nums text-muted-foreground">{{ header.count }}</span>
        <span class="flex-1" />
      </template>
      <NotificationBell class="shrink-0" />
    </template>
    <template v-else>
      <Skeleton class="size-8 shrink-0 rounded-lg" />
      <Skeleton class="h-4 w-28" />
    </template>
  </header>
</template>

<script>
import { mobileShell } from '~/lib/mobile-shell'

export default {
  name: 'MobileTopBar',
  computed: {
    // Mounted on phones only once the layout has measured the viewport, so the switcher's
    // keyboard shortcuts and the bell's polling never run twice next to the desktop header.
    ready() {
      return mobileShell.isCompact === true
    },
    header() {
      return mobileShell.header
    },
    hasTitle() {
      return Boolean(mobileShell.header.title)
    },
  },
}
</script>
