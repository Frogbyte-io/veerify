<template>
  <NuxtLayout name="dashboard">
    <div class="mx-auto max-w-5xl space-y-6 p-6" data-testid="marketing-mentions-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Mentions</h1>
          <p class="text-sm text-muted-foreground">
            Posts on Hacker News, Reddit and Bluesky that name your brand, your competitors or the problem you solve.
          </p>
        </div>
        <MarketingProductPicker @change="onProductChange" />
      </div>

      <!-- No product -->
      <Card v-if="pickerReady && !product">
        <CardContent class="py-10 text-center text-sm text-muted-foreground">
          Create a product first, then switch Marketing on for it.
        </CardContent>
      </Card>

      <!-- Loading -->
      <div v-else-if="isLoading" class="space-y-3" data-testid="mentions-loading">
        <Skeleton class="h-9 w-80" />
        <Skeleton v-for="n in 4" :key="n" class="h-24 w-full" />
      </div>

      <!-- Marketing off -->
      <Card v-else-if="forbidden" data-testid="mentions-marketing-off">
        <CardContent class="py-10 text-center">
          <Icon name="lucide:megaphone" class="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p class="mb-1 font-medium">Marketing is not enabled for this product</p>
          <p class="mx-auto max-w-md text-sm text-muted-foreground">
            A team admin can switch Marketing on under Settings, Tools, and then for this product under its Features
            tab. Both switches must be on.
          </p>
        </CardContent>
      </Card>

      <!-- Error -->
      <Card v-else-if="error" data-testid="mentions-error">
        <CardContent class="py-10 text-center">
          <Icon name="lucide:alert-circle" class="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p class="mb-3 text-sm text-muted-foreground">{{ error }}</p>
          <Button variant="outline" @click="reload">
            <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <!-- Not verified -->
      <Card v-else-if="site && !site.verified" data-testid="mentions-not-verified">
        <CardContent class="py-10 text-center">
          <Icon name="lucide:shield-check" class="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p class="mb-1 font-medium">Verify your site to start monitoring</p>
          <p class="mb-4 text-sm text-muted-foreground">
            Mentions are only collected for sites you have proven you own.
          </p>
          <Button as-child variant="outline">
            <NuxtLink :to="settingsLink">Open Marketing settings</NuxtLink>
          </Button>
        </CardContent>
      </Card>

      <!-- No terms -->
      <Card v-else-if="site && site.termCount === 0" data-testid="mentions-no-terms">
        <CardContent class="py-10 text-center">
          <Icon name="lucide:tags" class="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p class="mb-1 font-medium">Add brand names, competitors or keywords</p>
          <p class="mb-4 text-sm text-muted-foreground">
            Mentions are matched against the terms you configure. None are set up yet.
          </p>
          <Button as-child variant="outline">
            <NuxtLink :to="settingsLink">Open Marketing settings</NuxtLink>
          </Button>
        </CardContent>
      </Card>

      <template v-else-if="product">
        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-2" data-testid="mentions-filters">
          <Button
            v-for="option in statusOptions"
            :key="option.value"
            size="sm"
            :variant="status === option.value ? 'default' : 'outline'"
            :data-testid="`mentions-status-${option.value}`"
            @click="setStatus(option.value)"
          >
            {{ option.label }}
            <span class="ml-1.5 text-xs opacity-80">{{ counts[option.value] }}</span>
          </Button>

          <div class="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" data-testid="mentions-kind-filter">
                  <Icon name="lucide:filter" class="mr-1.5 h-4 w-4" />
                  {{ kindLabel }}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup :model-value="kind" @update:model-value="setKind">
                  <DropdownMenuRadioItem v-for="option in kindOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" data-testid="mentions-source-filter">
                  <Icon name="lucide:globe" class="mr-1.5 h-4 w-4" />
                  {{ sourceLabel }}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup :model-value="source" @update:model-value="setSource">
                  <DropdownMenuRadioItem v-for="option in sourceOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <!-- Bulk actions -->
        <div v-if="items.length > 0" class="flex flex-wrap items-center gap-2 text-sm" data-testid="mentions-bulk-bar">
          <label class="inline-flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-input accent-primary"
              :checked="allSelected"
              aria-label="Select all mentions on this page"
              @change="toggleAll"
            />
            {{ selected.length > 0 ? `${selected.length} selected` : 'Select all' }}
          </label>
          <template v-if="selected.length > 0">
            <Button variant="outline" size="sm" :disabled="bulkBusy" @click="bulkUpdate('seen')">
              <Icon name="lucide:check" class="mr-1.5 h-4 w-4" />
              Mark seen
            </Button>
            <Button variant="outline" size="sm" :disabled="bulkBusy" @click="bulkUpdate('dismissed')">
              <Icon name="lucide:x" class="mr-1.5 h-4 w-4" />
              Dismiss
            </Button>
          </template>
        </div>

        <!-- List -->
        <Card v-if="items.length === 0" data-testid="mentions-empty">
          <CardContent class="py-10 text-center text-sm text-muted-foreground">
            {{ emptyMessage }}
          </CardContent>
        </Card>

        <ul v-else class="overflow-hidden rounded-lg border border-border" data-testid="mentions-list">
          <MentionItem
            v-for="item in items"
            :key="item.id"
            :mention="item"
            :selected="selected.includes(item.id)"
            :busy="busyIds.includes(item.id)"
            @toggle="toggleSelected"
            @status="updateOne"
          />
        </ul>

        <div v-if="nextCursor" class="flex flex-col items-center gap-2">
          <p v-if="loadMoreError" class="text-sm text-destructive">{{ loadMoreError }}</p>
          <Button variant="outline" :disabled="isLoadingMore" data-testid="mentions-load-more" @click="loadMore">
            <Icon v-if="isLoadingMore" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            {{ loadMoreError ? 'Retry' : 'Load more' }}
          </Button>
        </div>

        <MentionSourceStatus
          :sources="sources"
          :is-loading="sourcesLoading"
          :error="sourcesError"
          @retry="loadSources"
        />
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'

