<template>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6" data-testid="settings-tabs">
    <!-- Side-nav on desktop, horizontal scroll strip on small screens -->
    <nav
      aria-label="Sections"
      class="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:self-start lg:overflow-visible lg:rounded-lg lg:border lg:bg-card lg:p-2 lg:px-2"
    >
      <ul v-if="loading" class="flex gap-2 lg:flex-col" data-testid="settings-tabs-skeleton">
        <li v-for="n in skeletonCount" :key="n" class="shrink-0">
          <Skeleton class="h-9 w-28 lg:w-full" />
        </li>
      </ul>
      <ul v-else class="flex gap-1 lg:flex-col">
        <li v-for="tab in tabs" :key="tab.id" class="shrink-0">
          <button
            type="button"
            :data-testid="`${testIdPrefix}-tab-${tab.id}`"
            :aria-label="ariaLabelSuffix ? `${tab.label}${ariaLabelSuffix}` : undefined"
            :aria-current="activeTab === tab.id ? 'page' : undefined"
            :class="[
              'flex w-full items-center whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              activeTab === tab.id
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            ]"
            @click="select(tab.id)"
            @mouseenter="prefetch(tab.id)"
            @focus="prefetch(tab.id)"
          >
            <Icon v-if="tab.icon" :name="tab.icon" class="mr-2 h-4 w-4 shrink-0" />
            {{ tab.label }}
          </button>
        </li>
      </ul>
    </nav>

    <div class="min-w-0">
      <slot v-if="loading" name="loading">
        <Skeleton class="h-64 w-full rounded-lg" />
      </slot>
      <slot v-else :active="activeTab" />
    </div>
  </div>
</template>

<script>
/**
 * The one tab pattern for settings pages. The active tab lives in `?tab=<id>` (read from the
 * route, so SSR and the first paint show the right tab) and changes with `router.replace`, so
 * switching tabs does not fill the history. A legacy `#hash` is converted to `?tab=` on mount and
 * whenever it changes (for example sidebar links such as `/settings#notifications`).
 *
 * The page wraps its tab component in `<KeepAlive>` inside the default slot (scoped `active`),
 * so revisiting a tab neither remounts nor refetches. Hovering or focusing a tab emits
 * `prefetch` once per tab so the page can warm that tab's code or data.
 */
export default {
  name: 'SettingsTabs',
  props: {
    // [{ id, label, icon }]
    tabs: { type: Array, default: () => [] },
    defaultTab: { type: String, default: '' },
    testIdPrefix: { type: String, required: true },
    ariaLabelSuffix: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    skeletonCount: { type: Number, default: 6 },
    // { legacyId: 'currentId' }: applied to both `?tab=` and `#hash`
    aliases: { type: Object, default: () => ({}) },
    // { legacyHash: { path, tab } }: a hash that moved to another page
    hashRedirects: { type: Object, default: () => ({}) },
  },
  emits: ['prefetch', 'change'],
  data() {
    return {
      prefetched: {},
    }
  },
  computed: {
    fallbackTab() {
      return this.defaultTab || this.tabs[0]?.id || ''
    },
    requestedTab() {
      const raw = this.$route.query.tab
      const value = Array.isArray(raw) ? raw[0] : raw
      return typeof value === 'string' && value ? this.aliases[value] || value : ''
    },
    activeTab() {
      // While the tab list is still unknown (loading) trust the URL so the first paint is stable.
      if (!this.tabs.length) return this.requestedTab || this.defaultTab
      return this.tabs.some((tab) => tab.id === this.requestedTab) ? this.requestedTab : this.fallbackTab
    },
  },
  watch: {
    '$route.hash'() {
      this.applyHash()
    },
    tabs() {
      this.dropInvalidTab()
    },
    activeTab: {
      immediate: true,
      handler(value) {
        this.$emit('change', value)
      },
    },
  },
  mounted() {
    this.applyHash()
    this.dropInvalidTab()
  },
  methods: {
    select(id) {
      if (id === this.activeTab && this.$route.query.tab === id) return
      this.$router.replace({ query: { ...this.$route.query, tab: id }, hash: '' })
    },
    prefetch(id) {
      if (this.prefetched[id]) return
      this.prefetched[id] = true
      this.$emit('prefetch', id)
    },
    applyHash() {
      const hash = (this.$route.hash || '').replace(/^#/, '')
      if (!hash) return
      const redirect = this.hashRedirects[hash]
      if (redirect) {
        this.$router.replace({ path: redirect.path, query: { tab: redirect.tab } })
        return
      }
      this.$router.replace({ query: { ...this.$route.query, tab: this.aliases[hash] || hash }, hash: '' })
    },
    // A `?tab=` that names no tab (after the tab list is known) is replaced by the default.
    dropInvalidTab() {
      if (!this.tabs.length || !this.$route.query.tab || this.$route.hash) return
      if (!this.tabs.some((tab) => tab.id === this.requestedTab)) {
        this.$router.replace({ query: { ...this.$route.query, tab: this.fallbackTab }, hash: '' })
      }
    },
  },
}
</script>
