<template>
  <div class="min-h-screen bg-background">
    <!-- Loading State -->
    <div v-if="isLoading" class="max-w-4xl mx-auto px-4 py-12">
      <div class="space-y-4">
        <Skeleton class="h-10 w-64" />
        <Skeleton class="h-5 w-96" />
        <div class="grid grid-cols-4 gap-4 mt-8">
          <Skeleton v-for="n in 4" :key="n" class="h-20" />
        </div>
        <Skeleton v-for="n in 3" :key="n" class="h-24 mt-4" />
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="max-w-4xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">Project Not Found</h1>
      <p class="text-muted-foreground">{{ error }}</p>
    </div>

    <!-- Main Content -->
    <div v-else-if="projectData" class="max-w-4xl mx-auto px-4 py-8">
      <!-- Header -->
      <div class="mb-8">
        <div class="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <span>{{ projectData.organization.name }}</span>
        </div>
        <h1 class="text-3xl font-bold mb-2">{{ projectData.project.name }}</h1>
        <p v-if="projectData.project.description" class="text-muted-foreground text-lg">
          {{ projectData.project.description }}
        </p>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="rounded-lg border bg-card p-4">
          <p class="text-sm text-muted-foreground">Total</p>
          <p class="text-2xl font-bold">{{ projectData.stats.total }}</p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-sm text-muted-foreground">Open</p>
          <p class="text-2xl font-bold text-orange-600">{{ projectData.stats.open }}</p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-sm text-muted-foreground">In Progress</p>
          <p class="text-2xl font-bold text-blue-600">{{ projectData.stats.inProgress }}</p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-sm text-muted-foreground">Completed</p>
          <p class="text-2xl font-bold text-green-600">{{ projectData.stats.completed }}</p>
        </div>
      </div>

      <!-- Actions Bar -->
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div class="flex flex-wrap items-center gap-2">
          <!-- Status Filter -->
          <select
            v-model="filters.status"
            class="px-3 py-2 rounded-md border bg-background text-sm"
            @change="loadFeedback"
          >
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="planned">Planned</option>
            <option value="completed">Completed</option>
          </select>

          <!-- Category Filter -->
          <select
            v-model="filters.categoryId"
            class="px-3 py-2 rounded-md border bg-background text-sm"
            @change="loadFeedback"
          >
            <option value="">All Categories</option>
            <option
              v-for="cat in projectData.categories"
              :key="cat.id"
              :value="cat.id"
            >
              {{ cat.name }}
            </option>
          </select>

          <!-- Sort -->
          <select
            v-model="filters.sortBy"
            class="px-3 py-2 rounded-md border bg-background text-sm"
            @change="loadFeedback"
          >
            <option value="voteCount">Most Voted</option>
            <option value="createdAt">Newest</option>
          </select>
        </div>

        <Button @click="showSubmitDialog = true">
          <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
          Submit Feedback
        </Button>
      </div>

      <!-- Feedback List -->
      <div v-if="feedbackLoading" class="space-y-4">
        <Skeleton v-for="n in 3" :key="n" class="h-28" />
      </div>

      <div v-else-if="feedbackItems.length === 0" class="rounded-lg border bg-card p-12 text-center">
        <Icon name="lucide:message-square" class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 class="text-lg font-semibold mb-2">No feedback yet</h2>
        <p class="text-muted-foreground mb-4">Be the first to submit feedback for this product!</p>
        <Button @click="showSubmitDialog = true">
          <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
          Submit Feedback
        </Button>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="item in feedbackItems"
          :key="item.id"
          class="rounded-lg border bg-card hover:shadow-sm transition-shadow"
        >
          <div class="flex items-start gap-4 p-4">
            <!-- Vote Button -->
            <div class="flex flex-col items-center min-w-[48px]">
              <button
                class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors"
                @click="handleVote(item)"
              >
                <Icon
                  name="lucide:chevron-up"
                  class="w-5 h-5"
                  :class="item.hasVoted ? 'text-primary' : 'text-muted-foreground'"
                />
                <span class="text-sm font-semibold">{{ item.voteCount }}</span>
              </button>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2 mb-1">
                <h3 class="font-medium">{{ item.title }}</h3>
                <div class="flex items-center gap-2 shrink-0">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="statusClasses[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'"
                  >
                    {{ formatStatus(item.status) }}
                  </span>
                  <span
                    v-if="item.category"
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :style="{ backgroundColor: item.category.color + '20', color: item.category.color }"
                  >
                    {{ item.category.name }}
                  </span>
                </div>
              </div>
              <p v-if="item.body" class="text-sm text-muted-foreground line-clamp-2 mb-2">
                {{ item.body }}
              </p>
              <div class="flex items-center gap-4 text-xs text-muted-foreground">
                <span v-if="item.authorName">
                  <Icon name="lucide:user" class="w-3 h-3 inline" />
                  {{ item.authorName }}
                </span>
                <span>
                  <Icon name="lucide:calendar" class="w-3 h-3 inline" />
                  {{ formatDate(item.createdAt) }}
                </span>
                <span v-if="item.commentCount > 0">
                  <Icon name="lucide:message-circle" class="w-3 h-3 inline" />
                  {{ item.commentCount }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="pagination.totalPages > 1" class="flex items-center justify-between pt-4">
          <p class="text-sm text-muted-foreground">
            Page {{ pagination.page }} of {{ pagination.totalPages }}
            ({{ pagination.total }} total)
          </p>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="pagination.page <= 1"
              @click="changePage(pagination.page - 1)"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="pagination.page >= pagination.totalPages"
              @click="changePage(pagination.page + 1)"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <!-- Submit Feedback Dialog -->
      <Dialog :open="showSubmitDialog" @update:open="showSubmitDialog = $event">
        <DialogContent class="sm:max-w-[500px]">
          <DialogHeader>
            <h2 class="text-lg font-semibold">Submit Feedback</h2>
            <p class="text-sm text-muted-foreground">
              Share your ideas, report bugs, or suggest improvements.
            </p>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label for="fb-title">Title</Label>
              <Input
                id="fb-title"
                v-model="submitForm.title"
                placeholder="Brief summary of your feedback"
              />
            </div>
            <div class="space-y-2">
              <Label for="fb-body">Description</Label>
              <textarea
                id="fb-body"
                v-model="submitForm.body"
                rows="4"
                placeholder="Describe your feedback in detail..."
                class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div class="space-y-2">
              <Label for="fb-category">Category</Label>
              <select
                id="fb-category"
                v-model="submitForm.categoryId"
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a category</option>
                <option
                  v-for="cat in projectData.categories"
                  :key="cat.id"
                  :value="cat.id"
                >
                  {{ cat.name }}
                </option>
              </select>
            </div>
            <div class="space-y-2">
              <Label for="fb-name">Your Name</Label>
              <Input
                id="fb-name"
                v-model="submitForm.authorName"
                placeholder="John Doe"
              />
            </div>
            <div class="space-y-2">
              <Label for="fb-email">Email (optional)</Label>
              <Input
                id="fb-email"
                v-model="submitForm.authorEmail"
                type="email"
                placeholder="you@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="showSubmitDialog = false">Cancel</Button>
            <Button
              :disabled="isSubmitting || !submitForm.title || !submitForm.body || !submitForm.authorName"
              @click="submitFeedback"
            >
              <Icon v-if="isSubmitting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Footer -->
      <div class="mt-12 pt-6 border-t text-center text-sm text-muted-foreground">
        Powered by <span class="font-medium">Veerify</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'PublicFeedbackPage',
  layout: false,

  data() {
    return {
      projectData: null,
      feedbackItems: [],
      isLoading: true,
      error: null,
      feedbackLoading: false,
      showSubmitDialog: false,
      isSubmitting: false,
      filters: {
        status: '',
        categoryId: '',
        sortBy: 'voteCount',
      },
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
      submitForm: {
        title: '',
        body: '',
        categoryId: '',
        authorName: '',
        authorEmail: '',
      },
      statusClasses: {
        open: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
        in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        planned: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        closed: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
        declined: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      },
    }
  },

  async mounted() {
    const route = useRoute()
    const orgSlug = route.params.orgSlug
    const projectSlug = route.params.projectSlug

    if (!orgSlug || !projectSlug) {
      this.error = 'Invalid URL'
      this.isLoading = false
      return
    }

    try {
      const response = await $fetch(`/api/public/${orgSlug}/${projectSlug}`)
      this.projectData = response?.data
      await this.loadFeedback()
    } catch (err) {
      console.error('Error loading project:', err)
      this.error = 'This feedback page could not be found.'
    } finally {
      this.isLoading = false
    }
  },

  methods: {
    async loadFeedback() {
      if (!this.projectData) return

      const route = useRoute()
      const orgSlug = route.params.orgSlug
      const projectSlug = route.params.projectSlug

      this.feedbackLoading = true

      try {
        const params = new URLSearchParams()
        params.set('page', String(this.pagination.page))
        params.set('limit', String(this.pagination.limit))
        params.set('sortBy', this.filters.sortBy)
        params.set('sortOrder', 'desc')
        if (this.filters.status) params.set('status', this.filters.status)
        if (this.filters.categoryId) params.set('categoryId', this.filters.categoryId)

        const response = await $fetch(
          `/api/public/${orgSlug}/${projectSlug}/feedback?${params.toString()}`
        )
        const data = response?.data
        this.feedbackItems = data?.items || []
        this.pagination = data?.pagination || this.pagination
      } catch (err) {
        console.error('Error loading feedback:', err)
      } finally {
        this.feedbackLoading = false
      }
    },

    async submitFeedback() {
      if (!this.submitForm.title || !this.submitForm.body || !this.submitForm.authorName) return

      const route = useRoute()
      const orgSlug = route.params.orgSlug
      const projectSlug = route.params.projectSlug

      this.isSubmitting = true

      try {
        await $fetch(`/api/public/${orgSlug}/${projectSlug}/feedback`, {
          method: 'POST',
          body: {
            title: this.submitForm.title,
            body: this.submitForm.body,
            categoryId: this.submitForm.categoryId || null,
            authorName: this.submitForm.authorName,
            authorEmail: this.submitForm.authorEmail || undefined,
          },
        })

        this.showSubmitDialog = false
        this.submitForm = { title: '', body: '', categoryId: '', authorName: '', authorEmail: '' }
        // Reload to show new feedback
        this.pagination.page = 1
        this.filters.sortBy = 'createdAt'
        await this.loadFeedback()

        // Also reload project data for updated stats
        const projectResponse = await $fetch(`/api/public/${orgSlug}/${projectSlug}`)
        this.projectData = projectResponse?.data
      } catch (err) {
        console.error('Error submitting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to submit feedback. Please try again.')
      } finally {
        this.isSubmitting = false
      }
    },

    async handleVote(item) {
      // Voting requires auth — redirect or show message
      try {
        const response = await $fetch(`/api/feedback/${item.id}/vote`, { method: 'POST' })
        const data = response?.data
        item.voteCount = data.voteCount
        item.hasVoted = data.voted
      } catch (err) {
        if (err?.statusCode === 401) {
          alert('Please sign in to vote on feedback.')
        }
      }
    },

    changePage(page) {
      this.pagination.page = page
      this.loadFeedback()
    },

    formatStatus(status) {
      const map = {
        open: 'Open',
        in_progress: 'In Progress',
        planned: 'Planned',
        completed: 'Completed',
        closed: 'Closed',
        declined: 'Declined',
      }
      return map[status] || status
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
  },
}
</script>
