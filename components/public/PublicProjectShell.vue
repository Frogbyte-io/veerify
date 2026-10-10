<template>
  <div class="min-h-screen bg-background relative flex flex-col">
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
      <button
        v-if="showThemeToggle"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        @click="toggleTheme"
      >
        <Icon :name="currentThemeIcon" class="w-4 h-4" />
        {{ currentThemeLabel }}
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="max-w-3xl mx-auto px-4 py-12 w-full">
      <div class="space-y-4">
        <Skeleton class="h-10 w-64" />
        <Skeleton class="h-5 w-96" />
        <Skeleton v-for="n in 3" :key="n" class="h-40 w-full mt-6" />
      </div>
    </div>

    <!-- Project error -->
    <div v-else-if="error" class="max-w-3xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">{{ notFound ? 'Project Not Found' : 'Something went wrong' }}</h1>
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <button class="text-sm text-primary hover:underline" @click="load">Try again</button>
    </div>

    <div v-else-if="projectData" class="flex-1 flex flex-col">
      <!-- Decorative banner only: it carries no text so nothing can be clipped by it -->
      <div class="w-full h-24 md:h-36 overflow-hidden relative" aria-hidden="true">
        <div class="absolute inset-x-0" style="top: -30px; bottom: -30px" :style="bannerInnerStyle">
          <img
            v-if="projectData.project.settings?.bannerUrl && !bannerError"
            :src="projectData.project.settings.bannerUrl"
            alt=""
            class="w-full h-full object-cover"
            @error="bannerError = true"
          />
        </div>
      </div>

      <div class="max-w-3xl mx-auto px-4 pt-8 pb-32 w-full">
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-2">
            <img
              v-if="projectData.project.settings?.logoUrl && !logoError"
              :src="projectData.project.settings.logoUrl"
              alt="Project logo"
              class="h-10 w-10 rounded object-cover border bg-muted"
              @error="logoError = true"
            />
            <div
              v-else
              class="h-10 w-10 rounded flex items-center justify-center text-white font-bold text-lg select-none shrink-0"
              :style="{ backgroundColor: accentColor }"
            >
              {{ projectInitial }}
            </div>
            <span class="text-sm text-muted-foreground">{{ projectData.team.name }}</span>
          </div>
          <h1 class="text-3xl font-bold mb-1">{{ projectData.project.name }}</h1>
          <p v-if="projectData.project.description" class="text-muted-foreground text-lg">
            {{ projectData.project.description }}
          </p>
        </div>

        <!-- Navigation tabs -->
        <div class="flex items-center gap-1 mb-8 border-b">
          <NuxtLink
            :to="paths.feedback"
            class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px"
          >
            <Icon name="lucide:message-square" class="w-4 h-4 inline mr-1.5" />
            Feedback
          </NuxtLink>
          <NuxtLink
            v-if="roadmapEnabled"
            :to="paths.roadmap"
            class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px"
          >
            <Icon name="lucide:map" class="w-4 h-4 inline mr-1.5" />
            Roadmap
          </NuxtLink>
          <component
            :is="active === 'changelog' ? 'span' : 'NuxtLink'"
            v-if="changelogEnabled || active === 'changelog'"
            v-bind="active === 'changelog' ? {} : { to: paths.changelog }"
            :class="tabClass('changelog')"
            :style="tabStyle('changelog')"
          >
            <Icon name="lucide:newspaper" class="w-4 h-4 inline mr-1.5" />
            Changelog
          </component>
          <component
            :is="active === 'testimonials' ? 'span' : 'NuxtLink'"
            v-if="projectData.hasTestimonials || active === 'testimonials'"
            v-bind="active === 'testimonials' ? {} : { to: paths.testimonials }"
            :class="tabClass('testimonials')"
            :style="tabStyle('testimonials')"
          >
            <Icon name="lucide:message-square-quote" class="w-4 h-4 inline mr-1.5" />
            Testimonials
          </component>
          <div class="ml-auto"><slot name="tabs-end" /></div>
        </div>

        <slot :project-data="projectData" :paths="paths" />
      </div>

      <div class="mt-auto py-3 text-center text-xs text-muted-foreground space-y-1">
        <div v-if="projectData.project.settings?.showPoweredBy !== false">
          Powered by
          <a href="https://veerify.io" target="_blank" rel="noopener noreferrer" class="hover:underline">Veerify</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { projectPaths, shellTitle } from '~/lib/public-shell'

const TAB_BASE = 'px-4 py-2 text-sm font-medium border-b-2 -mb-px'
const TAB_INACTIVE = 'text-muted-foreground hover:text-foreground transition-colors border-transparent'

