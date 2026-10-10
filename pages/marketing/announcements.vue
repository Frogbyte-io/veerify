<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="marketing-announcements-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Announcements</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Draft posts for X, LinkedIn, Bluesky and your newsletter from each published changelog entry. Titles of
            feedback linked to an entry are included only with your team's data consent for feedback text, and never for
            hidden or support-derived items.
          </p>
        </div>
        <MarketingProductPicker @change="onProductChange" @error="onPickerError" />
      </div>

      <p
        v-if="targetMissing"
        class="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
        role="status"
        data-testid="announcements-entry-not-found"
      >
        <Icon name="lucide:info" class="h-4 w-4 shrink-0" />
        Entry not found or not published yet
      </p>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        Products could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!product" class="text-sm text-muted-foreground">
        Create a product first to draft announcements.
      </div>

      <MarketingDisabled v-else-if="marketingOff" :product="product" :message="disabledMessage" />

      <div v-else-if="isLoading" class="space-y-4">
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div
        v-else-if="!changelogEnabled"
        class="rounded-lg border border-border bg-card p-6"
        data-testid="announcements-changelog-off"
      >
        <h2 class="text-lg font-semibold">The changelog is off for this product</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Announcement drafts come from published changelog entries. Turn the changelog on for your team and for this
          product, then publish an entry.
        </p>
        <Button as-child variant="outline" class="mt-4">
          <NuxtLink to="/dashboard/changelog">
            <Icon name="lucide:newspaper" class="mr-2 h-4 w-4" />
            Go to the changelog
          </NuxtLink>
        </Button>
      </div>

      <div
        v-else-if="!entries.length"
        class="rounded-lg border border-border bg-card p-6"
        data-testid="announcements-empty"
      >
        <h2 class="text-lg font-semibold">No published entries yet</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Publish a changelog entry and it shows up here, ready for announcement drafts.
        </p>
        <Button as-child variant="outline" class="mt-4">
          <NuxtLink to="/dashboard/changelog">
            <Icon name="lucide:newspaper" class="mr-2 h-4 w-4" />
            Go to the changelog
          </NuxtLink>
        </Button>
      </div>

      <template v-else>
        <div
          v-if="!hasUsableKey"
          class="rounded-lg border border-border bg-card p-4 text-sm"
          data-testid="announcements-no-key"
        >
          <p class="font-medium">Add an AI key to generate drafts</p>
          <p class="mt-1 text-muted-foreground">
            Drafts are written with your own Anthropic, OpenAI, Gemini or Perplexity key, so the cost stays on your
            account. Add one in
            <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
            . You can still write and save drafts by hand.
          </p>
        </div>

        <MarketingAnnouncementCard
          v-for="entry in entries"
          :key="`${product.id}:${entry.id}`"
          :project-id="product.id"
          :entry="entry"
          :limits="limits"
          :has-usable-key="hasUsableKey"
          :highlighted="entry.id === highlightId"
        />

        <div v-if="loadMoreError" class="flex items-center gap-2 text-sm text-destructive">
          <span>{{ loadMoreError }}</span>
          <Button variant="outline" size="sm" @click="loadMore">Retry</Button>
        </div>
        <Button v-else-if="nextCursor" variant="outline" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? 'Loading...' : 'Load more' }}
        </Button>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

// Pages fetched at most while looking for the ?entry= target
const MAX_TARGET_PAGES = 10

export default {
  name: 'MarketingAnnouncementsPage',

  data() {
    return {
      product: null,
      pickerSettled: false,
      pickerError: false,
      isLoading: false,
      error: null,
      marketingOff: false,
      disabledMessage: '',
      changelogEnabled: true,
      hasUsableKey: false,
      limits: { x: 280, bluesky: 300, linkedin: 1300, newsletter: 2000 },
      entries: [],
      nextCursor: null,
      loadingMore: false,
      loadMoreError: null,
      highlightId: null,
      targetMissing: false,
    }
  },

  methods: {
    base(productId = this.product.id) {
      return `/api/marketing/projects/${productId}/announcements`
    },

    onPickerError() {
      this.product = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProductChange(product) {
      this.product = product
      this.pickerSettled = true
      this.pickerError = false
      this.isLoading = false
      this.error = null
      this.marketingOff = false
      this.entries = []
      this.nextCursor = null
      this.loadMoreError = null
      this.highlightId = null
      this.targetMissing = false
      if (product) await this.load()
    },

    async fetchPage(productId, cursor) {
      const response = await $fetch(this.base(productId), { query: cursor ? { cursor } : {} })
      return response.data
    },

    async load() {
      if (!this.product) return
      const productId = this.product.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      this.targetMissing = false
      try {
        const data = await this.fetchPage(productId)
        if (this.product?.id !== productId) return
        this.changelogEnabled = data.changelogEnabled
        this.hasUsableKey = data.hasUsableKey
        this.limits = data.limits
        this.entries = data.entries
        this.nextCursor = data.nextCursor
      } catch (err) {
        if (this.product?.id !== productId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load announcements')
        }
      } finally {
        if (this.product?.id === productId) this.isLoading = false
      }
      if (this.product?.id === productId && !this.error && !this.marketingOff) await this.focusTarget(productId)
    },

    async loadMore() {
      if (!this.product || !this.nextCursor || this.loadingMore) return
      const productId = this.product.id
      this.loadingMore = true
      this.loadMoreError = null
      try {
        const data = await this.fetchPage(productId, this.nextCursor)
        if (this.product?.id !== productId) return
        this.entries = [...this.entries, ...data.entries]
        this.nextCursor = data.nextCursor
      } catch (err) {
        if (this.product?.id !== productId) return
        this.loadMoreError = apiErrorMessage(err, 'Failed to load more entries')
      } finally {
        if (this.product?.id === productId) this.loadingMore = false
      }
    },

    /** Scroll to and highlight the entry named by ?entry=, paging forward to find it. */
    async focusTarget(productId) {
      const target = this.$route.query.entry
      if (typeof target !== 'string' || !target) return
      for (let page = 0; page < MAX_TARGET_PAGES; page++) {
        if (this.product?.id !== productId) return
        if (this.entries.some((e) => e.id === target)) {
          this.highlightId = target
          await this.$nextTick()
          if (import.meta.client) {
            document.getElementById(`announcement-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
          return
        }
        if (!this.nextCursor) break
        await this.loadMore()
        // A failed page shows its own retry; the entry may still be further down
        if (this.loadMoreError) return
      }
      if (this.product?.id === productId) this.targetMissing = true
    },
  },
}
</script>
