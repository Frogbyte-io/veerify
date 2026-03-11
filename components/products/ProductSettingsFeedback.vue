<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:message-square" class="h-5 w-5" />
              Feedback
            </CardTitle>
            <CardDescription>Browse and manage all feedback submitted to this product.</CardDescription>
          </div>
          <div v-if="!isBusy && pagination.total > 0" class="text-sm text-muted-foreground">
            {{ pagination.total }} item{{ pagination.total !== 1 ? 's' : '' }}
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Filters -->
        <div class="flex flex-col sm:flex-row gap-2">
          <div class="relative flex-1">
            <Icon
              name="lucide:search"
              class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            />
            <Input
              v-model="searchQuery"
              placeholder="Search feedback..."
              class="pl-9"
              data-testid="product-feedback-search"
              @input="onSearchInput"
            />
          </div>
          <select
            v-model="statusFilter"
            data-testid="product-feedback-status-filter"
            class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @change="onFilterChange"
          >
            <option value="">All Statuses</option>
            <option v-for="status in availableStatuses" :key="status.value" :value="status.value">
              {{ status.name }}
            </option>
          </select>
          <select
            v-model="categoryFilter"
            data-testid="product-feedback-category-filter"
            class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @change="onFilterChange"
          >
            <option value="">All Categories</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.icon ? `${category.icon} ` : '' }}{{ category.name }}
            </option>
          </select>
          <select
            v-model="sortBy"
            data-testid="product-feedback-sort-filter"
            class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @change="onFilterChange"
          >
            <option value="voteCount">Most Voted</option>
            <option value="createdAt">Newest</option>
            <option value="updatedAt">Recently Updated</option>
            <option value="title">Alphabetical</option>
          </select>
        </div>

        <!-- Loading -->
        <div v-if="isBusy" class="space-y-3" data-testid="product-feedback-loading">
          <Skeleton v-for="n in 5" :key="n" class="h-14 w-full" />
        </div>

        <!-- Error -->
        <div v-else-if="displayError" class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-10 h-10 mx-auto text-destructive mb-3" />
          <p class="text-sm text-destructive mb-3">{{ displayError }}</p>
          <Button variant="outline" size="sm" @click="retryLoadFeedback">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- Empty -->
        <div v-else-if="feedbackItems.length === 0" class="text-center py-10">
          <Icon name="lucide:message-square" class="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p class="text-sm text-muted-foreground">
            {{
              searchQuery || statusFilter || categoryFilter
                ? 'No feedback matches your filters.'
                : 'No feedback submitted yet.'
            }}
          </p>
          <Button
            v-if="searchQuery || statusFilter || categoryFilter"
            variant="ghost"
            size="sm"
            class="mt-2"
            @click="clearFilters"
          >
            Clear filters
          </Button>
        </div>

        <!-- Feedback List -->
        <div v-else class="divide-y divide-border rounded-lg border" data-testid="product-feedback-list">
          <div
            v-for="item in feedbackItems"
            :key="item.id"
            class="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors"
          >
            <!-- Vote count -->
            <div class="flex flex-col items-center min-w-[40px] pt-0.5">
              <Icon name="lucide:triangle" class="w-3 h-3 text-muted-foreground" />
              <span class="text-sm font-semibold tabular-nums">{{ item.voteCount || 0 }}</span>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0 space-y-1">
              <div class="flex items-start gap-2 flex-wrap">
                <p class="font-medium text-sm leading-snug flex-1 min-w-0">{{ item.title }}</p>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    v-if="item.category"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    :style="{
                      backgroundColor: (item.category.color || '#6b7280') + '22',
                      color: item.category.color || '#6b7280',
                    }"
                  >
                    <span v-if="item.category.icon">{{ item.category.icon }}</span>
                    {{ item.category.name }}
                  </span>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :style="getStatusBadgeStyle(item.status)"
                    >{{ getStatusLabel(item.status) }}</span
                  >
                </div>
              </div>
              <p v-if="item.body" class="text-xs text-muted-foreground line-clamp-2">{{ item.body }}</p>
              <div class="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
                <span>{{ formatDate(item.createdAt) }}</span>
                <span v-if="item.githubIssue" class="flex items-center gap-1">
                  <Icon name="lucide:github" class="w-3 h-3" />
                  <a
                    :href="item.githubIssue.issueUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:text-foreground transition-colors"
                  >
                    #{{ item.githubIssue.issueNumber }}
                  </a>
                </span>
                <span v-if="item.isPinned" class="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Icon name="lucide:pin" class="w-3 h-3" />
                  Pinned
                </span>
              </div>
            </div>

            <!-- Status change dropdown -->
            <div class="flex-shrink-0">
              <select
                :value="item.status"
                class="flex h-7 rounded-md border border-input bg-transparent px-2 py-0 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                :disabled="updatingStatusId === item.id"
                @change="updateStatus(item, $event.target.value)"
              >
                <option v-for="status in availableStatuses" :key="status.value" :value="status.value">
                  {{ status.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="!isBusy && pagination.totalPages > 1" class="flex items-center justify-between pt-2">
          <p class="text-xs text-muted-foreground">Page {{ pagination.page }} of {{ pagination.totalPages }}</p>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="pagination.page <= 1" @click="goToPage(pagination.page - 1)">
              <Icon name="lucide:chevron-left" class="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="pagination.page >= pagination.totalPages"
              @click="goToPage(pagination.page + 1)"
            >
              <Icon name="lucide:chevron-right" class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

const FALLBACK_STATUSES = [
  { value: 'open', name: 'Open', color: '#3b82f6' },
  { value: 'planned', name: 'Planned', color: '#8b5cf6' },
  { value: 'in_progress', name: 'In Progress', color: '#f59e0b' },
  { value: 'completed', name: 'Completed', color: '#10b981' },
  { value: 'closed', name: 'Closed', color: '#6b7280' },
  { value: 'declined', name: 'Declined', color: '#ef4444' },
]

const DEFAULT_FEEDBACK_QUERY = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  search: '',
  status: '',
  categoryId: '',
}

function createPaginationState() {
  return {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  }
}

export default {
  name: 'ProductSettingsFeedback',

  props: {
    project: {
      type: Object,
      required: true,
    },
    resourceState: {
      type: Object,
      required: true,
    },
    categories: {
      type: Array,
      default: () => [],
    },
    statuses: {
      type: Array,
      default: () => [],
    },
    ensureLoaded: {
      type: Function,
      default: null,
    },
    refresh: {
      type: Function,
      default: null,
    },
  },

  emits: ['feedback-default-updated'],

  data() {
    return {
      feedbackItems: [],
      isLoading: false,
      error: null,
      searchQuery: '',
      statusFilter: '',
      categoryFilter: '',
      sortBy: DEFAULT_FEEDBACK_QUERY.sortBy,
      pagination: createPaginationState(),
      searchDebounceTimer: null,
      updatingStatusId: null,
      hasHydratedFromResource: false,
    }
  },
  computed: {
    availableStatuses() {
      return this.statuses.length > 0 ? this.statuses : FALLBACK_STATUSES
    },
    isInitialResourceLoading() {
      return ['idle', 'loading'].includes(this.resourceState?.status) && !this.hasHydratedFromResource
    },
    isBusy() {
      return this.isLoading || this.isInitialResourceLoading
    },
    displayError() {
      if (this.error) return this.error
      if (this.feedbackItems.length > 0) return null
      if (this.resourceState?.status !== 'error') return null
      return this.resourceState?.error || 'Failed to load feedback'
    },
  },

  watch: {
    'resourceState.data': {
      handler(payload) {
        if (!payload) return
        if (!this.hasHydratedFromResource || this.isDefaultQuery()) {
          this.applyFeedbackPayload(payload)
        }
      },
      immediate: true,
      deep: true,
    },
    'resourceState.status': {
      handler(status) {
        if (status === 'ready' && this.isDefaultQuery() && this.resourceState?.data) {
          this.applyFeedbackPayload(this.resourceState.data)
          return
        }

        if (status === 'error' && !this.hasHydratedFromResource) {
          this.error = this.resourceState?.error || 'Failed to load feedback'
        }
      },
      immediate: true,
    },
    'project.id': {
      handler() {
        clearTimeout(this.searchDebounceTimer)
        this.feedbackItems = []
        this.error = null
        this.searchQuery = ''
        this.statusFilter = ''
        this.categoryFilter = ''
        this.sortBy = DEFAULT_FEEDBACK_QUERY.sortBy
        this.pagination = createPaginationState()
        this.hasHydratedFromResource = false
      },
      immediate: false,
    },
  },
  beforeUnmount() {
    clearTimeout(this.searchDebounceTimer)
  },
  methods: {
    getCurrentQuery() {
      return {
        page: this.pagination.page,
        limit: this.pagination.limit,
        sortBy: this.sortBy,
        sortOrder: DEFAULT_FEEDBACK_QUERY.sortOrder,
        search: this.searchQuery.trim(),
        status: this.statusFilter,
        categoryId: this.categoryFilter,
      }
    },
    isDefaultQuery() {
      const query = this.getCurrentQuery()
      return (
        query.page === DEFAULT_FEEDBACK_QUERY.page &&
        query.limit === DEFAULT_FEEDBACK_QUERY.limit &&
        query.sortBy === DEFAULT_FEEDBACK_QUERY.sortBy &&
        query.sortOrder === DEFAULT_FEEDBACK_QUERY.sortOrder &&
        query.search === DEFAULT_FEEDBACK_QUERY.search &&
        query.status === DEFAULT_FEEDBACK_QUERY.status &&
        query.categoryId === DEFAULT_FEEDBACK_QUERY.categoryId
      )
    },
    buildQueryParams() {
      const query = this.getCurrentQuery()
      const params = new URLSearchParams({
        projectId: this.project.id,
        page: String(query.page),
        limit: String(query.limit),
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      })

      if (query.search) params.set('search', query.search)
      if (query.status) params.set('status', query.status)
      if (query.categoryId) params.set('categoryId', query.categoryId)

      return params
    },
    applyFeedbackPayload(payload) {
      this.feedbackItems = Array.isArray(payload?.items) ? payload.items : []
      this.pagination = payload?.pagination || createPaginationState()
      this.error = null
      this.hasHydratedFromResource = true
    },
    buildDefaultPayloadFromLocalState() {
      return {
        items: this.feedbackItems.map((item) => ({ ...item })),
        pagination: { ...this.pagination },
        query: { ...DEFAULT_FEEDBACK_QUERY },
      }
    },
    async retryLoadFeedback() {
      await this.loadFeedback({ force: true })
    },
    async loadFeedback(options = {}) {
      const isDefaultQuery = this.isDefaultQuery()

      if (isDefaultQuery && !options.force && this.resourceState?.status === 'ready' && this.resourceState?.data) {
        this.applyFeedbackPayload(this.resourceState.data)
        return
      }

      if (isDefaultQuery && options.force && this.refresh) {
        this.isLoading = true
        this.error = null
        try {
          const payload = await this.refresh()
          this.applyFeedbackPayload(payload)
          this.$emit('feedback-default-updated', payload)
        } catch (err) {
          console.error('Error loading feedback:', err)
          this.error = err?.data?.error?.message || 'Failed to load feedback'
        } finally {
          this.isLoading = false
        }
        return
      }

      if (isDefaultQuery && this.ensureLoaded && !this.resourceState?.data) {
        this.isLoading = true
        this.error = null
        try {
          const payload = await this.ensureLoaded()
          this.applyFeedbackPayload(payload)
        } catch (err) {
          console.error('Error loading feedback:', err)
          this.error = err?.data?.error?.message || 'Failed to load feedback'
        } finally {
          this.isLoading = false
        }
        return
      }

      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/feedback?${this.buildQueryParams().toString()}`)
        const payload = {
          items: response?.data?.items || [],
          pagination: response?.data?.pagination || createPaginationState(),
          query: this.getCurrentQuery(),
        }

        this.applyFeedbackPayload(payload)
        if (isDefaultQuery) {
          this.$emit('feedback-default-updated', this.buildDefaultPayloadFromLocalState())
        }
      } catch (err) {
        console.error('Error loading feedback:', err)
        this.error = err?.data?.error?.message || 'Failed to load feedback'
      } finally {
        this.isLoading = false
      }
    },

    onSearchInput() {
      clearTimeout(this.searchDebounceTimer)
      this.searchDebounceTimer = setTimeout(() => {
        this.pagination.page = 1
        this.loadFeedback()
      }, 350)
    },

    onFilterChange() {
      this.pagination.page = 1
      this.loadFeedback()
    },

    clearFilters() {
      this.searchQuery = ''
      this.statusFilter = ''
      this.categoryFilter = ''
      this.sortBy = DEFAULT_FEEDBACK_QUERY.sortBy
      this.pagination.page = DEFAULT_FEEDBACK_QUERY.page
      this.loadFeedback()
    },

    goToPage(page) {
      this.pagination.page = page
      this.loadFeedback()
    },

    async updateStatus(item, newStatus) {
      if (newStatus === item.status || this.updatingStatusId === item.id) return

      const previousStatus = item.status
      item.status = newStatus
      this.updatingStatusId = item.id

      try {
        await $fetch(`/api/feedback/${item.id}/status`, {
          method: 'PATCH',
          body: { status: newStatus },
        })
        if (this.isDefaultQuery()) {
          this.$emit('feedback-default-updated', this.buildDefaultPayloadFromLocalState())
        }
        toast.success('Status updated')
      } catch (err) {
        item.status = previousStatus
        toast.error(err?.data?.error?.message || 'Failed to update status')
      } finally {
        this.updatingStatusId = null
      }
    },

    getStatusLabel(value) {
      const status = this.availableStatuses.find((item) => item.value === value)
      return status ? status.name : value
    },

    getStatusBadgeStyle(value) {
      const status = this.availableStatuses.find((item) => item.value === value)
      const color = status?.color || '#6b7280'
      return { backgroundColor: color + '22', color }
    },

    formatDate(dateStr) {
      if (!dateStr) return ''
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    },
  },
}
</script>
