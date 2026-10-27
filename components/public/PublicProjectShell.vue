<template>
  <div class="min-h-screen bg-background relative flex flex-col" data-testid="public-project-shell">
    <!-- Top-right controls: always visible, so they never pop in on a tab switch -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
      <button
        v-if="showThemeToggle"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        @click="toggleTheme"
      >
        <Icon :name="currentThemeIcon" class="w-4 h-4" />
        {{ currentThemeLabel }}
      </button>
      <Skeleton v-if="!sessionChecked" class="h-8 w-28" />
      <!-- Logged-in state -->
      <template v-else-if="currentUser">
        <a
          :href="mainAppUrl + '/dashboard'"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        >
          <Icon name="lucide:layout-dashboard" class="w-4 h-4" />
          Dashboard
        </a>
        <div
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground bg-background/80 backdrop-blur-sm"
        >
          <Avatar class="h-5 w-5">
            <AvatarImage v-if="currentUser.image" :src="currentUser.image" />
            <AvatarFallback class="text-[9px]">{{ currentUserInitials }}</AvatarFallback>
          </Avatar>
          {{ currentUser.name }}
        </div>
      </template>
      <!-- Logged-out state -->
      <a
        v-else
        :href="mainAppUrl + '/login?redirect=' + authRedirectTarget"
        data-testid="public-auth-cta"
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Icon name="lucide:log-in" class="w-4 h-4" />
        Sign in / Join
      </a>
    </div>

    <!-- Project error -->
    <div v-if="error" class="max-w-5xl mx-auto px-4 py-12 w-full">
      <PublicStateMessage
        icon="lucide:alert-circle"
        kind="error"
        :title="notFound ? 'Project Not Found' : 'Something went wrong'"
        :message="error"
        :retryable="!notFound"
        @retry="load"
      />
    </div>

    <div v-else class="flex-1 flex flex-col">
      <!-- Decorative banner only: it carries no text so nothing can be clipped by it -->
      <div data-testid="public-board-banner" class="w-full h-24 md:h-36 overflow-hidden relative" aria-hidden="true">
        <div v-if="projectData" class="absolute inset-x-0" style="top: -30px; bottom: -30px" :style="bannerInnerStyle">
          <img
            v-if="projectData.project.settings?.bannerUrl && !bannerError"
            :src="projectData.project.settings.bannerUrl"
            alt=""
            class="w-full h-full object-cover"
            @error="bannerError = true"
          />
        </div>
        <Skeleton v-else class="h-full w-full rounded-none" />
      </div>

      <div class="max-w-5xl mx-auto px-4 pt-8 pb-32 w-full">
        <!-- Header -->
        <div v-if="projectData" class="mb-6">
          <div class="flex items-center gap-3 mb-2">
            <img
              v-if="projectData.project.settings?.logoUrl && !logoError"
              :src="projectData.project.settings.logoUrl"
              data-testid="public-board-logo"
              alt="Project logo"
              class="h-10 w-10 rounded object-cover border bg-muted"
              @error="logoError = true"
            />
            <div
              v-else
              data-testid="public-board-logo"
              class="h-10 w-10 rounded flex items-center justify-center text-white font-bold text-lg select-none shrink-0"
              :style="{ backgroundColor: accentColor }"
            >
              {{ projectInitial }}
            </div>
            <span class="text-sm text-muted-foreground">{{ projectData.organization?.name }}</span>
          </div>
          <h1 class="text-3xl font-bold mb-1">{{ projectData.project.name }}</h1>
          <p v-if="projectData.project.description" class="text-muted-foreground text-lg">
            {{ projectData.project.description }}
          </p>
        </div>
        <div v-else class="mb-6 space-y-3" aria-hidden="true">
          <div class="flex items-center gap-3">
            <Skeleton class="h-10 w-10 rounded" />
            <Skeleton class="h-4 w-32" />
          </div>
          <Skeleton class="h-9 w-64" />
          <Skeleton class="h-5 w-96 max-w-full" />
        </div>

        <!-- Navigation tabs: real links, so deep links and SSR keep working -->
        <div class="flex items-center gap-1 mb-8 border-b min-h-[41px]" data-testid="public-tabs">
          <template v-if="projectData">
            <NuxtLink
              v-for="tab in tabs"
              :key="tab.id"
              :to="tab.to"
              prefetch-on="interaction"
              :class="tabClass(tab.id)"
              :style="tabStyle(tab.id)"
              :aria-current="tab.id === active ? 'page' : undefined"
              :data-testid="`public-tab-${tab.id}`"
              @pointerenter="prefetchTab(tab.id)"
              @focus="prefetchTab(tab.id)"
            >
              <Icon :name="tab.icon" class="w-4 h-4 inline mr-1.5" />
              {{ tab.label }}
            </NuxtLink>
            <a
              v-if="rssHref"
              :href="rssHref"
              class="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              data-testid="changelog-rss-link"
            >
              <Icon name="lucide:rss" class="w-4 h-4" />
              RSS
            </a>
          </template>
          <template v-else>
            <Skeleton v-for="n in 3" :key="n" class="mx-3 h-4 w-20" />
          </template>
        </div>

        <!-- Tab body -->
        <slot
          v-if="projectData"
          :project-data="projectData"
          :paths="paths"
          :current-user="currentUser"
          :main-app-url="mainAppUrl"
          :auth-redirect-target="authRedirectTarget"
          :reload-project="reloadProject"
        />
        <div v-else class="space-y-4" aria-hidden="true">
          <Skeleton v-for="n in 3" :key="n" class="h-28 w-full" />
        </div>
      </div>

      <div v-if="projectData" class="mt-auto py-3 text-center text-xs text-muted-foreground space-y-1">
        <div v-if="showCustomFooter" data-testid="public-footer-custom" class="space-y-1">
          <p v-if="customFooterBranding" class="text-xs font-medium text-foreground">{{ customFooterBranding }}</p>
          <p v-if="customFooterText" class="text-xs text-muted-foreground">{{ customFooterText }}</p>
          <div
            v-if="customFooterLinks.length > 0"
            class="flex items-center justify-center gap-3 text-xs text-muted-foreground"
          >
            <a
              v-for="(link, index) in customFooterLinks"
              :key="`${link.label}-${link.url}`"
              :data-testid="`public-footer-custom-link-${index}`"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              {{ link.label }}
            </a>
          </div>
        </div>
        <template v-else>
          <div v-if="projectData.project.settings?.showPoweredBy !== false" data-testid="public-footer-powered-by">
            Powered by
            <a href="https://veerify.io" target="_blank" rel="noopener noreferrer" class="hover:underline">Veerify</a>
          </div>
          <div v-if="projectData.project.settings?.showGithubFooter !== false" data-testid="public-footer-github">
            Open source &amp; contributions welcome &mdash;
            <a
              href="https://github.com/Frogbyte-io/veerify"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline inline-flex items-center gap-1"
            >
              <Icon name="lucide:github" class="h-3 w-3" />GitHub
            </a>
            &middot;
            <a
              href="https://github.com/Frogbyte-io/veerify/issues"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
              >report an issue</a
            >
            &middot;
            <a
              data-testid="public-footer-veerify-board"
              href="https://feedback.veerify.io"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              Veerify feedback board
            </a>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { completePublicAuthHandoffFromUrl, fetchPublicAuthSession } from '~/lib/public-auth-handoff'
