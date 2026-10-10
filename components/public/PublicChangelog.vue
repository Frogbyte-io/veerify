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
      <h1 class="text-2xl font-bold mb-2">Project Not Found</h1>
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <button class="text-sm text-primary hover:underline" @click="load">Try again</button>
    </div>

    <!-- Changelog disabled -->
    <div v-else-if="projectData && !changelogEnabled" class="max-w-4xl mx-auto px-4 py-24 text-center">
      <Icon name="lucide:newspaper" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
      <h1 class="text-2xl font-bold mb-2">Changelog not available</h1>
      <p class="text-muted-foreground mb-6">The changelog is not enabled for this product.</p>
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
            <div class="max-w-3xl w-full mx-auto px-4 pb-4">
              <p class="text-white/60 text-sm font-medium tracking-wide uppercase">Changelog</p>
            </div>
          </div>
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
            :to="feedbackBoardPath"
            class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px"
          >
            <Icon name="lucide:message-square" class="w-4 h-4 inline mr-1.5" />
            Feedback
          </NuxtLink>
          <NuxtLink
            v-if="roadmapEnabled"
            :to="roadmapPath"
            class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent -mb-px"
          >
            <Icon name="lucide:map" class="w-4 h-4 inline mr-1.5" />
            Roadmap
          </NuxtLink>
          <span
            class="px-4 py-2 text-sm font-medium border-b-2 -mb-px"
            :style="{ borderColor: accentColor, color: accentColor }"
          >
            <Icon name="lucide:newspaper" class="w-4 h-4 inline mr-1.5" />
            Changelog
          </span>
          <a
            :href="rssUrl"
            class="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="changelog-rss-link"
          >
            <Icon name="lucide:rss" class="w-4 h-4" />
            RSS
          </a>
        </div>

        <div v-if="entriesLoading" class="space-y-6">
          <Skeleton v-for="n in 3" :key="n" class="h-40 w-full" />
        </div>

        <div v-else-if="entriesError" class="text-center py-16">
          <Icon name="lucide:alert-circle" class="w-10 h-10 mx-auto text-destructive mb-3" />
          <p class="font-medium mb-1">{{ entriesError }}</p>
          <NuxtLink v-if="entrySlug" :to="changelogPath" class="block text-sm text-primary hover:underline mt-2">
            Back to the changelog
          </NuxtLink>
          <button v-else class="text-sm text-primary hover:underline mt-2" @click="loadEntries">Try again</button>
        </div>

        <div v-else-if="entries.length === 0" class="text-center py-20 text-muted-foreground">
          <Icon name="lucide:newspaper" class="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p class="font-medium">No updates yet</p>
          <p class="text-sm mt-1">Check back soon for release notes.</p>
        </div>

        <div v-else class="space-y-10">
          <NuxtLink
            v-if="entrySlug"
            :to="changelogPath"
            class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Icon name="lucide:arrow-left" class="w-4 h-4" />
            All updates
          </NuxtLink>

          <article
            v-for="entry in entries"
            :id="entry.slug"
            :key="entry.id"
            class="space-y-3"
            :data-testid="`public-changelog-entry-${entry.slug}`"
          >
            <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <time :datetime="entry.publishedAt">{{ formatDate(entry.publishedAt) }}</time>
              <span
                v-for="label in entry.labels"
                :key="label"
                class="px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                :style="labelStyle(label)"
              >
                {{ label }}
              </span>
            </div>
            <h2 class="text-2xl font-semibold">
              <NuxtLink v-if="!entrySlug" :to="entryPath(entry)" class="hover:underline">{{ entry.title }}</NuxtLink>
              <template v-else>{{ entry.title }}</template>
            </h2>
            <p v-if="entry.summary" class="text-muted-foreground">{{ entry.summary }}</p>
            <!-- Safe: html is produced and sanitised by the server (renderMarkdown allowlist) -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="entry.html" class="public-changelog-prose" v-html="entry.html" />
            <div v-if="entry.feedback.length > 0" class="pt-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Shipped from feedback
              </p>
              <ul class="text-sm space-y-0.5">
                <li v-for="item in entry.feedback" :key="item.id" class="flex items-center gap-1.5">
                  <Icon name="lucide:check" class="w-3.5 h-3.5 text-green-600 shrink-0" />
                  {{ item.title }}
                </li>
              </ul>
            </div>
          </article>

          <div v-if="nextCursor && !entrySlug" class="text-center">
            <button
              class="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
              :disabled="loadingMore"
              @click="loadMore"
            >
              {{ loadingMore ? 'Loading...' : 'Load more' }}
            </button>
            <p v-if="loadMoreError" class="text-sm text-destructive mt-2">{{ loadMoreError }}</p>
          </div>
        </div>
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
export default {
  name: 'PublicChangelog',
  props: {
    teamSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
    entrySlug: { type: String, default: null },
  },
  data() {
    return {
      projectData: null,
      entries: [],
      nextCursor: null,
      isLoading: true,
      entriesLoading: true,
      loadingMore: false,
      loadMoreError: null,
      error: null,
      entriesError: null,
      previousColorMode: null,
      activeTheme: 'system',
      logoError: false,
      bannerError: false,
    }
  },
  computed: {
    apiBase() {
      return `/api/public/t/${this.teamSlug}/${this.projectSlug}`
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
    feedbackBoardPath() {
      return this.onCustomDomain ? '/' : `/${this.projectSlug}`
    },
    roadmapPath() {
      return this.onCustomDomain ? '/roadmap' : `/${this.projectSlug}/roadmap`
    },
    changelogPath() {
      return this.onCustomDomain ? '/changelog' : `/${this.projectSlug}/changelog`
    },
    rssUrl() {
      return `${this.apiBase}/changelog.rss`
    },
    changelogEnabled() {
      return this.projectData?.project?.settings?.changelogEnabled === true
    },
    roadmapEnabled() {
      return this.projectData?.project?.settings?.roadmapEnabled === true
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
  watch: {
    async entrySlug() {
      if (this.projectData && this.changelogEnabled) await this.loadEntries()
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
    await this.load()
  },
  methods: {
    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(this.apiBase)
        const data = response?.data
        this.projectData = { project: data.project, team: data.team }
        this.applyTheme(data.project?.settings?.themeMode || 'system')
      } catch (err) {
        console.error('Error loading project:', err)
        this.error = 'This changelog could not be found.'
        this.isLoading = false
        return
      }
      this.isLoading = false
      if (this.changelogEnabled) await this.loadEntries()
    },
    async loadEntries() {
      this.entriesLoading = true
      this.entriesError = null
      this.nextCursor = null
      try {
        if (this.entrySlug) {
          const response = await $fetch(`${this.apiBase}/changelog/${encodeURIComponent(this.entrySlug)}`)
          this.entries = response?.data ? [response.data] : []
        } else {
          const response = await $fetch(`${this.apiBase}/changelog`)
          this.entries = response?.data?.entries || []
          this.nextCursor = response?.data?.nextCursor || null
        }
      } catch (err) {
        console.error('Error loading changelog:', err)
        this.entries = []
        this.entriesError = this.entrySlug ? 'This update could not be found.' : 'Failed to load the changelog.'
      } finally {
        this.entriesLoading = false
      }
    },
    async loadMore() {
      if (!this.nextCursor) return
      this.loadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch(`${this.apiBase}/changelog`, { query: { cursor: this.nextCursor } })
        this.entries = [...this.entries, ...(response?.data?.entries || [])]
        this.nextCursor = response?.data?.nextCursor || null
      } catch {
        this.loadMoreError = 'Failed to load more updates.'
      } finally {
        this.loadingMore = false
      }
    },
    entryPath(entry) {
      return `${this.changelogPath}/${entry.slug}`
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
    formatDate(date) {
      if (!date) return ''
      return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    },
    labelStyle(label) {
      const color = { new: '#10b981', improved: '#3b82f6', fixed: '#f59e0b' }[label] || '#6b7280'
      return { backgroundColor: color + '22', color }
    },
  },
}
</script>

<style scoped>
.public-changelog-prose :deep(h2),
.public-changelog-prose :deep(h3),
.public-changelog-prose :deep(h4) {
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.public-changelog-prose :deep(p) {
  margin: 0.5rem 0;
}
.public-changelog-prose :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
}
.public-changelog-prose :deep(ol) {
  list-style: decimal;
  padding-left: 1.5rem;
}
.public-changelog-prose :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.public-changelog-prose :deep(code) {
  background: var(--muted);
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
}
.public-changelog-prose :deep(pre) {
  background: var(--muted);
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
}
.public-changelog-prose :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 1rem;
  color: var(--muted-foreground);
}
.public-changelog-prose :deep(table) {
  border-collapse: collapse;
}
.public-changelog-prose :deep(th),
.public-changelog-prose :deep(td) {
  border: 1px solid var(--border);
  padding: 0.25rem 0.5rem;
}
.public-changelog-prose :deep(img) {
  max-width: 100%;
}
</style>