/**
 * Shared frame of a product's public sub-pages (changelog, testimonials):
 * theme handling, banner, header with the product name, and the tab bar.
 * It loads the public project and emits `loaded`; the page content goes in the
 * default slot.
 */
export default {
  name: 'PublicProjectShell',
  props: {
    teamSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
    // Which tab is current: 'changelog' | 'testimonials'
    active: { type: String, required: true },
    // Optional page-specific title part (e.g. an entry title)
    pageTitle: { type: String, default: '' },
  },
  emits: ['loaded'],
  data() {
    return {
      projectData: null,
      isLoading: true,
      error: null,
      notFound: false,
      previousColorMode: null,
      activeTheme: 'system',
      logoError: false,
      bannerError: false,
      loadSeq: 0,
    }
  },
  computed: {
    apiBase() {
      return `/api/public/t/${encodeURIComponent(this.teamSlug)}/${encodeURIComponent(this.projectSlug)}`
    },
    accentColor() {
      return this.projectData?.project?.settings?.accentColor || '#6366f1'
    },
    projectInitial() {
      return (this.projectData?.project?.name || '').charAt(0).toUpperCase() || '?'
    },
    bannerInnerStyle() {
      const color = this.accentColor
      return { background: `linear-gradient(135deg, ${color} 0%, ${color}cc 50%, ${color}80 100%)` }
    },
    onCustomDomain() {
      return import.meta.client && this.projectData?.project?.customDomain === window.location.hostname
    },
    paths() {
      return projectPaths(this.projectSlug, this.onCustomDomain)
    },
    roadmapEnabled() {
      return this.projectData?.project?.settings?.roadmapEnabled === true
    },
    changelogEnabled() {
      return this.projectData?.project?.settings?.changelogEnabled === true
    },
    currentThemeIcon() {
      if (this.activeTheme === 'dark') return 'lucide:moon'
      if (this.activeTheme === 'light') return 'lucide:sun'
      return 'lucide:monitor'
    },
    currentThemeLabel() {
      if (this.activeTheme === 'dark') return 'Dark'
      if (this.activeTheme === 'light') return 'Light'
      return 'System'
    },
    showThemeToggle() {
      const forced = this.projectData?.project?.settings?.themeMode
      return !forced || forced === 'system'
    },
    documentTitle() {
      return shellTitle(this.active, this.projectData?.project?.name, this.pageTitle)
    },
    rssHref() {
      return this.active === 'changelog' && this.changelogEnabled ? `${this.apiBase}/changelog.rss` : null
    },
  },
  watch: {
    teamSlug() {
      this.load()
    },
    projectSlug() {
      this.load()
    },
  },
  created() {
    // Options API friendly: `useHead` accepts a getter, read lazily from this component's computed state
    useHead(() => ({
      title: this.documentTitle,
      link: this.rssHref
        ? [
            {
              rel: 'alternate',
              type: 'application/rss+xml',
              title: `${this.projectData?.project?.name || 'Product'} changelog`,
              href: this.rssHref,
            },
          ]
        : [],
    }))
  },
  beforeUnmount() {
    if (import.meta.client && this.previousColorMode) {
      this.$colorMode.preference = this.previousColorMode
    }
  },
  async mounted() {
    if (import.meta.client) {
      this.previousColorMode = this.$colorMode.preference
    }
    await this.load()
  },
  methods: {
    tabClass(tab) {
      return [TAB_BASE, tab === this.active ? '' : TAB_INACTIVE]
    },
    tabStyle(tab) {
      return tab === this.active ? { borderColor: this.accentColor, color: this.accentColor } : {}
    },
    async load() {
      const seq = ++this.loadSeq
      this.isLoading = true
      this.error = null
      this.notFound = false
      try {
        const response = await $fetch(this.apiBase)
        if (seq !== this.loadSeq) return
        const data = response?.data
        this.projectData = { project: data.project, team: data.team, hasTestimonials: data.hasTestimonials === true }
        this.applyTheme(data.project?.settings?.themeMode || 'system')
      } catch (err) {
        if (seq !== this.loadSeq) return
        console.error('Error loading project:', err)
        const status = err?.statusCode || err?.status || err?.response?.status
        this.notFound = status === 404 || status === 403
        this.error = this.notFound ? 'This page could not be found.' : 'Failed to load this page. Please try again.'
        this.isLoading = false
        return
      }
      // Emit first so the parent has the project before the slot first renders
      this.$emit('loaded', this.projectData)
      this.isLoading = false
    },
    applyTheme(mode) {
      this.activeTheme = mode
      if (import.meta.client) {
        this.$colorMode.preference = mode
      }
    },
    toggleTheme() {
      const cycle = { system: 'light', light: 'dark', dark: 'system' }
      this.applyTheme(cycle[this.activeTheme] || 'system')
    },
  },
}
</script>