import { publicApiBase, publicCache, publicCacheKey, publicCacheScope, publicTabRequest } from '~/lib/public-cache'
import { projectPaths, shellTitle } from '~/lib/public-shell'

function normalizeProject(data) {
  return { ...data, products: data.products || [], hasTestimonials: data.hasTestimonials === true }
}

const TAB_BASE = 'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors'
const TAB_INACTIVE = 'text-muted-foreground hover:text-foreground border-transparent'

/**
 * The one persistent frame of a project's public site. It is mounted once by the
 * route page and stays mounted while the visitor switches tabs; only the tab
 * body (default slot) is replaced. It loads the public project once and owns
 * the theme, banner, header, sign-in cluster, tab bar and footer.
 */
export default {
  name: 'PublicProjectShell',
  props: {
    orgSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
    // Current tab: 'feedback' | 'roadmap' | 'changelog' | 'testimonials'
    active: { type: String, required: true },
    // Optional page-specific title part (e.g. a changelog entry title)
    pageTitle: { type: String, default: '' },
  },
  data() {
    // Seed from the cache so a remount (e.g. leaving the index page on a custom domain) shows no skeleton
    const cached = publicCache.peek(publicCacheKey(publicCacheScope(this.orgSlug, this.projectSlug), 'project'))
    return {
      projectData: cached ? normalizeProject(cached.data) : null,
      error: null,
      notFound: false,
      previousColorMode: null,
      activeTheme: 'system',
      themeAppliedFor: null,
      logoError: false,
      bannerError: false,
      loadSeq: 0,
      scrollY: 0,
      currentUser: null,
      sessionChecked: false,
    }
  },
  computed: {
    apiBase() {
      return publicApiBase(this.orgSlug, this.projectSlug)
    },
    projectKey() {
      return publicCacheKey(publicCacheScope(this.orgSlug, this.projectSlug), 'project')
    },
    accentColor() {
      return this.projectData?.project?.settings?.accentColor || '#6366f1'
    },
    projectInitial() {
      return (this.projectData?.project?.name || '').charAt(0).toUpperCase() || '?'
    },
    bannerInnerStyle() {
      const color = this.accentColor
      const offset = Math.min(this.scrollY * 0.25, 30)
      return {
        background: `linear-gradient(135deg, ${color} 0%, ${color}cc 50%, ${color}80 100%)`,
        transform: `translateY(${offset}px)`,
        willChange: 'transform',
      }
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
    // Visibility depends on project settings, all known once the project has loaded
    tabs() {
      const tabs = [{ id: 'feedback', label: 'Feedback', icon: 'lucide:message-square', to: this.paths.feedback }]
      if (this.roadmapEnabled || this.active === 'roadmap') {
        tabs.push({ id: 'roadmap', label: 'Roadmap', icon: 'lucide:map', to: this.paths.roadmap })
      }
      if (this.changelogEnabled || this.active === 'changelog') {
        tabs.push({ id: 'changelog', label: 'Changelog', icon: 'lucide:newspaper', to: this.paths.changelog })
      }
      if (this.projectData?.hasTestimonials || this.active === 'testimonials') {
        tabs.push({
          id: 'testimonials',
          label: 'Testimonials',
          icon: 'lucide:message-square-quote',
          to: this.paths.testimonials,
        })
      }
      return tabs
    },
    // A single-product project opens straight onto its board
    singleProductSlug() {
      const products = this.projectData?.products || []
      return products.length === 1 ? products[0].slug : ''
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
      if (!this.projectData) return false
      const forced = this.projectData.project?.settings?.themeMode
      return !forced || forced === 'system'
    },
    mainAppUrl() {
      if (!import.meta.client) return ''
      const config = useRuntimeConfig()
      const dashboardDomain = config.public.dashboardDomain || config.public.appDomain || 'localhost'
      const protocol = window.location.protocol
      const port = dashboardDomain === 'localhost' ? ':' + window.location.port : ''
      return `${protocol}//${dashboardDomain}${port}`
    },
    authRedirectTarget() {
      if (!import.meta.client) return encodeURIComponent(`/${this.projectSlug}`)
      return encodeURIComponent(window.location.href)
    },
    currentUserInitials() {
      const name = this.currentUser?.name || this.currentUser?.email || '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
    customFooterBranding() {
      return this.projectData?.project?.settings?.customFooterBranding?.trim() || ''
    },
    customFooterText() {
      return this.projectData?.project?.settings?.customFooterText?.trim() || ''
    },
    customFooterLinks() {
      const settings = this.projectData?.project?.settings || {}
      const links = [
        { label: settings.customFooterPrimaryLabel?.trim(), url: settings.customFooterPrimaryUrl?.trim() },
        { label: settings.customFooterSecondaryLabel?.trim(), url: settings.customFooterSecondaryUrl?.trim() },
      ]
      return links.filter((link) => link.label && link.url)
    },
    showCustomFooter() {
      return (
        this.projectData?.project?.settings?.customFooterEnabled === true &&
        (this.customFooterBranding || this.customFooterText || this.customFooterLinks.length > 0)
      )
    },
    documentTitle() {
      return shellTitle(this.active, this.projectData?.project?.name, this.pageTitle)
    },
    rssHref() {
      return this.active === 'changelog' && this.changelogEnabled ? `${this.apiBase}/changelog.rss` : null
    },
  },
  watch: {
    projectKey() {
      this.projectData = null
      this.themeAppliedFor = null
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
              title: `${this.projectData?.project?.name || 'Project'} changelog`,
              href: this.rssHref,
            },
          ]
        : [],
    }))
  },
  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener('scroll', this.handleScroll)
      // The theme is restored only when the whole shell goes away, never on a tab switch
      if (this.previousColorMode) this.$colorMode.preference = this.previousColorMode
    }
  },
  async mounted() {
    if (import.meta.client) {
      this.previousColorMode = this.$colorMode.preference
      window.addEventListener('scroll', this.handleScroll, { passive: true })
    }
    this.checkCurrentUser()
    await this.load()
  },
  methods: {
    handleScroll() {
      this.scrollY = window.scrollY
    },
    tabClass(tab) {
      return [TAB_BASE, tab === this.active ? '' : TAB_INACTIVE]
    },
    tabStyle(tab) {
      return tab === this.active ? { borderColor: this.accentColor, color: this.accentColor } : {}
    },
    fetchProject() {
      return $fetch(this.apiBase).then((response) => response?.data)
    },
    setProject(data) {
      this.projectData = normalizeProject(data)
      // Apply the project theme once per project, not on every revalidation (that would undo the visitor's toggle)
      if (this.themeAppliedFor !== this.projectKey) {
        this.themeAppliedFor = this.projectKey
        this.applyTheme(data.project?.settings?.themeMode || 'system')
      }
    },
    async load() {
      const seq = ++this.loadSeq
      this.error = null
      this.notFound = false
      const hit = publicCache.peek(this.projectKey)
      if (hit) {
        this.setProject(hit.data)
        if (!hit.stale) return
      }
      try {
        const data = await publicCache.load(this.projectKey, this.fetchProject, { force: Boolean(hit) })
        if (seq !== this.loadSeq) return
        if (!data?.project) throw createError({ statusCode: 404 })
        this.setProject(data)
      } catch (err) {
        if (seq !== this.loadSeq) return
        // A stale copy is already on screen: keep it rather than replacing it with an error
        if (hit) return
        console.error('Error loading project:', err)
        const status = err?.statusCode || err?.status || err?.response?.status
        this.notFound = status === 404 || status === 403
        this.error = this.notFound ? 'This page could not be found.' : 'Failed to load this page. Please try again.'
      }
    },
    // Silent refresh for tab bodies whose actions change project-level data (e.g. feedback stats)
    async reloadProject() {
      try {
        const data = await publicCache.load(this.projectKey, this.fetchProject, { force: true })
        if (data?.project) this.setProject(data)
      } catch {
        // Keep showing what we have
      }
    },
    // Warm the tab's first page of data; the tab body reads the same cache entry
    prefetchTab(tab) {
      if (!import.meta.client || tab === this.active) return
      const request = publicTabRequest(tab, this.orgSlug, this.projectSlug, { productSlug: this.singleProductSlug })
      if (request) publicCache.prefetch(request.key, request.fetcher)
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
    async checkCurrentUser() {
      if (!import.meta.client) return
      const handoffCompleted = await completePublicAuthHandoffFromUrl().catch(() => false)
      try {
        const sessionResult = await fetchPublicAuthSession()
        this.currentUser = sessionResult?.user || null
        if (handoffCompleted && this.currentUser) {
          await $fetch('/api/auth/merge-anonymous', { method: 'POST' }).catch(() => {})
        }
      } catch {
        this.currentUser = null
      } finally {
        this.sessionChecked = true
      }
    },
  },
}
</script>