const KIND_LABELS = {
  all: 'All kinds',
  mention: 'Brand mentions',
  competitor: 'Competitors',
  opportunity: 'Opportunities',
}
const SOURCE_LABELS = { all: 'All sources', hackernews: 'Hacker News', reddit: 'Reddit', bluesky: 'Bluesky' }

export default {
  name: 'MarketingMentionsPage',

  data() {
    return {
      pickerReady: false,
      product: null,
      isLoading: true,
      error: null,
      forbidden: false,
      site: null,
      items: [],
      counts: { new: 0, seen: 0, dismissed: 0, escalated: 0 },
      nextCursor: null,
      status: 'new',
      kind: 'all',
      source: 'all',
      selected: [],
      busyIds: [],
      bulkBusy: false,
      isLoadingMore: false,
      loadMoreError: null,
      sources: [],
      sourcesLoading: false,
      sourcesError: null,
      requestToken: 0,
      statusOptions: [
        { value: 'new', label: 'New' },
        { value: 'seen', label: 'Seen' },
        { value: 'dismissed', label: 'Dismissed' },
      ],
      kindOptions: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
      sourceOptions: Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
    }
  },

  computed: {
    basePath() {
      return `/api/marketing/projects/${this.product?.id}/mentions`
    },
    settingsLink() {
      return { path: '/marketing/settings', query: { product: this.product?.slug } }
    },
    kindLabel() {
      return KIND_LABELS[this.kind]
    },
    sourceLabel() {
      return SOURCE_LABELS[this.source]
    },
    allSelected() {
      return this.items.length > 0 && this.items.every((item) => this.selected.includes(item.id))
    },
    emptyMessage() {
      const filtered = this.kind !== 'all' || this.source !== 'all'
      if (this.status === 'new' && !filtered) return 'No new mentions. New posts are checked about every 15 minutes.'
      return 'No mentions match these filters.'
    },
  },

  methods: {
    async onProductChange(product) {
      this.pickerReady = true
      this.product = product
      this.selected = []
      if (!product) {
        this.isLoading = false
        return
      }
      await Promise.all([this.reload(), this.loadSources()])
    },

    listQuery(cursor) {
      const query = { status: this.status, limit: 25 }
      if (this.kind !== 'all') query.kind = this.kind
      if (this.source !== 'all') query.source = this.source
      if (cursor) query.cursor = cursor
      return query
    },

    async reload() {
      if (!this.product) return
      const token = ++this.requestToken
      this.isLoading = true
      this.error = null
      this.forbidden = false
      this.loadMoreError = null
      try {
        const response = await $fetch(this.basePath, { query: this.listQuery() })
        if (token !== this.requestToken) return
        this.items = response.data.items
        this.counts = response.data.counts
        this.nextCursor = response.data.nextCursor
        this.site = response.data.site
        this.selected = []
      } catch (err) {
        if (token !== this.requestToken) return
        if (err?.statusCode === 403 || err?.status === 403) {
          this.forbidden = true
        } else {
          this.error = err?.data?.error?.message || 'Failed to load mentions'
        }
      } finally {
        if (token === this.requestToken) this.isLoading = false
      }
    },

    async loadMore() {
      if (!this.nextCursor || this.isLoadingMore) return
      const token = this.requestToken
      this.isLoadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch(this.basePath, { query: this.listQuery(this.nextCursor) })
        if (token !== this.requestToken) return
        const known = new Set(this.items.map((item) => item.id))
        this.items = [...this.items, ...response.data.items.filter((item) => !known.has(item.id))]
        this.nextCursor = response.data.nextCursor
        this.counts = response.data.counts
      } catch (err) {
        this.loadMoreError = err?.data?.error?.message || 'Failed to load more mentions'
      } finally {
        this.isLoadingMore = false
      }
    },

    async loadSources() {
      if (!this.product) return
      this.sourcesLoading = true
      this.sourcesError = null
      try {
        const response = await $fetch(`${this.basePath}/sources`)
        this.sources = response.data.sources
      } catch (err) {
        // Marketing-off is already explained by the list state.
        if (err?.statusCode !== 403 && err?.status !== 403) {
          this.sourcesError = err?.data?.error?.message || 'Failed to load source status'
        }
      } finally {
        this.sourcesLoading = false
      }
    },

    setStatus(value) {
      if (this.status === value) return
      this.status = value
      this.reload()
    },

    setKind(value) {
      this.kind = value || 'all'
      this.reload()
    },

    setSource(value) {
      this.source = value || 'all'
      this.reload()
    },

    toggleSelected(id) {
      this.selected = this.selected.includes(id) ? this.selected.filter((x) => x !== id) : [...this.selected, id]
    },

    toggleAll() {
      this.selected = this.allSelected ? [] : this.items.map((item) => item.id)
    },

    // Keeps the list and counts consistent after a status change without a refetch.
    applyStatus(ids, status) {
      const idSet = new Set(ids)
      const counts = { ...this.counts }
      for (const item of this.items) {
        if (idSet.has(item.id) && item.status !== status) {
          counts[item.status] = Math.max(0, counts[item.status] - 1)
          counts[status] += 1
        }
      }
      this.counts = counts
      this.items = this.items.filter((item) => !idSet.has(item.id) || status === this.status)
      this.items.forEach((item) => {
        if (idSet.has(item.id)) item.status = status
      })
      this.selected = this.selected.filter((id) => !idSet.has(id))
    },

    async updateOne(id, status) {
      this.busyIds = [...this.busyIds, id]
      try {
        await $fetch(`${this.basePath}/${id}`, { method: 'PATCH', body: { status } })
        this.applyStatus([id], status)
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to update mention')
      } finally {
        this.busyIds = this.busyIds.filter((x) => x !== id)
      }
    },

    async bulkUpdate(status) {
      const ids = [...this.selected]
      if (ids.length === 0) return
      this.bulkBusy = true
      try {
        await $fetch(`${this.basePath}/bulk`, { method: 'POST', body: { ids, status } })
        this.applyStatus(ids, status)
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to update mentions')
      } finally {
        this.bulkBusy = false
      }
    },
  },
}
</script>
