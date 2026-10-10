<template>
  <Card data-testid="audit-pages">
    <CardHeader>
      <CardTitle class="text-base">Pages</CardTitle>
    </CardHeader>
    <CardContent>
      <div v-if="isLoading" class="space-y-2">
        <Skeleton v-for="n in 4" :key="n" class="h-8 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load(true)">Retry</Button>
      </div>

      <p v-else-if="!pages.length" class="text-sm text-muted-foreground">No pages were stored for this audit.</p>

      <div v-else>
        <ul class="divide-y divide-border">
          <li v-for="page in pages" :key="page.id" class="flex items-center gap-3 py-2 text-sm">
            <Badge :variant="page.statusCode >= 400 ? 'destructive' : 'secondary'">{{ page.statusCode }}</Badge>
            <div class="min-w-0 flex-1">
              <p class="truncate font-mono text-xs" :title="page.url">{{ page.url }}</p>
              <p class="truncate text-muted-foreground">{{ page.title || page.error || 'No title' }}</p>
            </div>
            <span class="text-xs text-muted-foreground">
              {{ page.issueCount }} issue{{ page.issueCount === 1 ? '' : 's' }}
            </span>
          </li>
        </ul>
        <div v-if="nextCursor" class="mt-3">
          <Button
            variant="outline"
            size="sm"
            :disabled="isLoadingMore"
            data-testid="audit-pages-more"
            @click="loadMore"
          >
            {{ isLoadingMore ? 'Loading...' : 'Load more' }}
          </Button>
        </div>
        <p v-if="moreError" class="mt-2 text-sm text-destructive">{{ moreError }}</p>
      </div>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingAuditPages',

  props: {
    projectId: { type: String, required: true },
    auditId: { type: String, required: true },
  },

  data() {
    return {
      pages: [],
      nextCursor: null,
      isLoading: true,
      isLoadingMore: false,
      error: null,
      moreError: null,
    }
  },

  watch: {
    auditId() {
      this.load(true)
    },
  },

  async mounted() {
    await this.load(true)
  },

  methods: {
    url(cursor) {
      const base = `/api/marketing/projects/${this.projectId}/audits/${this.auditId}/pages`
      return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base
    },

    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(this.url(null))
        this.pages = response.data.pages
        this.nextCursor = response.data.nextCursor
      } catch (err) {
        this.error = err?.data?.error?.message || 'Failed to load pages'
      } finally {
        this.isLoading = false
      }
    },

    async loadMore() {
      this.isLoadingMore = true
      this.moreError = null
      try {
        const response = await $fetch(this.url(this.nextCursor))
        this.pages = [...this.pages, ...response.data.pages]
        this.nextCursor = response.data.nextCursor
      } catch (err) {
        this.moreError = err?.data?.error?.message || 'Failed to load more pages'
      } finally {
        this.isLoadingMore = false
      }
    },
  },
}
</script>
