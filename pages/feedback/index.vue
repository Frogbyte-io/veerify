<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 data-testid="feedback-page-title" class="text-3xl font-bold text-foreground">Feedback</h1>
            <p class="text-muted-foreground">Manage and respond to user feedback and feature requests</p>
          </div>
          <div class="flex items-center gap-4">
            <select
              v-if="products.length > 1"
              v-model="selectedProjectId"
              data-testid="feedback-project-selector"
              class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
              @change="onProjectChange()"
            >
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <Button
              data-testid="feedback-add-button"
              :disabled="!selectedProjectId"
              @click="showCreateDialog = true"
            >
              <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
              Add Feedback
            </Button>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" data-testid="feedback-loading" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div v-for="n in 4" :key="n" class="bg-card p-6 rounded-lg border border-border">
            <Skeleton class="h-8 w-8 mb-2" />
            <Skeleton class="h-4 w-24 mb-1" />
            <Skeleton class="h-6 w-12" />
          </div>
        </div>
        <div class="bg-card rounded-lg border border-border p-6">
          <Skeleton class="h-6 w-40 mb-4" />
          <div v-for="n in 3" :key="n" class="py-4">
            <Skeleton class="h-5 w-64 mb-2" />
            <Skeleton class="h-4 w-96" />
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" data-testid="feedback-error" class="rounded-lg border bg-card p-8 text-center">
        <Icon name="lucide:alert-circle" class="w-12 h-12 mx-auto text-destructive mb-4" />
        <p class="text-lg font-medium mb-2">Failed to load feedback</p>
        <p class="text-muted-foreground mb-4">{{ error }}</p>
        <Button variant="outline" @click="loadProducts">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>

      <!-- No Products State -->
      <div v-else-if="products.length === 0" class="rounded-lg border bg-card p-12 text-center">
        <Icon name="lucide:package" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
        <h2 class="text-xl font-semibold mb-2">No products yet</h2>
        <p class="text-muted-foreground mb-6">
          Create a product first to start collecting and managing feedback.
        </p>
        <NuxtLink to="/products">
          <Button>
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Go to Products
          </Button>
        </NuxtLink>
      </div>

      <!-- Main Content -->
      <div v-else>
        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <Icon name="lucide:message-square" class="w-8 h-8 text-blue-600 dark:text-blue-400" />
              <div class="ml-4">
                <p class="text-sm font-medium text-muted-foreground">Total Feedback</p>
                <p data-testid="feedback-stat-total" class="text-2xl font-bold text-card-foreground">{{ pagination.total }}</p>
              </div>
            </div>
          </div>
          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <Icon name="lucide:clock" class="w-8 h-8 text-orange-600 dark:text-orange-400" />
              <div class="ml-4">
                <p class="text-sm font-medium text-muted-foreground">Open</p>
                <p class="text-2xl font-bold text-card-foreground">{{ statusCounts.open }}</p>
              </div>
            </div>
          </div>
          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <Icon name="lucide:play" class="w-8 h-8 text-blue-600 dark:text-blue-400" />
              <div class="ml-4">
                <p class="text-sm font-medium text-muted-foreground">In Progress</p>
                <p class="text-2xl font-bold text-card-foreground">{{ statusCounts.in_progress }}</p>
              </div>
            </div>
          </div>
          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <Icon name="lucide:check-circle" class="w-8 h-8 text-green-600 dark:text-green-400" />
              <div class="ml-4">
                <p class="text-sm font-medium text-muted-foreground">Completed</p>
                <p class="text-2xl font-bold text-card-foreground">{{ statusCounts.completed }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Filters -->
        <div class="bg-card rounded-lg border border-border p-6 mb-6">
          <div class="flex flex-wrap items-center gap-4">
            <div>
              <label class="block text-sm text-muted-foreground mb-1">Status</label>
              <select
                v-model="statusFilter"
                class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
                @change="onFilterChange()"
              >
                <option value="">All Status</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="closed">Closed</option>
                <option value="declined">Declined</option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-muted-foreground mb-1">Sort By</label>
              <select
                v-model="sortBy"
                class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
                @change="onFilterChange()"
              >
                <option value="voteCount">Most Popular</option>
                <option value="createdAt">Most Recent</option>
                <option value="updatedAt">Recently Updated</option>
                <option value="title">Title</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Feedback Loading -->
        <div v-if="isFeedbackLoading" class="bg-card rounded-lg border border-border p-6">
          <div v-for="n in 3" :key="n" class="py-4 border-b border-border last:border-0">
            <Skeleton class="h-5 w-64 mb-2" />
            <Skeleton class="h-4 w-full max-w-md mb-2" />
            <Skeleton class="h-3 w-32" />
          </div>
        </div>

        <!-- Feedback Error -->
        <div v-else-if="feedbackError" class="rounded-lg border bg-card p-8 text-center">
          <Icon name="lucide:alert-circle" class="w-10 h-10 mx-auto text-destructive mb-3" />
          <p class="text-muted-foreground mb-4">{{ feedbackError }}</p>
          <Button variant="outline" size="sm" @click="loadFeedback">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- Empty Feedback State -->
        <div v-else-if="feedbackItems.length === 0" data-testid="feedback-empty" class="rounded-lg border bg-card p-12 text-center">
          <Icon name="lucide:message-square-plus" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h2 class="text-xl font-semibold mb-2">No feedback yet</h2>
          <p class="text-muted-foreground mb-6">
            Be the first to add feedback for this project.
          </p>
          <Button @click="showCreateDialog = true">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add Feedback
          </Button>
        </div>

        <!-- Feedback List -->
        <div v-else data-testid="feedback-list" class="bg-card rounded-lg border border-border">
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold text-card-foreground">
              Feedback
              <span class="text-sm font-normal text-muted-foreground ml-2">{{ pagination.total }} total</span>
            </h2>
          </div>
          <div class="divide-y divide-border">
            <NuxtLink
              v-for="item in feedbackItems"
              :key="item.id"
              :to="`/feedback/${item.id}`"
              :data-testid="`feedback-item-${item.id}`"
              class="block p-6 hover:bg-muted transition-colors cursor-pointer"
            >
              <div class="flex items-start space-x-4">
                <div class="flex flex-col items-center space-y-1">
                  <div class="flex flex-col items-center p-2 rounded-lg">
                    <Icon name="lucide:chevron-up" class="w-4 h-4 text-muted-foreground" />
                    <span class="text-sm font-medium text-card-foreground">{{ item.voteCount }}</span>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <h3 class="text-lg font-medium text-card-foreground mb-1 group-hover:text-primary">{{ item.title }}</h3>
                      <p v-if="item.body" class="text-muted-foreground mb-3 line-clamp-2">{{ item.body }}</p>
                      <div class="flex items-center flex-wrap gap-3 text-sm text-muted-foreground">
                        <div v-if="item.authorName" class="flex items-center gap-1">
                          <Icon name="lucide:user" class="w-4 h-4" />
                          <span>{{ item.authorName }}</span>
                        </div>
                        <div class="flex items-center gap-1">
                          <Icon name="lucide:calendar" class="w-4 h-4" />
                          <span>{{ formatDate(item.createdAt) }}</span>
                        </div>
                        <div class="flex items-center gap-1">
                          <Icon name="lucide:message-circle" class="w-4 h-4" />
                          <span>{{ item.commentCount }} comments</span>
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <Badge :variant="statusBadgeVariant(item.status)">
                        {{ formatStatus(item.status) }}
                      </Badge>
                      <Badge v-if="item.category" variant="outline">
                        {{ item.category.name }}
                      </Badge>
                      <button
                        :data-testid="`feedback-item-delete-${item.id}`"
                        class="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete feedback"
                        @click.prevent="confirmDelete(item)"
                      >
                        <Icon name="lucide:trash-2" class="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </NuxtLink>
          </div>

          <!-- Pagination -->
          <div v-if="pagination.totalPages > 1" class="p-6 border-t border-border">
            <div class="flex items-center justify-between">
              <div class="text-sm text-muted-foreground">
                Page {{ pagination.page }} of {{ pagination.totalPages }} ({{ pagination.total }} total)
              </div>
              <div class="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="pagination.page <= 1"
                  @click="goToPage(pagination.page - 1)"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="pagination.page >= pagination.totalPages"
                  @click="goToPage(pagination.page + 1)"
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Create Feedback Dialog -->
      <Dialog :open="showCreateDialog" @update:open="showCreateDialog = $event">
        <DialogContent class="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Feedback</DialogTitle>
            <DialogDescription>Create a new feedback item for {{ selectedProject?.name || 'this project' }}.</DialogDescription>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label for="feedback-title">Title</Label>
              <Input
                id="feedback-title"
                data-testid="feedback-create-title"
                v-model="createForm.title"
                placeholder="Brief summary of the feedback"
              />
            </div>
            <div class="space-y-2">
              <Label for="feedback-body">Description</Label>
              <textarea
                id="feedback-body"
                data-testid="feedback-create-body"
                v-model="createForm.body"
                placeholder="Provide details about the feedback"
                rows="4"
                class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              ></textarea>
            </div>
            <div v-if="categories.length > 0" class="space-y-2">
              <Label for="feedback-category">Category</Label>
              <select
                id="feedback-category"
                data-testid="feedback-create-category"
                v-model="createForm.categoryId"
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option :value="null">No category</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="showCreateDialog = false">Cancel</Button>
            <Button
              data-testid="feedback-create-submit"
              :disabled="isCreating || !createForm.title || !createForm.body"
              @click="createFeedback"
            >
              <Icon v-if="isCreating" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Add Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Delete Confirmation Dialog -->
      <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
        <DialogContent class="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Feedback</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{{ feedbackToDelete?.title }}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
            <Button
              data-testid="feedback-delete-confirm"
              variant="destructive"
              :disabled="isDeleting"
              @click="deleteFeedback"
            >
              <Icon v-if="isDeleting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </NuxtLayout>
</template>

<script>
const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'FeedbackPage',

  data() {
    return {
      products: [],
      selectedProjectId: '',
      activeTeamId: '',
      activeOrgSlug: '',

      feedbackItems: [],
      categories: [],
      statusCounts: { open: 0, in_progress: 0, completed: 0 },

      isLoading: true,
      isFeedbackLoading: false,
      error: null,
      feedbackError: null,

      showCreateDialog: false,
      isCreating: false,
      createForm: { title: '', body: '', categoryId: null },

      showDeleteDialog: false,
      isDeleting: false,
      feedbackToDelete: null,

      statusFilter: '',
      sortBy: 'voteCount',
      sortOrder: 'desc',
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }
  },

  computed: {
    selectedProject() {
      return this.products.find((p) => p.id === this.selectedProjectId) || null
    },
  },

  async mounted() {
    await this.initTeamContext()

    if (import.meta.client) {
      window.addEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  methods: {
    async handleActiveTeamChanged() {
      await this.initTeamContext()
    },

    async initTeamContext() {
      this.isLoading = true
      this.error = null

      try {
        const teamResponse = await $fetch('/api/teams/active')
        const activeTeamData = teamResponse?.data

        if (!activeTeamData?.id) {
          this.error = 'No active team found'
          this.isLoading = false
          return
        }

        this.activeTeamId = activeTeamData.id

        // Extract organization slug from the response
        if (activeTeamData.organization?.slug) {
          this.activeOrgSlug = activeTeamData.organization.slug
        }

        await this.loadProducts()
      } catch (err) {
        console.error('Error initializing team context:', err)
        this.error = err?.data?.message || 'Failed to load team context'
        this.isLoading = false
      }
    },

    async loadProducts() {
      if (!this.activeTeamId) return

      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/teams/${this.activeTeamId}/projects`)
        this.products = response?.data || []

        if (this.products.length > 0) {
          const queryProjectId = this.$route.query.projectId
          if (queryProjectId && this.products.find((p) => p.id === queryProjectId)) {
            this.selectedProjectId = queryProjectId
          } else if (!this.selectedProjectId || !this.products.find((p) => p.id === this.selectedProjectId)) {
            this.selectedProjectId = this.products[0].id
          }
          await this.onProjectChange()
        }
      } catch (err) {
        console.error('Error loading products:', err)
        this.error = 'Failed to load products. Please try again.'
      } finally {
        this.isLoading = false
      }
    },

    async onProjectChange() {
      this.pagination.page = 1
      await Promise.all([this.loadFeedback(), this.loadCategories()])
    },

    async loadFeedback() {
      if (!this.selectedProjectId) return

      this.isFeedbackLoading = true
      this.feedbackError = null

      try {
        const params = new URLSearchParams({
          projectId: this.selectedProjectId,
          sortBy: this.sortBy,
          sortOrder: this.sortOrder,
          page: String(this.pagination.page),
          limit: String(this.pagination.limit),
        })
        if (this.statusFilter) params.set('status', this.statusFilter)

        const response = await $fetch(`/api/feedback?${params}`)
        this.feedbackItems = response?.data?.items || []
        this.pagination = response?.data?.pagination || this.pagination

        this.updateStatusCounts()
      } catch (err) {
        console.error('Error loading feedback:', err)
        this.feedbackError = 'Failed to load feedback. Please try again.'
      } finally {
        this.isFeedbackLoading = false
      }
    },

    async loadCategories() {
      const proj = this.selectedProject
      if (!proj?.slug) return

      try {
        const response = await $fetch(`/api/projects/${proj.slug}/categories`)
        this.categories = response?.data || []
      } catch (err) {
        console.error('Error loading categories:', err)
      }
    },

    updateStatusCounts() {
      const counts = { open: 0, in_progress: 0, completed: 0 }
      for (const item of this.feedbackItems) {
        if (item.status in counts) {
          counts[item.status]++
        }
      }
      this.statusCounts = counts
    },

    async onFilterChange() {
      this.pagination.page = 1
      await this.loadFeedback()
    },

    async goToPage(page) {
      this.pagination.page = page
      await this.loadFeedback()
    },

    async createFeedback() {
      if (!this.selectedProjectId || !this.createForm.title || !this.createForm.body) return

      this.isCreating = true

      try {
        await $fetch('/api/feedback', {
          method: 'POST',
          body: {
            projectId: this.selectedProjectId,
            title: this.createForm.title,
            body: this.createForm.body,
            categoryId: this.createForm.categoryId || null,
          },
        })

        this.showCreateDialog = false
        this.createForm = { title: '', body: '', categoryId: null }
        await this.loadFeedback()
      } catch (err) {
        console.error('Error creating feedback:', err)
        alert(err?.data?.error?.message || 'Failed to create feedback')
      } finally {
        this.isCreating = false
      }
    },

    confirmDelete(item) {
      this.feedbackToDelete = item
      this.showDeleteDialog = true
    },

    async deleteFeedback() {
      if (!this.feedbackToDelete) return

      this.isDeleting = true

      try {
        await $fetch(`/api/feedback/${this.feedbackToDelete.id}`, { method: 'DELETE' })
        this.showDeleteDialog = false
        this.feedbackToDelete = null
        await this.loadFeedback()
      } catch (err) {
        console.error('Error deleting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to delete feedback')
      } finally {
        this.isDeleting = false
      }
    },

    formatDate(dateStr) {
      const date = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const days = Math.floor(diff / 86400000)
      if (days === 0) return 'Today'
      if (days === 1) return 'Yesterday'
      if (days < 7) return `${days} days ago`
      if (days < 30) return `${Math.floor(days / 7)} weeks ago`
      return date.toLocaleDateString()
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

    statusBadgeVariant(status) {
      const variants = {
        open: 'outline',
        in_progress: 'secondary',
        planned: 'default',
        completed: 'default',
        closed: 'secondary',
        declined: 'destructive',
      }
      return variants[status] || 'outline'
    },
  },
}
</script>
