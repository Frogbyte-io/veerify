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
      <template v-if="currentUser">
        <a
          :href="mainAppUrl + '/dashboard'"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        >
          <Icon name="lucide:layout-dashboard" class="w-4 h-4" />
          Dashboard
        </a>
      </template>
      <template v-else>
        <a
          :href="mainAppUrl + '/login?redirect=' + authRedirectTarget"
          data-testid="public-auth-cta"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md"
        >
          <Icon name="lucide:log-in" class="w-4 h-4" />
          Sign in / Join
        </a>
      </template>
    </div>

    <div v-if="isLoading" class="max-w-5xl mx-auto px-4 py-12 w-full space-y-4">
      <Skeleton class="h-10 w-64" />
      <Skeleton class="h-5 w-96" />
      <Skeleton v-for="n in 3" :key="n" class="h-32 w-full" />
    </div>

    <div v-else-if="error" class="max-w-5xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">Project Not Found</h1>
      <p class="text-muted-foreground">{{ error }}</p>
    </div>

    <div v-else-if="projectData && !changelogEnabled" class="max-w-4xl mx-auto px-4 py-24 text-center">
      <Icon name="lucide:newspaper" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
      <h1 class="text-2xl font-bold mb-2">Changelog not available</h1>
      <p class="text-muted-foreground mb-6">This product has not enabled a public changelog.</p>
      <NuxtLink
        :to="feedbackBoardPath"
        class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Icon name="lucide:message-square" class="w-4 h-4" />
        View Feedback Board
      </NuxtLink>
    </div>

    <div v-else-if="projectData" class="flex-1 flex flex-col">
      <div class="w-full h-24 md:h-36 overflow-hidden relative">
        <div class="absolute inset-x-0" style="top: -30px; bottom: -30px" :style="bannerInnerStyle">
          <img
            v-if="projectData.project.settings?.bannerUrl && !bannerError"
            :src="projectData.project.settings.bannerUrl"
            alt=""
            class="w-full h-full object-cover"
            @error="bannerError = true"
          />
          <div v-if="!projectData.project.settings?.bannerUrl || bannerError" class="absolute inset-0 flex items-end">
            <div class="max-w-5xl w-full mx-auto px-4 pb-4">
              <p class="text-white/60 text-sm font-medium tracking-wide uppercase">Changelog</p>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-5xl mx-auto px-4 pt-8 pb-24 w-full">
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-2">
            <template v-if="projectData.project.settings?.logoUrl && !logoError">
              <img :src="projectData.project.settings.logoUrl" alt="Project logo" class="h-10 w-10 rounded object-cover border bg-muted" @error="logoError = true" />
            </template>
            <div v-else class="h-10 w-10 rounded flex items-center justify-center text-white font-bold text-lg select-none shrink-0" :style="logoFallbackStyle">
              {{ projectInitial }}
            </div>
            <div class="text-sm text-muted-foreground">{{ projectData.team.name }}</div>
          </div>
          <h1 class="text-3xl font-bold mb-1">{{ projectData.project.name }}</h1>
          <p v-if="projectData.project.description" class="text-muted-foreground text-lg">{{ projectData.project.description }}</p>
        </div>

        <div class="flex items-center gap-1 mb-8 border-b">
          <NuxtLink :to="feedbackBoardPath" prefetch-on="interaction" class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px" @pointerenter="warmFeedbackBoardData" @focus="warmFeedbackBoardData">
            <Icon name="lucide:message-square" class="w-4 h-4 inline mr-1.5" />
            Feedback
          </NuxtLink>
          <NuxtLink v-if="roadmapEnabled" :to="roadmapPath" prefetch-on="interaction" class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px" @pointerenter="warmRoadmapData" @focus="warmRoadmapData">
            <Icon name="lucide:map" class="w-4 h-4 inline mr-1.5" />
            Roadmap
          </NuxtLink>
          <span class="px-4 py-2 text-sm font-medium border-b-2 -mb-px" :style="{ borderColor: accentColor, color: accentColor }">
            <Icon name="lucide:newspaper" class="w-4 h-4 inline mr-1.5" />
            Changelog
          </span>
        </div>

        <div class="mb-6 flex items-center justify-between gap-4 rounded-2xl border bg-card p-4">
          <div>
            <p class="text-sm font-medium">Release notes and shipped updates</p>
            <p class="text-sm text-muted-foreground">Imported changelog posts appear in chronological order once published.</p>
          </div>
          <div class="text-right">
            <p class="text-3xl font-semibold">{{ posts.length }}</p>
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Published posts</p>
          </div>
        </div>

        <div v-if="posts.length === 0" class="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
          <Icon name="lucide:newspaper" class="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p class="font-medium">No changelog posts yet</p>
          <p class="text-sm mt-1">Updates will appear here after the team publishes them.</p>
        </div>

        <div v-else class="space-y-4">
          <article v-for="post in posts" :key="post.id" class="rounded-2xl border bg-card p-6">
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span class="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-medium">{{ formatDate(post.publishedAt || post.createdAt) }}</span>
              <span v-if="post.category" class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{{ post.category }}</span>
            </div>
            <h2 class="mt-4 text-xl font-semibold">{{ post.title }}</h2>
            <p class="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{{ post.body }}</p>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { completePublicAuthHandoffFromUrl, fetchPublicAuthSession } from '~/lib/public-auth-handoff'

