<template>
  <div data-testid="public-changelog">
    <PublicProductFilter
      v-if="changelogEnabled && !entrySlug"
      :products="projectData.products"
      :selected="productFilter"
      :base-path="changelogPath"
      :accent-color="projectData.project.settings?.accentColor || '#6366f1'"
    />

    <!-- Changelog disabled -->
    <PublicStateMessage
      v-if="!changelogEnabled"
      icon="lucide:newspaper"
      title="Changelog not available"
      message="The changelog is not enabled for this project."
      data-testid="public-changelog-unavailable"
    >
      <NuxtLink
        :to="feedbackBoardPath"
        class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Icon name="lucide:message-square" class="w-4 h-4" />
        View Feedback Board
      </NuxtLink>
    </PublicStateMessage>

    <div v-else-if="entriesLoading" class="space-y-10">
      <div v-for="n in 3" :key="n" class="space-y-3">
        <Skeleton class="h-4 w-40" />
        <Skeleton class="h-7 w-2/3" />
        <Skeleton class="h-20 w-full" />
      </div>
    </div>

    <!-- 404: the entry (or the whole changelog) is not available; nothing to retry -->
    <PublicStateMessage
      v-else-if="entriesNotFound"
      icon="lucide:newspaper"
      :title="entrySlug ? 'This update is not available.' : 'The changelog is not available.'"
      data-testid="public-changelog-not-found"
    >
      <NuxtLink v-if="entrySlug" :to="changelogPath" class="text-sm text-primary hover:underline">
        Back to the changelog
      </NuxtLink>
    </PublicStateMessage>

    <PublicStateMessage
      v-else-if="entriesError"
      icon="lucide:alert-circle"
      kind="error"
      :title="entriesError"
      retryable
      @retry="loadEntries"
    />

    <PublicStateMessage
      v-else-if="entries.length === 0"
      icon="lucide:newspaper"
      title="No updates yet"
      message="Check back soon for release notes."
    />

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
            v-for="product in entryProducts(entry)"
            :key="product.id"
            class="px-2 py-0.5 rounded-full text-xs font-medium border"
            data-testid="public-changelog-product-badge"
          >
            {{ product.name }}
          </span>
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
  </div>
</template>

<script>
import { publicApiBase, publicCache, publicCacheKey, publicCacheScope, publicTabRequest } from '~/lib/public-cache'

/**
 * Changelog tab body (list and entry permalink). The shell (PublicProjectShell)
 * owns header, tabs, theme and the RSS link; the page title of an entry is
 * reported through the `title` event.
 */
export default {
  name: 'PublicChangelog',
  props: {
    orgSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
    entrySlug: { type: String, default: null },
    projectData: { type: Object, required: true },
    paths: { type: Object, required: true },
  },
  emits: ['title'],
  data() {
    return {
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
      return publicApiBase(this.orgSlug, this.projectSlug)
    },
    feedbackBoardPath() {
      return this.paths.feedback
    },
    changelogPath() {
      return this.paths.changelog
    },
    productFilter() {
      const value = this.$route.query.product
      return typeof value === 'string' ? value : ''
    },
    changelogEnabled() {
      return this.projectData.project?.settings?.changelogEnabled === true
    },
    // The entry's title on a permalink page, otherwise just the list title
    pageTitle() {
      return this.entrySlug && this.entries.length === 1 ? this.entries[0].title : ''
    },
  },
  watch: {
    async entrySlug() {
      if (this.changelogEnabled) await this.loadEntries()
    },
    async productFilter() {
      if (this.changelogEnabled && !this.entrySlug) await this.loadEntries()
    },
    pageTitle: {
      immediate: true,
      handler(title) {
        this.$emit('title', title)
      },
    },
  },
  async mounted() {
    if (this.changelogEnabled) await this.loadEntries()
  },
  beforeUnmount() {
    this.$emit('title', '')
  },
  methods: {
    // Cache key + fetcher of what is on screen: an entry permalink or the first page of the list
    entriesRequest() {
      const slug = this.entrySlug
      if (!slug) return publicTabRequest('changelog', this.orgSlug, this.projectSlug, { product: this.productFilter })
      return {
        key: publicCacheKey(publicCacheScope(this.orgSlug, this.projectSlug), 'changelog', 'entry:' + slug),
        fetcher: () => $fetch(this.apiBase + '/changelog/' + encodeURIComponent(slug)),
      }
    },
    applyEntries(response) {
      if (this.entrySlug) {
        this.entries = response?.data ? [response.data] : []
        this.nextCursor = null
      } else {
        this.entries = response?.data?.entries || []
        this.nextCursor = response?.data?.nextCursor || null
      }
    },
    async loadEntries() {
      const seq = ++this.entriesSeq
      const slug = this.entrySlug
      const request = this.entriesRequest()
      const hit = publicCache.peek(request.key)
      this.entriesError = null
      this.entriesNotFound = false
      this.loadMoreError = null
      if (hit) {
        this.applyEntries(hit.data)
        this.entriesLoading = false
        if (!hit.stale) return
      } else {
        this.entries = []
        this.nextCursor = null
        this.entriesLoading = true
      }
      try {
        const response = await publicCache.load(request.key, request.fetcher, { force: Boolean(hit) })
        if (seq !== this.entriesSeq) return
        this.applyEntries(response)
      } catch (err) {
        if (seq !== this.entriesSeq || hit) return
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
        const response = await $fetch(`${this.apiBase}/changelog`, {
          query: { cursor: this.nextCursor, ...(this.productFilter ? { product: this.productFilter } : {}) },
        })
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
    // Product tags are only meaningful when there is more than one product
    entryProducts(entry) {
      if (!(this.projectData?.products?.length > 1)) return []
      return Array.isArray(entry.products) ? entry.products : []
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
.public-changelog-prose {
  overflow-wrap: anywhere;
}
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
  max-width: 100%;
  overflow-wrap: normal;
}
.public-changelog-prose :deep(table) {
  display: block;
  max-width: 100%;
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
