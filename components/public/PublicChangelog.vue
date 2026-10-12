<template>
  <PublicProjectShell
    :team-slug="teamSlug"
    :project-slug="projectSlug"
    active="changelog"
    :page-title="pageTitle"
    @loaded="onProjectLoaded"
  >
    <template #tabs-end>
      <a
        v-if="changelogEnabled"
        :href="rssUrl"
        class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        data-testid="changelog-rss-link"
      >
        <Icon name="lucide:rss" class="w-4 h-4" />
        RSS
      </a>
    </template>

    <!-- Changelog disabled -->
    <div v-if="!changelogEnabled" class="py-16 text-center" data-testid="public-changelog-unavailable">
      <Icon name="lucide:newspaper" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
      <h2 class="text-2xl font-bold mb-2">Changelog not available</h2>
      <p class="text-muted-foreground mb-6">The changelog is not enabled for this product.</p>
      <NuxtLink
        :to="feedbackBoardPath"
        class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Icon name="lucide:message-square" class="w-4 h-4" />
        View Feedback Board
      </NuxtLink>
    </div>

    <div v-else-if="entriesLoading" class="space-y-6">
      <Skeleton v-for="n in 3" :key="n" class="h-40 w-full" />
    </div>

    <!-- 404: the entry (or the whole changelog) is not available; nothing to retry -->
    <div v-else-if="entriesNotFound" class="text-center py-16" data-testid="public-changelog-not-found">
      <Icon name="lucide:newspaper" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
      <p class="font-medium mb-1">
        {{ entrySlug ? 'This update is not available.' : 'The changelog is not available.' }}
      </p>
      <NuxtLink v-if="entrySlug" :to="changelogPath" class="block text-sm text-primary hover:underline mt-2">
        Back to the changelog
      </NuxtLink>
    </div>

    <div v-else-if="entriesError" class="text-center py-16">
      <Icon name="lucide:alert-circle" class="w-10 h-10 mx-auto text-destructive mb-3" />
      <p class="font-medium mb-1">{{ entriesError }}</p>
      <button class="text-sm text-primary hover:underline mt-2" @click="loadEntries">Try again</button>
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
          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Shipped from feedback</p>
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
  </PublicProjectShell>
</template>

<script>
import { projectPaths } from '~/lib/public-shell'

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
      entriesLoading: true,
      loadingMore: false,
      loadMoreError: null,
      entriesError: null,
      entriesNotFound: false,
      // Bumped per request; a response only applies if it is still the latest
      entriesSeq: 0,
    }
  },
  computed: {
    apiBase() {
      return `/api/public/t/${encodeURIComponent(this.teamSlug)}/${encodeURIComponent(this.projectSlug)}`
    },
    onCustomDomain() {
      return import.meta.client && this.projectData?.project?.customDomain === window.location.hostname
    },
    paths() {
      return projectPaths(this.projectSlug, this.onCustomDomain)
    },
    feedbackBoardPath() {
      return this.paths.feedback
    },
    changelogPath() {
      return this.paths.changelog
    },
    rssUrl() {
      return `${this.apiBase}/changelog.rss`
    },
    changelogEnabled() {
      // Until the project has loaded the slot is not rendered at all
      return this.projectData?.project?.settings?.changelogEnabled === true
    },
    // The entry's title on a permalink page, otherwise just the list title
    pageTitle() {
      return this.entrySlug && this.entries.length === 1 ? this.entries[0].title : ''
    },
  },
  watch: {
    async entrySlug() {
      if (this.projectData && this.changelogEnabled) await this.loadEntries()
    },
  },
  methods: {
    async onProjectLoaded(projectData) {
      this.projectData = projectData
      if (this.changelogEnabled) await this.loadEntries()
    },
    async loadEntries() {
      const seq = ++this.entriesSeq
      const slug = this.entrySlug
      this.entriesLoading = true
      this.entriesError = null
      this.entriesNotFound = false
      this.nextCursor = null
      this.loadMoreError = null
      try {
        if (slug) {
          const response = await $fetch(`${this.apiBase}/changelog/${encodeURIComponent(slug)}`)
          if (seq !== this.entriesSeq) return
          this.entries = response?.data ? [response.data] : []
        } else {
          const response = await $fetch(`${this.apiBase}/changelog`)
          if (seq !== this.entriesSeq) return
          this.entries = response?.data?.entries || []
          this.nextCursor = response?.data?.nextCursor || null
        }
      } catch (err) {
        if (seq !== this.entriesSeq) return
        this.entries = []
        const status = err?.statusCode || err?.status || err?.response?.status
        if (status === 404) {
          this.entriesNotFound = true
        } else {
          console.error('Error loading changelog:', err)
          this.entriesError = slug ? 'Failed to load this update.' : 'Failed to load the changelog.'
        }
      } finally {
        if (seq === this.entriesSeq) this.entriesLoading = false
      }
    },
    async loadMore() {
      if (!this.nextCursor) return
      const seq = this.entriesSeq
      this.loadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch(`${this.apiBase}/changelog`, { query: { cursor: this.nextCursor } })
        // The list was reloaded (or the page changed) meanwhile: drop this page
        if (seq !== this.entriesSeq) return
        this.entries = [...this.entries, ...(response?.data?.entries || [])]
        this.nextCursor = response?.data?.nextCursor || null
      } catch {
        if (seq === this.entriesSeq) this.loadMoreError = 'Failed to load more updates.'
      } finally {
        this.loadingMore = false
      }
    },
    entryPath(entry) {
      return `${this.changelogPath}/${entry.slug}`
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
