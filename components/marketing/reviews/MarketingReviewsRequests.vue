<template>
  <Card data-testid="reviews-requests">
    <CardHeader class="flex flex-row items-start justify-between gap-3 space-y-0">
      <div>
        <CardTitle>Requests</CardTitle>
        <CardDescription>Every request that was queued, newest first.</CardDescription>
      </div>
      <Button size="sm" variant="outline" data-testid="reviews-send-manually" @click="dialogOpen = true">
        <Icon name="lucide:send" class="mr-2 h-4 w-4" />
        Send manually
      </Button>
    </CardHeader>

    <CardContent>
      <div v-if="isLoading" class="space-y-2" data-testid="reviews-requests-loading">
        <Skeleton v-for="n in 4" :key="n" class="h-10 w-full" />
      </div>

      <div
        v-else-if="error"
        class="flex items-center gap-2 text-sm text-destructive"
        data-testid="reviews-requests-error"
      >
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <p v-else-if="items.length === 0" class="text-sm text-muted-foreground" data-testid="reviews-requests-empty">
        No requests yet. They appear here when a trigger fires or you send one manually.
      </p>

      <div v-else class="space-y-3">
        <ul class="divide-y rounded-md border">
          <li
            v-for="item in items"
            :key="item.id"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm"
            data-testid="reviews-request-row"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ item.email }}</span>
            <Badge variant="secondary">{{ triggerLabel(item.trigger) }}</Badge>
            <Badge :variant="statusVariant(item.status)">{{ statusLabel(item) }}</Badge>
            <Badge v-if="item.clickedAt" variant="default">Clicked</Badge>
            <span class="text-xs text-muted-foreground">{{ formatDate(item.sentAt || item.createdAt) }}</span>
            <p v-if="item.status === 'failed' && item.error" class="w-full text-xs text-destructive">
              {{ item.error }}
            </p>
          </li>
        </ul>

        <p v-if="moreError" class="text-sm text-destructive">{{ moreError }}</p>
        <Button v-if="nextCursor" variant="outline" size="sm" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? 'Loading...' : 'Load more' }}
        </Button>
      </div>
    </CardContent>

    <MarketingReviewsSendDialog
      v-model:open="dialogOpen"
      :project-id="projectId"
      @forbidden="(message) => $emit('forbidden', message)"
      @sent="load"
    />
  </Card>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const TRIGGER_LABELS = { csat: 'Support rating', shipped: 'Shipped', manual: 'Manual' }

export default {
  name: 'MarketingReviewsRequests',

  props: {
    projectId: { type: String, required: true },
  },

  emits: ['forbidden'],

  data() {
    return {
      isLoading: true,
      error: null,
      items: [],
      nextCursor: null,
      loadingMore: false,
      moreError: null,
      dialogOpen: false,
    }
  },

  async mounted() {
    await this.load()
  },

  methods: {
    triggerLabel(trigger) {
      return TRIGGER_LABELS[trigger] || trigger
    },

    statusLabel(item) {
      if (item.status === 'skipped')
        return item.skipReason ? `Skipped: ${item.skipReason.replace('_', ' ')}` : 'Skipped'
      return item.status.charAt(0).toUpperCase() + item.status.slice(1)
    },

    statusVariant(status) {
      if (status === 'failed') return 'destructive'
      if (status === 'sent') return 'default'
      return 'outline'
    },

    formatDate(value) {
      return value ? new Date(value).toLocaleString() : ''
    },

    async fetchPage(cursor) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      return $fetch(`/api/marketing/projects/${this.projectId}/reviews/requests${query}`)
    },

    async load() {
      const projectId = this.projectId
      this.isLoading = true
      this.error = null
      this.moreError = null
      try {
        const response = await this.fetchPage(null)
        if (projectId !== this.projectId) return
        this.items = response.data.items
        this.nextCursor = response.data.nextCursor
      } catch (err) {
        if (projectId !== this.projectId) return
        if (apiErrorStatus(err) === 403) this.$emit('forbidden', apiErrorMessage(err, ''))
        else this.error = apiErrorMessage(err, 'Failed to load requests')
      } finally {
        if (projectId === this.projectId) this.isLoading = false
      }
    },

    async loadMore() {
      const projectId = this.projectId
      this.loadingMore = true
      this.moreError = null
      try {
        const response = await this.fetchPage(this.nextCursor)
        if (projectId !== this.projectId) return
        this.items = [...this.items, ...response.data.items]
        this.nextCursor = response.data.nextCursor
      } catch (err) {
        if (projectId !== this.projectId) return
        this.moreError = apiErrorMessage(err, 'Failed to load more requests')
      } finally {
        if (projectId === this.projectId) this.loadingMore = false
      }
    },
  },
}
</script>
