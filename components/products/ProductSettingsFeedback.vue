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
          <div class="text-sm text-muted-foreground" v-if="!isLoading && pagination.total > 0">
            {{ pagination.total }} item{{ pagination.total !== 1 ? 's' : '' }}
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Filters -->
        <div class="flex flex-col sm:flex-row gap-2">
          <div class="relative flex-1">
            <Icon name="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              v-model="searchQuery"
              placeholder="Search feedback..."
              class="pl-9"
              @input="onSearchInput"
            />
          </div>
          <select
            v-model="statusFilter"
            class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @change="onFilterChange"
          >
            <option value="">All Statuses</option>
            <option v-for="s in statuses" :key="s.value" :value="s.value">{{ s.name }}</option>
          </select>
          <select
            v-model="categoryFilter"
            class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @change="onFilterChange"
          >
            <option value="">All Categories</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">
              {{ cat.icon ? `${cat.icon} ` : '' }}{{ cat.name }}
            </option>
          </select>
          <select
            v-model="sortBy"
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
        <div v-if="isLoading" class="space-y-3">
          <Skeleton v-for="n in 5" :key="n" class="h-14 w-full" />
        </div>

        <!-- Error -->
        <div v-else-if="error" class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-10 h-10 mx-auto text-destructive mb-3" />
          <p class="text-sm text-destructive mb-3">{{ error }}</p>
          <Button variant="outline" size="sm" @click="loadFeedback">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- Empty -->
        <div v-else-if="feedbackItems.length === 0" class="text-center py-10">
          <Icon name="lucide:message-square" class="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p class="text-sm text-muted-foreground">
            {{ searchQuery || statusFilter || categoryFilter ? 'No feedback matches your filters.' : 'No feedback submitted yet.' }}
          </p>
          <Button v-if="searchQuery || statusFilter || categoryFilter" variant="ghost" size="sm" class="mt-2" @click="clearFilters">
            Clear filters
          </Button>
        </div>

        <!-- Feedback List -->
        <div v-else class="divide-y divide-border rounded-lg border">
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
                    :style="{ backgroundColor: (item.category.color || '#6b7280') + '22', color: item.category.color || '#6b7280' }"
                  >
                    <span v-if="item.category.icon">{{ item.category.icon }}</span>
                    {{ item.category.name }}
                  </span>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :style="getStatusBadgeStyle(item.status)"
                  >{{ getStatusLabel(item.status) }}</span>
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
                <option v-for="s in statuses" :key="s.value" :value="s.value">{{ s.name }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div
          v-if="!isLoading && pagination.totalPages > 1"
          class="flex items-center justify-between pt-2"
        >
          <p class="text-xs text-muted-foreground">
            Page {{ pagination.page }} of {{ pagination.totalPages }}
          </p>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="pagination.page <= 1"
              @click="goToPage(pagination.page - 1)"
            >
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

export default {
  name: 'ProductSettingsFeedback',

  props: {
    project: {
      type: Object,
      required: true,
    },
  },

  data() {
    return {
      feedbackItems: [],
      categories: [],
      statuses: FALLBACK_STATUSES,
      isLoading: true,
      error: null,
      searchQuery: '',
      statusFilter: '',
      categoryFilter: '',
      sortBy: 'createdAt',
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      },
      searchDebounceTimer: null,
      updatingStatusId: null,
    }
  },

  watch: {
    'project.id': {
      handler() {
        this.resetAndLoad()
      },
      immediate: false,
    },
  },

  async mounted() {
    await Promise.all([this.loadCategories(), this.loadStatuses(), this.loadFeedback()])
  },

  methods: {
    async loadCategories() {
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/categories`)
        this.categories = response?.data || []
      } catch {
        // non-critical; swallow silently
      }
    },

    async loadStatuses() {
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/statuses`)
        const data = response?.data || []
        if (data.length > 0) this.statuses = data
      } catch {
        // non-critical; keep fallback statuses
      }
    },

    getStatusLabel(value) {
      const s = this.statuses.find((s) => s.value === value)
      return s ? s.name : value
    },

    getStatusBadgeStyle(value) {
      const s = this.statuses.find((s) => s.value === value)
      const color = s?.color || '#6b7280'
      return { backgroundColor: color + '22', color }
    },

    async loadFeedback() {
      this.isLoading = true
      this.error = null

      try {
        const params = new URLSearchParams({
          projectId: this.project.id,
          page: String(this.pagination.page),
          limit: String(this.pagination.limit),
          sortBy: this.sortBy,
          sortOrder: 'desc',
        })

        if (this.searchQuery.trim()) params.set('search', this.searchQuery.trim())
        if (this.statusFilter) params.set('status', this.statusFilter)
        if (this.categoryFilter) params.set('categoryId', this.categoryFilter)

        const response = await $fetch(`/api/feedback?${params}`)
        this.feedbackItems = response?.data?.items || []
        this.pagination = response?.data?.pagination || this.pagination
      } catch (err) {
        console.error('Error loading feedback:', err)
        this.error = 'Failed to load feedback'
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
      this.pagination.page = 1
      this.loadFeedback()
    },

    resetAndLoad() {
      this.pagination.page = 1
      this.feedbackItems = []
      this.loadFeedback()
      this.loadCategories()
      this.loadStatuses()
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
        toast.success('Status updated')
      } catch (err) {
        item.status = previousStatus
        toast.error(err?.data?.error?.message || 'Failed to update status')
      } finally {
        this.updatingStatusId = null
      }
    },

    formatDate(dateStr) {
      if (!dateStr) return ''
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    },
  },
}
</script>
