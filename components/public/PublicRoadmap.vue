<template>
  <div class="min-h-screen bg-background relative flex flex-col">
    <!-- Top-right controls: always visible -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
      <button
        v-if="showThemeToggle"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        @click="toggleTheme"
      >
        <Icon :name="currentThemeIcon" class="w-4 h-4" />
        {{ currentThemeLabel }}
      </button>
      <!-- Logged-in state -->
      <template v-if="currentUser">
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

    <!-- Loading State -->
    <div v-if="isLoading" class="max-w-6xl mx-auto px-4 py-12 w-full">
      <div class="space-y-4">
        <Skeleton class="h-10 w-64" />
        <Skeleton class="h-5 w-96" />
        <div class="flex gap-4 mt-8">
          <div v-for="n in 3" :key="n" class="flex-1 space-y-3">
            <Skeleton class="h-8 w-full" />
            <Skeleton v-for="m in 3" :key="m" class="h-24 w-full" />
          </div>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="max-w-6xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">Project Not Found</h1>
      <p class="text-muted-foreground">{{ error }}</p>
    </div>

    <!-- Main Content -->
    <div v-else-if="projectData" class="flex-1 flex flex-col">
      <!-- Banner -->
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
            <div class="max-w-6xl w-full mx-auto px-4 pb-4">
              <p class="text-white/60 text-sm font-medium tracking-wide uppercase">Roadmap</p>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-6xl mx-auto px-4 pt-8 pb-32 w-full">
        <!-- Header -->
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-2">
            <template v-if="projectData.project.settings?.logoUrl && !logoError">
              <img
                :src="projectData.project.settings.logoUrl"
                alt="Project logo"
                class="h-10 w-10 rounded object-cover border bg-muted"
                @error="logoError = true"
              />
            </template>
            <div
              v-else
              class="h-10 w-10 rounded flex items-center justify-center text-white font-bold text-lg select-none shrink-0"
              :style="logoFallbackStyle"
            >
              {{ projectInitial }}
            </div>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{{ projectData.team.name }}</span>
            </div>
          </div>
          <h1 class="text-3xl font-bold mb-1">{{ projectData.project.name }}</h1>
          <p v-if="projectData.project.description" class="text-muted-foreground text-lg">
            {{ projectData.project.description }}
          </p>
        </div>

        <!-- Navigation tabs -->
        <div class="flex items-center gap-1 mb-8 border-b">
          <NuxtLink
            :to="feedbackBoardPath"
            prefetch-on="interaction"
            class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px"
            @pointerenter="warmFeedbackBoardData"
            @focus="warmFeedbackBoardData"
          >
            <Icon name="lucide:message-square" class="w-4 h-4 inline mr-1.5" />
            Feedback
          </NuxtLink>
          <span
            class="px-4 py-2 text-sm font-medium border-b-2 -mb-px"
            :style="{ borderColor: accentColor, color: accentColor }"
          >
            <Icon name="lucide:map" class="w-4 h-4 inline mr-1.5" />
            Roadmap
          </span>
        </div>

        <!-- Roadmap summary -->
        <p class="text-muted-foreground text-sm mb-6">
          A timeline view of all feedback items grouped by status.
        </p>

        <!-- Loading columns skeleton -->
        <div v-if="columnsLoading" class="flex gap-4 overflow-x-auto pb-4">
          <div v-for="n in 3" :key="n" class="flex-shrink-0 w-72 space-y-2">
            <Skeleton class="h-8 w-full" />
            <Skeleton v-for="m in 3" :key="m" class="h-24 w-full" />
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="visibleColumns.length === 0" class="text-center py-20 text-muted-foreground">
          <Icon name="lucide:map" class="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p class="font-medium">No roadmap items yet</p>
          <p class="text-sm mt-1">Submit feedback to see it appear here.</p>
          <NuxtLink
            :to="feedbackBoardPath"
            prefetch-on="interaction"
            class="inline-block mt-4 text-sm text-primary hover:underline"
            @pointerenter="warmFeedbackBoardData"
            @focus="warmFeedbackBoardData"
          >
            <Icon name="lucide:arrow-left" class="w-4 h-4 inline mr-1" />
            Back to feedback board
          </NuxtLink>
        </div>

        <!-- Kanban columns -->
        <div v-else class="flex gap-4 overflow-x-auto pb-4">
          <div
            v-for="column in visibleColumns"
            :key="column.value"
            class="flex-shrink-0 w-72 flex flex-col"
          >
            <!-- Column header -->
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <span
                  class="inline-block w-2.5 h-2.5 rounded-full"
                  :style="{ backgroundColor: column.color || '#6b7280' }"
                />
                <h3 class="font-semibold text-sm">{{ column.name }}</h3>
              </div>
              <span class="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {{ column.items.length }}
              </span>
            </div>

            <!-- Column cards -->
            <div class="space-y-2 flex-1">
              <div
                v-for="item in column.items"
                :key="item.id"
                class="rounded-lg border bg-card p-3 hover:shadow-sm transition-shadow cursor-pointer"
                @click="openFeedbackItem(item)"
              >
                <!-- Pin indicator -->
                <div v-if="item.isPinned" class="flex items-center gap-1 text-xs text-amber-600 mb-1.5">
                  <Icon name="lucide:pin" class="w-3 h-3" />
                  <span>Pinned</span>
                </div>

                <!-- Category + tag -->
                <div v-if="item.category || item.tag" class="flex flex-wrap gap-1 mb-2">
                  <span
                    v-if="item.category"
                    class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium"
                    :style="{
                      backgroundColor: item.category.color ? item.category.color + '22' : '#6b728022',
                      color: item.category.color || '#6b7280',
                    }"
                  >
                    <Icon v-if="item.category.icon" :name="'lucide:' + item.category.icon" class="w-3 h-3" />
                    {{ item.category.name }}
                  </span>
                  <span
                    v-if="item.tag"
                    class="inline-flex items-center text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                  >
                    {{ feedbackTypeLabel(item.tag) }}
                  </span>
                </div>

                <!-- Title -->
                <p class="text-sm font-medium line-clamp-2 mb-2">{{ item.title }}</p>

                <!-- Meta: votes + comments + date -->
                <div class="flex items-center gap-3 text-xs text-muted-foreground">
                  <span class="flex items-center gap-1">
                    <Icon name="lucide:chevrons-up" class="w-3 h-3" />
                    {{ item.voteCount }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon name="lucide:message-circle" class="w-3 h-3" />
                    {{ item.commentCount }}
                  </span>
                  <span class="ml-auto">{{ formatDate(item.createdAt) }}</span>
                </div>
              </div>

              <!-- Empty column placeholder -->
              <div
                v-if="column.items.length === 0"
                class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground"
              >
                No items
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="mt-auto py-3 text-center text-xs text-muted-foreground space-y-1">
        <div v-if="showCustomFooter" class="space-y-1">
          <p v-if="customFooterBranding" class="text-xs font-medium text-foreground">
            {{ customFooterBranding }}
          </p>
          <p v-if="customFooterText" class="text-xs text-muted-foreground">{{ customFooterText }}</p>
          <div v-if="customFooterLinks.length > 0" class="flex items-center justify-center gap-3">
            <a
              v-for="(link, index) in customFooterLinks"
              :key="`${link.label}-${index}`"
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
          <div v-if="projectData?.project?.settings?.showPoweredBy !== false">
            Powered by
            <a href="https://veerify.io" target="_blank" rel="noopener noreferrer" class="hover:underline">Veerify</a>
          </div>
          <div v-if="projectData?.project?.settings?.showGithubFooter !== false">
            Open source &amp; contributions welcome &mdash;
            <a
              href="https://github.com/Frogbyte-io/veerify"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline inline-flex items-center gap-1"
            >
              <Icon name="lucide:github" class="h-3 w-3" />GitHub
            </a>
          </div>
        </template>
      </div>
    </div>

    <!-- Feedback detail dialog (reused from board) -->
    <Dialog :open="showDetailsDialog" @update:open="showDetailsDialog = $event">
      <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <div v-if="detailsLoading" class="space-y-4 p-2">
          <Skeleton class="h-6 w-3/4" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-2/3" />
        </div>
        <div v-else-if="selectedFeedback" class="space-y-4">
          <DialogHeader>
            <DialogTitle class="text-xl font-bold pr-8">{{ selectedFeedback.title }}</DialogTitle>
          </DialogHeader>
          <p v-if="selectedFeedback.body" class="text-sm text-muted-foreground whitespace-pre-wrap">
            {{ selectedFeedback.body }}
          </p>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              class="px-2 py-0.5 rounded-full font-medium"
              :style="statusBadgeStyle(selectedFeedback.status)"
            >
              {{ selectedFeedback.status }}
            </span>
            <span>{{ selectedFeedback.voteCount }} votes</span>
            <span>&middot;</span>
            <span>{{ formatDate(selectedFeedback.createdAt) }}</span>
          </div>
          <NuxtLink
            :to="feedbackBoardPath"
            prefetch-on="interaction"
            class="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            @pointerenter="warmFeedbackBoardData"
            @focus="warmFeedbackBoardData"
          >
            <Icon name="lucide:external-link" class="w-4 h-4" />
            View on feedback board
          </NuxtLink>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'

const FEEDBACK_BOARD_PREFETCH_CACHE_TTL_MS = 60_000

export default {
  name: 'PublicRoadmap',
  props: {
    teamSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
  },
  data() {
    return {
      projectData: null,
      columns: [],
      isLoading: true,
      columnsLoading: true,
      error: null,
      previousColorMode: null,
      activeTheme: 'system',
      logoError: false,
      bannerError: false,
      currentUser: null,
      feedbackBoardPrefetch: null,
      showDetailsDialog: false,
      detailsLoading: false,
      selectedFeedback: null,
      feedbackTypeOptions: [
        { value: 'feature_request', label: 'Feature Request' },
        { value: 'bug_report', label: 'Bug Report' },
        { value: 'improvement', label: 'Improvement' },
        { value: 'question', label: 'Question' },
        { value: 'other', label: 'Other' },
      ],
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
      return {
        background: `linear-gradient(135deg, ${color} 0%, ${color}cc 50%, ${color}80 100%)`,
      }
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
      return `/${this.projectSlug}`
    },
    authRedirectTarget() {
      if (!import.meta.client) return encodeURIComponent(`/${this.projectSlug}/roadmap`)
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
    visibleColumns() {
      return this.columns.filter((col) => col.items.length > 0)
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
    // Use data prefetched by the feedback board page to skip the full-page loading skeleton
    const roadmapCacheKey = `pubRoadmapData_${this.teamSlug}_${this.projectSlug}`
    const cached = import.meta.client ? useState(roadmapCacheKey).value : null
    if (cached && Date.now() - cached.cachedAt < 60_000 && cached.response?.data) {
      const data = cached.response.data
      this.projectData = { project: data.project, team: data.team }
      this.columns = data.columns || []
      this.isLoading = false
      this.columnsLoading = false
      this.applyTheme(data.project?.settings?.themeMode || 'system')
      this.warmFeedbackBoardData()
      this.checkCurrentUser()
      return
    }
    try {
      const response = await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}/roadmap`)
      const data = response?.data
      this.projectData = { project: data.project, team: data.team }
      this.columns = data.columns || []
      this.applyTheme(this.projectData.project.settings?.themeMode || 'system')
      this.warmFeedbackBoardData()
      this.checkCurrentUser()
    } catch (err) {
      console.error('Error loading roadmap:', err)
      this.error = 'This roadmap could not be found.'
    } finally {
      this.isLoading = false
      this.columnsLoading = false
    }
  },
  methods: {
    warmFeedbackBoardData() {
      const now = Date.now()
      const cachedAt = this.feedbackBoardPrefetch?.cachedAt || 0
      if (this.feedbackBoardPrefetch?.promise && now - cachedAt < FEEDBACK_BOARD_PREFETCH_CACHE_TTL_MS) {
        return this.feedbackBoardPrefetch.promise
      }

      const params = new URLSearchParams({
        page: '1',
        limit: '20',
        sortBy: 'voteCount',
        sortOrder: 'desc',
      })

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
      try {
        const sessionResult = await authClient.getSession()
        this.currentUser = sessionResult?.data?.user || null
      } catch {
        this.currentUser = null
      }
    },
    feedbackTypeLabel(value) {
      const option = this.feedbackTypeOptions.find((item) => item.value === value)
      return option?.label || value
    },
    formatDate(date) {
      if (!date) return ''
      const d = new Date(date)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      return d.toLocaleDateString()
    },
    statusBadgeStyle(status) {
      const colorMap = {
        open: '#3b82f6',
        planned: '#8b5cf6',
        in_progress: '#f59e0b',
        completed: '#10b981',
        closed: '#6b7280',
        declined: '#ef4444',
      }
      const color = colorMap[status] || '#6b7280'
      return {
        backgroundColor: color + '22',
        color,
      }
    },
    openFeedbackItem(item) {
      this.selectedFeedback = item
      this.showDetailsDialog = true
    },
  },
}
</script>
