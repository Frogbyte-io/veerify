<template>
  <TooltipProvider>
    <SidebarProvider>
      <!--
        Desktop (1024px and up): the app sidebar. It renders client-side only (its own media query mismatched
        hydration); the fallback reserves the desktop gap so there is no layout shift.
        Phones and tablets (below 1024px): no sidebar; one top bar, a tab bar and the More sheet replace it.
      -->
      <ClientOnly>
        <AppSidebar v-if="isCompact === false" />
        <template #fallback>
          <div class="hidden w-(--sidebar-width) shrink-0 lg:block" aria-hidden="true" />
        </template>
      </ClientOnly>
      <SidebarInset class="min-w-0" :class="isFlush ? 'h-svh overflow-hidden' : ''">
        <!-- Until the viewport is measured (SSR), CSS picks the bar. -->
        <MobileTopBar v-if="showCompactChrome" :class="isCompact === null ? 'lg:hidden' : ''" />
        <header
          v-if="isCompact !== true"
          data-testid="dashboard-header"
          class="h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
          :class="isCompact === null ? 'hidden lg:flex' : 'flex'"
        >
          <div class="flex w-full items-center justify-between px-4">
            <div class="flex items-center gap-2">
              <SidebarTrigger class="-ml-1" />
              <SidebarSeparator orientation="vertical" />
            </div>
            <NotificationBell v-if="isCompact === false" />
          </div>
        </header>
        <div class="flex min-w-0 flex-1 flex-col" :class="contentClass">
          <EmailVerificationNudge />
          <slot />
        </div>
        <MobileTabBar v-if="showCompactChrome && !keyboardOpen" :class="isCompact === null ? 'lg:hidden' : ''" />
      </SidebarInset>
      <MobileMoreSheet v-if="isCompact" />
    </SidebarProvider>
  </TooltipProvider>
</template>

<script>
import { COMPACT_MEDIA_QUERY, TOUCH_MEDIA_QUERY, mobileShell } from '~/lib/mobile-shell'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password', ''])

function isTextEntry(element) {
  if (!element) return false
  if (element.isContentEditable) return true
  if (element.tagName === 'TEXTAREA') return true
  return element.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(element.getAttribute('type') || '')
}

export default {
  name: 'DashboardLayout',
  data() {
    return {
      mediaQuery: null,
      keyboardOpen: false,
    }
  },
  computed: {
    // Set by `pages:extend` in nuxt.config.ts for pages that fill the space under the header.
    isFlush() {
      return this.$route.meta.flush === true
    },
    // The desktop header has no bottom border; flush pages draw one. The compact top bar has its own.
    contentClass() {
      if (!this.isFlush) return 'gap-4 px-4 pt-2 pb-10 sm:px-6 lg:px-8'
      if (this.isCompact === true) return 'min-h-0'
      return this.isCompact === null ? 'min-h-0 lg:border-t' : 'min-h-0 border-t'
    },
    isCompact() {
      return mobileShell.isCompact
    },
    // A page can hide both bars (an open conversation on a phone brings its own header and composer).
    showCompactChrome() {
      return this.isCompact !== false && !mobileShell.header.hidden
    },
  },
  mounted() {
    if (!import.meta.client || typeof window.matchMedia !== 'function') {
      mobileShell.isCompact = false
      return
    }
    this.mediaQuery = window.matchMedia(COMPACT_MEDIA_QUERY)
    mobileShell.isCompact = this.mediaQuery.matches
    this.mediaQuery.addEventListener('change', this.handleMediaChange)
    // The on-screen keyboard pushes a bottom bar up over the content; hide it while typing.
    document.addEventListener('focusin', this.handleFocusChange)
    document.addEventListener('focusout', this.handleFocusChange)
  },
  beforeUnmount() {
    this.mediaQuery?.removeEventListener('change', this.handleMediaChange)
    if (import.meta.client) {
      document.removeEventListener('focusin', this.handleFocusChange)
      document.removeEventListener('focusout', this.handleFocusChange)
    }
  },
  methods: {
    handleMediaChange(event) {
      mobileShell.isCompact = event.matches
      // A field focused while crossing 1024px must not leave the tab bar hidden afterwards.
      this.keyboardOpen = false
      if (!event.matches) mobileShell.moreOpen = false
    },
    handleFocusChange(event) {
      // Only touch screens get an on-screen keyboard; a narrow desktop window keeps its tab bar.
      if (!this.isCompact || !window.matchMedia(TOUCH_MEDIA_QUERY).matches) {
        this.keyboardOpen = false
        return
      }
      // focusout fires before focus lands on the next element; relatedTarget is that element.
      const next = event.type === 'focusin' ? event.target : event.relatedTarget
      this.keyboardOpen = isTextEntry(next)
    },
  },
}
</script>
