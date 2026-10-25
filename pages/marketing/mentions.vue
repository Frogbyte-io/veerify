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
        <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />
      </div>

      <!-- Waiting for the active project -->
      <div v-if="!pickerReady" class="space-y-3" data-testid="mentions-picking">
        <Skeleton class="h-9 w-80" />
        <Skeleton v-for="n in 4" :key="n" class="h-24 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        The project could not be loaded. Use Retry above to try again.
      </div>

      <!-- No project -->
      <Card v-else-if="!project">
        <CardContent class="py-10 text-center text-sm text-muted-foreground">
          Create a project, then switch Marketing on for it.
        </CardContent>
      </Card>

      <!-- Marketing off -->
      <MarketingDisabled v-else-if="forbidden" :project="project" :message="forbiddenMessage" />

      <!-- Initial loading -->
      <div v-else-if="isInitialLoading" class="space-y-3" data-testid="mentions-loading">
        <Skeleton class="h-9 w-80" />
        <Skeleton v-for="n in 4" :key="n" class="h-24 w-full" />
      </div>

      <!-- Initial error (no data to show yet) -->
      <Card v-else-if="error && !hasLoaded" data-testid="mentions-error">
        <CardContent class="py-10 text-center">
          <Icon name="lucide:circle-alert" class="mx-auto mb-3 h-8 w-8 text-destructive" />
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

      <template v-else-if="project">
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

        <!-- New mentions arrived (realtime) -->
        <div
          v-if="newArrivals > 0 && status === 'new'"
          class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm"
          role="status"
          data-testid="mentions-new-banner"
        >
          <span>{{ newArrivals }} new {{ newArrivals === 1 ? 'mention' : 'mentions' }}</span>
          <Button size="sm" variant="outline" data-testid="mentions-new-refresh" @click="refreshNew">
            <Icon name="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <!-- Bulk actions -->
        <div
          v-if="!isLoading && items.length > 0"
          class="flex flex-wrap items-center gap-2 text-sm"
          data-testid="mentions-bulk-bar"
        >
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
        <div v-if="isLoading" class="space-y-3" data-testid="mentions-list-loading">
          <Skeleton v-for="n in 4" :key="n" class="h-24 w-full" />
        </div>

        <Card v-else-if="error" data-testid="mentions-error">
          <CardContent class="py-10 text-center">
            <Icon name="lucide:circle-alert" class="mx-auto mb-3 h-8 w-8 text-destructive" />
            <p class="mb-3 text-sm text-muted-foreground">{{ error }}</p>
            <Button variant="outline" @click="reload">
              <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
              Try again
            </Button>
          </CardContent>
        </Card>

        <Card v-else-if="items.length === 0" data-testid="mentions-empty">
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
            :can-escalate="canEscalate"
            @toggle="toggleSelected"
            @status="updateOne"
            @escalate="escalateOne"
          />
        </ul>

        <div v-if="!isLoading && nextCursor" class="flex flex-col items-center gap-2">
          <p v-if="loadMoreError" class="text-sm text-destructive">{{ loadMoreError }}</p>
          <Button variant="outline" :disabled="isLoadingMore" data-testid="mentions-load-more" @click="loadMore">
            <Icon v-if="isLoadingMore" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
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
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
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

  created() {
    useHead({ title: 'Mentions · Marketing' })
  },

  data() {
    return {
      pickerReady: false,
      project: null,
      isLoading: false,
      hasLoaded: false,
      pickerError: false,
      forbiddenMessage: '',
      error: null,
      forbidden: false,
      site: null,
      canEscalate: false,
      newArrivals: 0,
      unsubscribeMentions: null,
      unregisterReconnectHook: null,
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
      sourcesToken: 0,
      statusOptions: [
        { value: 'new', label: 'New' },
        { value: 'seen', label: 'Seen' },
        { value: 'dismissed', label: 'Dismissed' },
        { value: 'escalated', label: 'Escalated' },
      ],
      kindOptions: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
      sourceOptions: Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
    }
  },

  computed: {
    basePath() {
      return `/api/marketing/projects/${this.project?.id}/mentions`
    },
    settingsLink() {
      return { path: '/marketing/settings' }
    },
    kindLabel() {
      return KIND_LABELS[this.kind]
    },
    sourceLabel() {
      return SOURCE_LABELS[this.source]
    },
    isInitialLoading() {
      return this.isLoading && !this.hasLoaded
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

  mounted() {
    if (import.meta.client && this.$realtime?.onReconnect) {
      this.unregisterReconnectHook = this.$realtime.onReconnect(this.handleRealtimeReconnect)
    }
  },

  beforeUnmount() {
    this.stopListening()
    if (this.unregisterReconnectHook) this.unregisterReconnectHook()
    this.unregisterReconnectHook = null
  },

  methods: {
    stopListening() {
      if (this.unsubscribeMentions) this.unsubscribeMentions()
      this.unsubscribeMentions = null
    },

    // Envelopes carry ids and a count only; the list is refetched through the authorized endpoint.
    startListening() {
      this.stopListening()
      if (!import.meta.client || !this.project?.id || !this.$realtime) return
      const projectId = this.project.id
      this.unsubscribeMentions = this.$realtime.subscribe(`project:${projectId}`, {
        onEvent: (envelope) => {
          if (envelope.type !== 'marketing.mentions.new' || envelope.projectId !== projectId) return
          if (this.project?.id !== projectId) return
          this.newArrivals += Number.isInteger(envelope.count) && envelope.count > 0 ? envelope.count : 1
        },
        onSubscribeError: (reason) => {
          console.warn(`Could not subscribe to mention updates: ${reason}`)
        },
      })
    },

    // Events published during a reconnect gap are lost, so prompt a refetch.
    handleRealtimeReconnect() {
      if (!this.project) return
      this.newArrivals = Math.max(this.newArrivals, 1)
    },

    async refreshNew() {
      this.newArrivals = 0
      await this.reload()
    },

    async escalateOne(id) {
      this.busyIds = [...this.busyIds, id]
      try {
        const response = await $fetch(`${this.basePath}/${id}/escalate`, { method: 'POST' })
        toast.success(response.data.alreadyEscalated ? 'Already escalated' : 'Escalated to support')
        await this.reload()
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Failed to escalate mention'))
      } finally {
        this.busyIds = this.busyIds.filter((x) => x !== id)
      }
    },

    onPickerError() {
      this.stopListening()
      this.newArrivals = 0
      this.requestToken++
      this.project = null
      this.pickerError = true
      this.pickerReady = true
      this.isLoading = false
    },

    async onProjectChange(project) {
      this.pickerReady = true
      this.pickerError = false
      this.project = project
      this.newArrivals = 0
      this.canEscalate = false
      this.stopListening()
      this.selected = []
      this.items = []
      this.nextCursor = null
      this.site = null
      this.hasLoaded = false
      this.forbidden = false
      this.error = null
      this.sources = []
      this.sourcesError = null
      this.sourcesLoading = false
      this.requestToken++
      if (!project) {
        this.isLoading = false
        return
      }
      this.startListening()
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
      if (!this.project) return
      const token = ++this.requestToken
      this.isLoading = true
      this.error = null
      this.forbidden = false
      this.loadMoreError = null
      if (this.status === 'new') this.newArrivals = 0
      try {
        const response = await $fetch(this.basePath, { query: this.listQuery() })
        if (token !== this.requestToken) return
        this.items = response.data.items
        this.counts = response.data.counts
        this.nextCursor = response.data.nextCursor
        this.site = response.data.site
        this.canEscalate = response.data.canEscalate === true
        this.selected = []
        this.hasLoaded = true
      } catch (err) {
        if (token !== this.requestToken) return
        if (apiErrorStatus(err) === 403) {
          this.forbidden = true
          this.forbiddenMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load mentions')
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
        if (token !== this.requestToken) return
        this.loadMoreError = apiErrorMessage(err, 'Failed to load more mentions')
      } finally {
        this.isLoadingMore = false
      }
    },

    async loadSources() {
      if (!this.project) return
      const projectId = this.project.id
      const token = ++this.sourcesToken
      this.sourcesLoading = true
      this.sourcesError = null
      try {
        const response = await $fetch(`${this.basePath}/sources`)
        if (this.project?.id !== projectId || token !== this.sourcesToken) return
        this.sources = response.data.sources
      } catch (err) {
        if (this.project?.id !== projectId || token !== this.sourcesToken) return
        // Marketing-off is already explained by the list state.
        if (apiErrorStatus(err) !== 403) {
          this.sourcesError = apiErrorMessage(err, 'Failed to load source status')
        }
      } finally {
        if (this.project?.id === projectId && token === this.sourcesToken) this.sourcesLoading = false
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
      // The visible page may now be empty while more rows exist on the server.
      if (this.items.length === 0 && this.nextCursor) this.reload()
    },

    async updateOne(id, status) {
      this.busyIds = [...this.busyIds, id]
      try {
        await $fetch(`${this.basePath}/${id}`, { method: 'PATCH', body: { status } })
        this.applyStatus([id], status)
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Failed to update mention'))
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
        toast.error(apiErrorMessage(err, 'Failed to update mentions'))
      } finally {
        this.bulkBusy = false
      }
    },
  },
}
</script>