const PREFETCH_CACHE_TTL_MS = 60_000

export default {
  name: 'PublicChangelog',
  props: {
    teamSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
  },
  data() {
    return {
      projectData: null,
      posts: [],
      isLoading: true,
      error: null,
      previousColorMode: null,
      activeTheme: 'system',
      logoError: false,
      bannerError: false,
      currentUser: null,
      feedbackBoardPrefetch: null,
      roadmapPrefetch: null,
    }
  },
  computed: {
    accentColor() {
      return this.projectData?.project?.settings?.accentColor || '#6366f1'
    },
    projectInitial() {
      const name = this.projectData?.project?.name || ''
      return name.charAt(0).toUpperCase() || '?'
    },
    bannerInnerStyle() {
      const color = this.accentColor
      return { background: `linear-gradient(135deg, ${color} 0%, ${color}cc 50%, ${color}80 100%)` }
    },
    logoFallbackStyle() {
      return { backgroundColor: this.accentColor }
    },
    mainAppUrl() {
      if (!import.meta.client) return ''
      const config = useRuntimeConfig()
      const dashboardDomain = config.public.dashboardDomain || config.public.appDomain || 'localhost'
      const protocol = window.location.protocol
      const port = dashboardDomain === 'localhost' ? ':' + window.location.port : ''
      return `${protocol}//${dashboardDomain}${port}`
    },
    feedbackBoardPath() {
      if (import.meta.client && this.projectData?.project?.customDomain === window.location.hostname) return '/'
      return `/${this.projectSlug}`
    },
    roadmapPath() {
      if (import.meta.client && this.projectData?.project?.customDomain === window.location.hostname) return '/roadmap'
      return `/${this.projectSlug}/roadmap`
    },
    roadmapEnabled() {
      return this.projectData?.project?.settings?.roadmapEnabled === true
    },
    changelogEnabled() {
      return this.projectData?.project?.settings?.changelogEnabled === true
    },
    authRedirectTarget() {
      if (!import.meta.client) return encodeURIComponent(`/${this.projectSlug}/changelog`)
      return encodeURIComponent(window.location.href)
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
    const cacheKey = `pubChangelogData_${this.teamSlug}_${this.projectSlug}`
    const cached = import.meta.client ? useState(cacheKey).value : null
    if (cached && Date.now() - cached.cachedAt < PREFETCH_CACHE_TTL_MS && cached.response?.data) {
      const data = cached.response.data
      this.projectData = { project: data.project, team: data.team }
      this.posts = Array.isArray(data.posts) ? data.posts : []
      this.applyTheme(data.project?.settings?.themeMode || 'system')
      this.warmFeedbackBoardData()
      this.warmRoadmapData()
      await this.checkCurrentUser()
      this.isLoading = false
      return
    }

    try {
      const response = await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}/changelog`)
      const data = response?.data
      this.projectData = { project: data.project, team: data.team }
      this.posts = Array.isArray(data.posts) ? data.posts : []
      this.applyTheme(data.project?.settings?.themeMode || 'system')
      this.warmFeedbackBoardData()
      this.warmRoadmapData()
      await this.checkCurrentUser()
    } catch (err) {
      console.error('Error loading changelog:', err)
      this.error = 'This changelog could not be found.'
    } finally {
      this.isLoading = false
    }
  },
  methods: {
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
    formatDate(value) {
      if (!value) return 'Just now'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return 'Just now'
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
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
      }
    },
    warmFeedbackBoardData() {
      const now = Date.now()
      const cachedAt = this.feedbackBoardPrefetch?.cachedAt || 0
      if (this.feedbackBoardPrefetch?.promise && now - cachedAt < PREFETCH_CACHE_TTL_MS) {
        return this.feedbackBoardPrefetch.promise
      }
      const params = new URLSearchParams({ page: '1', limit: '20', sortBy: 'voteCount', sortOrder: 'desc' })
      const cacheKey = `pubBoardData_${this.teamSlug}_${this.projectSlug}`
      const promise = Promise.all([
        $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}`),
        $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}/feedback?${params.toString()}`),
      ])
        .then(([projectResponse, feedbackResponse]) => {
          if (import.meta.client) {
            useState(cacheKey).value = { projectResponse, feedbackResponse, cachedAt: Date.now() }
          }
          return [projectResponse, feedbackResponse]
        })
        .catch(() => null)
      this.feedbackBoardPrefetch = { promise, cachedAt: now }
      return promise
    },
    warmRoadmapData() {
      if (!this.roadmapEnabled) return Promise.resolve(null)
      const now = Date.now()
      const cachedAt = this.roadmapPrefetch?.cachedAt || 0
      if (this.roadmapPrefetch?.promise && now - cachedAt < PREFETCH_CACHE_TTL_MS) {
        return this.roadmapPrefetch.promise
      }
      const cacheKey = `pubRoadmapData_${this.teamSlug}_${this.projectSlug}`
      const promise = $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}/roadmap`)
        .then((response) => {
          if (import.meta.client) {
            useState(cacheKey).value = { response, cachedAt: Date.now() }
          }
          return response
        })
        .catch(() => null)
      this.roadmapPrefetch = { promise, cachedAt: now }
      return promise
    },
  },
}
</script>
