<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-foreground">My Submissions</h1>
        <p class="text-muted-foreground">All feedback you've submitted across projects</p>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="space-y-3">
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <!-- Error -->
      <Card v-else-if="error">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">Failed to load submissions</p>
          <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
          <Button variant="outline" @click="loadSubmissions">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <!-- Empty state -->
      <Card v-else-if="submissions.length === 0">
        <CardContent class="text-center py-12">
          <div class="flex justify-center mb-4">
            <div class="flex items-center justify-center w-14 h-14 rounded-full bg-muted">
              <Icon name="lucide:message-square" class="w-7 h-7 text-muted-foreground" />
            </div>
          </div>
          <p class="font-medium text-lg mb-1">No submissions yet</p>
          <p class="text-sm text-muted-foreground max-w-sm mx-auto">
            When you submit feedback on public boards, your submissions will appear here so you can track their
            progress.
          </p>
        </CardContent>
      </Card>

      <!-- Submissions list -->
      <template v-else>
        <!-- Status filter -->
        <div class="flex items-center gap-2 mb-4 flex-wrap">
          <Button
            v-for="filter in statusFilters"
            :key="filter.value"
            :variant="activeFilter === filter.value ? 'default' : 'outline'"
            size="sm"
            @click="activeFilter = filter.value"
          >
            {{ filter.label }}
            <Badge v-if="filter.count > 0" variant="secondary" class="ml-1.5 text-xs">
              {{ filter.count }}
            </Badge>
          </Button>
        </div>

        <!-- List -->
        <div class="space-y-3">
          <NuxtLink
            v-for="item in filteredSubmissions"
            :key="item.id"
            :to="`/feedback/${item.id}`"
            prefetch-on="interaction"
            class="flex items-center justify-between rounded-lg border bg-card p-4 cursor-pointer hover:bg-accent/50 transition-colors"
          >
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ item.title }}</p>
              <p v-if="item.body" class="text-sm text-muted-foreground truncate mt-0.5">
                {{ item.body }}
              </p>
              <div class="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span class="flex items-center gap-1">
                  <Icon name="lucide:package" class="w-3 h-3" />
                  {{ item.projectName || 'Unknown project' }}
                </span>
                <span>{{ formatDate(item.createdAt) }}</span>
                <span v-if="item.commentCount > 0" class="flex items-center gap-1">
                  <Icon name="lucide:message-circle" class="w-3 h-3" />
                  {{ item.commentCount }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0 ml-4">
              <Badge :variant="getStatusVariant(item.status)" class="text-xs">
                {{ formatStatus(item.status) }}
              </Badge>
              <div class="flex items-center gap-1 text-sm text-muted-foreground">
                <Icon name="lucide:arrow-up" class="w-4 h-4" />
                <span class="font-medium">{{ item.voteCount }}</span>
              </div>
            </div>
          </NuxtLink>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-between mt-6">
          <p class="text-sm text-muted-foreground">
            Page {{ page }} of {{ totalPages }} ({{ totalCount }} submissions)
          </p>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" :disabled="page <= 1" @click="goToPage(page - 1)"> Previous </Button>
            <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="goToPage(page + 1)">
              Next
            </Button>
          </div>
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
export default {
  name: 'SubmissionsPage',

  data() {
    return {
      submissions: [],
      isLoading: true,
      error: null,
      page: 1,
      totalCount: 0,
      totalPages: 1,
      activeFilter: 'all',
    }
  },

  computed: {
    filteredSubmissions() {
      if (this.activeFilter === 'all') return this.submissions
      return this.submissions.filter((s) => s.status === this.activeFilter)
    },

    statusFilters() {
      const counts = {}
      for (const s of this.submissions) {
        counts[s.status] = (counts[s.status] || 0) + 1
      }
      return [
        { value: 'all', label: 'All', count: this.submissions.length },
        { value: 'open', label: 'Open', count: counts.open || 0 },
        { value: 'in_progress', label: 'In Progress', count: counts.in_progress || 0 },
        { value: 'planned', label: 'Planned', count: counts.planned || 0 },
        { value: 'completed', label: 'Completed', count: counts.completed || 0 },
      ].filter((f) => f.value === 'all' || f.count > 0)
    },
  },

  async mounted() {
    await this.loadSubmissions()
  },

  methods: {
    async loadSubmissions() {
      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch('/api/user/submissions', {
          params: { page: this.page, limit: 20 },
        })
        this.submissions = response?.data || []
        this.totalCount = response?.pagination?.totalCount || 0
        this.totalPages = response?.pagination?.totalPages || 1
      } catch (error) {
        this.error = 'Something went wrong. Please try again.'
        console.error('Error loading submissions:', error)
      } finally {
        this.isLoading = false
      }
    },

    async goToPage(newPage) {
      this.page = newPage
      await this.loadSubmissions()
    },

    formatDate(date) {
      if (!date) return ''
      const d = new Date(date)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      return d.toLocaleDateString()
    },

    formatStatus(status) {
      const labels = {
        open: 'Open',
        in_progress: 'In Progress',
        planned: 'Planned',
        completed: 'Completed',
        closed: 'Closed',
        declined: 'Declined',
      }
      return labels[status] || status
    },

    getStatusVariant(status) {
      if (status === 'completed') return 'default'
      if (status === 'in_progress' || status === 'planned') return 'secondary'
      if (status === 'declined' || status === 'closed') return 'outline'
      return 'secondary'
    },
  },
}
</script>
