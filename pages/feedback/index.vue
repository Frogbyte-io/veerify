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
          <div class="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  data-testid="feedback-products-filter-trigger"
                  class="min-w-[220px] justify-between"
                >
                  <span class="truncate">{{ selectedProductsLabel }}</span>
                  <Icon name="lucide:chevrons-up-down" class="w-4 h-4 ml-2 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-72">
                <DropdownMenuLabel>Products</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  data-testid="feedback-products-filter-all"
                  :model-value="allProductsSelected"
                  @update:model-value="toggleAllProducts"
                >
                  ALL
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  v-for="p in products"
                  :key="p.id"
                  :data-testid="`feedback-products-filter-item-${p.id}`"
                  :model-value="selectedProjectIds.includes(p.id)"
                  @update:model-value="(checked) => toggleProjectSelection(p.id, checked)"
                >
                  {{ p.name }}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button data-testid="feedback-add-button" :disabled="!canCreateFeedback" @click="showCreateDialog = true">
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
        <p class="text-muted-foreground mb-6">Create a product first to start collecting and managing feedback.</p>
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
                <p data-testid="feedback-stat-total" class="text-2xl font-bold text-card-foreground">
                  {{ pagination.total }}
                </p>
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
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <label class="block text-sm text-muted-foreground mb-1">View</label>
              <div class="inline-flex rounded-md border border-border p-1 bg-muted/30">
                <Button
                  data-testid="feedback-view-kanban"
                  size="sm"
                  :variant="viewMode === 'kanban' ? 'default' : 'ghost'"
                  @click="onViewModeChange('kanban')"
                >
                  <Icon name="lucide:layout-grid" class="w-4 h-4 mr-2" />
                  Kanban
                </Button>
                <Button
                  data-testid="feedback-view-table"
                  size="sm"
                  :variant="viewMode === 'table' ? 'default' : 'ghost'"
                  @click="onViewModeChange('table')"
                >
                  <Icon name="lucide:list" class="w-4 h-4 mr-2" />
                  Table
                </Button>
              </div>
            </div>
            <template v-if="viewMode === 'table'">
              <div>
                <label class="block text-sm text-muted-foreground mb-1">Status</label>
                <select
                  v-model="statusFilter"
                  data-testid="feedback-status-filter"
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
                  data-testid="feedback-sort-filter"
                  class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
                  @change="onFilterChange()"
                >
                  <option value="voteCount">Most Popular</option>
                  <option value="createdAt">Most Recent</option>
                  <option value="updatedAt">Recently Updated</option>
                  <option value="title">Title</option>
                </select>
              </div>
            </template>
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
        <div
          v-else-if="feedbackItems.length === 0"
          data-testid="feedback-empty"
          class="rounded-lg border bg-card p-12 text-center"
        >
          <Icon name="lucide:message-square-plus" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h2 class="text-xl font-semibold mb-2">No feedback yet</h2>
          <p class="text-muted-foreground mb-6">Be the first to add feedback for this project.</p>
          <Button @click="showCreateDialog = true">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add Feedback
          </Button>
        </div>

        <!-- Feedback -->
        <div v-else data-testid="feedback-list" class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-card-foreground">
              {{ viewMode === 'kanban' ? 'Kanban Board' : 'Feedback Table' }}
              <span class="text-sm font-normal text-muted-foreground ml-2">{{ pagination.total }} total</span>
            </h2>
          </div>
          <template v-if="viewMode === 'kanban'">
            <div data-testid="feedback-kanban" class="overflow-x-auto pb-2">
              <div
                class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 min-w-[960px] xl:min-w-0"
              >
                <section
                  v-for="column in kanbanColumns"
                  :key="column.value"
                  :data-testid="`feedback-kanban-column-${column.value}`"
                  class="rounded-lg border border-border bg-card/50 flex flex-col min-h-[420px]"
                >
                  <div class="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <Icon :name="column.icon" class="w-4 h-4 text-muted-foreground" />
                      <h3 class="text-sm font-semibold text-card-foreground">{{ column.label }}</h3>
                    </div>
                    <Badge variant="outline">{{ kanbanItemsByStatus[column.value].length }}</Badge>
                  </div>
                  <div class="p-3 space-y-3 flex-1">
                    <p
                      v-if="kanbanItemsByStatus[column.value].length === 0"
                      class="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3"
                    >
                      No items in {{ column.label.toLowerCase() }}.
                    </p>
                    <NuxtLink
                      v-for="item in kanbanItemsByStatus[column.value]"
                      :key="item.id"
                      :to="`/feedback/${item.id}`"
                      :data-testid="`feedback-item-${item.id}`"
                      class="block rounded-md border bg-card p-3 hover:shadow-sm transition-shadow"
                    >
                      <div class="flex items-start justify-between gap-2 mb-2">
                        <h4 class="text-sm font-medium text-card-foreground line-clamp-2">{{ item.title }}</h4>
                        <button
                          :data-testid="`feedback-item-delete-${item.id}`"
                          class="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="Delete feedback"
                          @click.prevent.stop="confirmDelete(item)"
                        >
                          <Icon name="lucide:trash-2" class="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p v-if="item.body" class="text-xs text-muted-foreground mb-2 line-clamp-3">{{ item.body }}</p>
                      <div class="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
                        <span class="inline-flex items-center gap-1">
                          <Icon name="lucide:chevron-up" class="w-3 h-3" />
                          {{ item.voteCount }}
                        </span>
                        <span class="inline-flex items-center gap-1">
                          <Icon name="lucide:message-circle" class="w-3 h-3" />
                          {{ item.commentCount }}
                        </span>
                        <Badge v-if="item.category" variant="outline" class="text-[10px] px-1.5 py-0">
                          {{ item.category.name }}
                        </Badge>
                      </div>
                      <p class="text-[11px] text-muted-foreground mt-2">
                        {{ formatDate(item.createdAt) }}
                      </p>
                    </NuxtLink>
                  </div>
                </section>
              </div>
            </div>
          </template>
          <template v-else>
            <div data-testid="feedback-table-wrapper" class="rounded-lg border border-border overflow-x-auto">
              <table data-testid="feedback-table" class="min-w-full text-sm">
                <thead class="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th class="text-left font-medium px-4 py-3">Feedback</th>
                    <th class="text-left font-medium px-4 py-3">Product</th>
                    <th class="text-left font-medium px-4 py-3">Status</th>
                    <th class="text-right font-medium px-4 py-3">Votes</th>
                    <th class="text-right font-medium px-4 py-3">Comments</th>
                    <th v-if="showGithubIssueColumn" class="text-left font-medium px-4 py-3">GitHub Issue</th>
                    <th class="text-left font-medium px-4 py-3">Updated</th>
                    <th class="text-right font-medium px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in feedbackItems"
                    :key="item.id"
                    :data-testid="`feedback-item-${item.id}`"
                    class="border-t border-border"
                  >
                    <td class="px-4 py-3 align-top">
                      <NuxtLink :to="`/feedback/${item.id}`" class="font-medium text-foreground hover:underline">
                        {{ item.title }}
                      </NuxtLink>
                      <p v-if="item.body" class="text-xs text-muted-foreground mt-1 line-clamp-2">{{ item.body }}</p>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <span class="text-muted-foreground">{{ item.project?.name || 'Unknown' }}</span>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <Badge :variant="statusBadgeVariant(item.status)">{{ formatStatus(item.status) }}</Badge>
                    </td>
                    <td class="px-4 py-3 align-top text-right tabular-nums">{{ item.voteCount }}</td>
                    <td class="px-4 py-3 align-top text-right tabular-nums">{{ item.commentCount }}</td>
                    <td v-if="showGithubIssueColumn" class="px-4 py-3 align-top">
                      <a
                        v-if="item.githubIssue?.issueUrl"
                        :href="item.githubIssue.issueUrl"
                        class="text-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        #{{ item.githubIssue.issueNumber }}
                      </a>
                      <Button
                        v-else-if="canCreateGithubIssue(item)"
                        size="sm"
                        variant="outline"
                        :disabled="isCreatingGithubIssue(item.id)"
                        :data-testid="`feedback-table-create-issue-${item.id}`"
                        @click="createGithubIssue(item)"
                      >
                        <Icon
                          v-if="isCreatingGithubIssue(item.id)"
                          name="lucide:loader-2"
                          class="w-3.5 h-3.5 mr-2 animate-spin"
                        />
                        Create issue
                      </Button>
                      <span v-else class="text-muted-foreground">-</span>
                    </td>
                    <td class="px-4 py-3 align-top text-muted-foreground">{{ formatDate(item.updatedAt) }}</td>
                    <td class="px-4 py-3 align-top text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        :data-testid="`feedback-item-delete-${item.id}`"
                        title="Delete feedback"
                        @click="confirmDelete(item)"
                      >
                        <Icon name="lucide:trash-2" class="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <!-- Pagination -->
          <div v-if="pagination.totalPages > 1" class="rounded-lg border border-border bg-card p-4">
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
            <DialogDescription
              >Create a new feedback item for {{ selectedProject?.name || 'this project' }}.</DialogDescription
            >
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label for="feedback-title">Title</Label>
              <Input
                id="feedback-title"
                v-model="createForm.title"
                data-testid="feedback-create-title"
                placeholder="Brief summary of the feedback"
              />
            </div>
            <div class="space-y-2">
              <Label for="feedback-body">Description</Label>
              <textarea
                id="feedback-body"
                v-model="createForm.body"
                data-testid="feedback-create-body"
                placeholder="Provide details about the feedback"
                rows="4"
                class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div v-if="categories.length > 0" class="space-y-2">
              <Label for="feedback-category">Category</Label>
              <select
                id="feedback-category"
                v-model="createForm.categoryId"
                data-testid="feedback-create-category"
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
      selectedProjectIds: [],
      activeTeamId: '',
      activeOrgSlug: '',

      feedbackItems: [],
      categories: [],
      githubIntegrationsByProjectId: {},
      creatingGithubIssueFeedbackIds: [],
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

      viewMode: 'kanban',
      statusFilter: '',
      sortBy: 'voteCount',
      sortOrder: 'desc',
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }
  },

  computed: {
    selectedProjectId() {
      return this.selectedProjectIds.length === 1 ? this.selectedProjectIds[0] : ''
    },
    selectedProject() {
      return this.products.find((p) => p.id === this.selectedProjectId) || null
    },
    allProductsSelected() {
      return this.products.length > 0 && this.selectedProjectIds.length === this.products.length
    },
    selectedProductsLabel() {
      if (this.products.length === 0) return 'No products'
      if (this.allProductsSelected) return 'ALL products'
      if (this.selectedProjectIds.length === 1) {
        return this.selectedProject?.name || '1 product selected'
      }
      return `${this.selectedProjectIds.length} products selected`
    },
    canCreateFeedback() {
      return Boolean(this.selectedProjectId)
    },
    showGithubIssueColumn() {
      return this.selectedProjectIds.some((projectId) => this.hasGithubIntegration(projectId))
    },
    kanbanColumns() {
      return [
        { value: 'open', label: 'Open', icon: 'lucide:clock-3' },
        { value: 'in_progress', label: 'In Progress', icon: 'lucide:play' },
        { value: 'planned', label: 'Planned', icon: 'lucide:calendar-range' },
        { value: 'completed', label: 'Completed', icon: 'lucide:check-circle' },
        { value: 'closed', label: 'Closed', icon: 'lucide:archive' },
        { value: 'declined', label: 'Declined', icon: 'lucide:x-circle' },
      ]
    },
    kanbanItemsByStatus() {
      const grouped = {}
      for (const column of this.kanbanColumns) {
        grouped[column.value] = []
      }
      for (const item of this.feedbackItems) {
        if (grouped[item.status]) {
          grouped[item.status].push(item)
        } else {
          grouped.open.push(item)
        }
      }
      return grouped
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
          this.selectedProjectIds = this.resolveInitialProjectSelection()
          await this.onProjectChange()
        } else {
          this.selectedProjectIds = []
          this.feedbackItems = []
          this.categories = []
          this.githubIntegrationsByProjectId = {}
          this.updateStatusCounts()
        }
      } catch (err) {
        console.error('Error loading products:', err)
        this.error = 'Failed to load products. Please try again.'
      } finally {
        this.isLoading = false
      }
    },

    resolveInitialProjectSelection() {
      const validIds = new Set(this.products.map((product) => product.id))
      const rawProjectIds = this.$route.query.projectIds
      const rawProjectId = this.$route.query.projectId

      const requestedIdsFromList = []
      if (typeof rawProjectIds === 'string') {
        requestedIdsFromList.push(...rawProjectIds.split(','))
      } else if (Array.isArray(rawProjectIds)) {
        for (const value of rawProjectIds) {
          requestedIdsFromList.push(...String(value).split(','))
        }
      }

      const requestedIds = requestedIdsFromList
        .map((id) => id.trim())
        .filter(Boolean)
        .filter((id) => validIds.has(id))

      if (requestedIds.length > 0) {
        return this.sortProjectIdsByProductOrder(requestedIds)
      }

      if (typeof rawProjectId === 'string' && validIds.has(rawProjectId)) {
        return [rawProjectId]
      }

      return this.products.map((product) => product.id)
    },

    sortProjectIdsByProductOrder(projectIds) {
      const uniqueIds = [...new Set(projectIds)]
      const productOrder = new Map(this.products.map((product, index) => [product.id, index]))
      return uniqueIds.sort((a, b) => (productOrder.get(a) ?? Infinity) - (productOrder.get(b) ?? Infinity))
    },

    syncProjectQuery() {
      if (!import.meta.client) return

      const query = { ...this.$route.query }
      delete query.projectId
      delete query.projectIds

      if (this.selectedProjectIds.length === 1) {
        query.projectId = this.selectedProjectIds[0]
      } else if (this.selectedProjectIds.length > 1 && !this.allProductsSelected) {
        query.projectIds = this.selectedProjectIds.join(',')
      }

      this.$router.replace({ query }).catch(() => {})
    },

    async toggleAllProducts(checked) {
      if (checked === true) {
        this.selectedProjectIds = this.products.map((product) => product.id)
      } else if (this.products.length > 0) {
        this.selectedProjectIds = [this.products[0].id]
      }
      await this.onProjectChange()
    },

    async toggleProjectSelection(projectId, checked) {
      const selected = new Set(this.selectedProjectIds)

      if (checked === true) {
        selected.add(projectId)
      } else if (selected.size > 1) {
        selected.delete(projectId)
      }

      this.selectedProjectIds = this.sortProjectIdsByProductOrder([...selected])
      await this.onProjectChange()
    },

    async onProjectChange() {
      if (this.selectedProjectIds.length === 0 && this.products.length > 0) {
        this.selectedProjectIds = [this.products[0].id]
      }
      this.selectedProjectIds = this.sortProjectIdsByProductOrder(this.selectedProjectIds)
      this.syncProjectQuery()
      this.pagination.page = 1
      await Promise.all([this.loadFeedback(), this.loadCategories(), this.loadGithubIntegrations()])
    },

    async loadFeedback() {
      if (this.selectedProjectIds.length === 0) {
        this.feedbackItems = []
        this.pagination = { ...this.pagination, page: 1, total: 0, totalPages: 0 }
        this.updateStatusCounts()
        return
      }

      this.isFeedbackLoading = true
      this.feedbackError = null

      try {
        const params = new URLSearchParams({
          projectIds: this.selectedProjectIds.join(','),
          page: String(this.pagination.page),
          limit: String(this.pagination.limit),
        })
        if (this.viewMode === 'table') {
          params.set('sortBy', this.sortBy)
          params.set('sortOrder', this.sortOrder)
          if (this.statusFilter) params.set('status', this.statusFilter)
        } else {
          params.set('sortBy', 'updatedAt')
          params.set('sortOrder', 'desc')
        }

        const response = await $fetch(`/api/feedback?${params}`)
        this.feedbackItems = (response?.data?.items || []).map((item) => ({
          ...item,
          githubIssue: item.githubIssue || null,
        }))
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
      if (!proj?.slug) {
        this.categories = []
        this.createForm.categoryId = null
        return
      }

      try {
        const response = await $fetch(`/api/projects/${proj.slug}/categories`)
        this.categories = response?.data || []
        if (
          this.createForm.categoryId &&
          !this.categories.find((category) => category.id === this.createForm.categoryId)
        ) {
          this.createForm.categoryId = null
        }
      } catch (err) {
        console.error('Error loading categories:', err)
      }
    },

    async loadGithubIntegrations() {
      if (this.selectedProjectIds.length === 0) {
        this.githubIntegrationsByProjectId = {}
        return
      }

      const integrations = {}
      await Promise.all(
        this.selectedProjectIds.map(async (projectId) => {
          const project = this.products.find((p) => p.id === projectId)
          if (!project?.slug) {
            integrations[projectId] = null
            return
          }

          try {
            const response = await $fetch(`/api/projects/${project.slug}/github`)
            integrations[projectId] = response?.data || null
          } catch (err) {
            console.error(`Error loading GitHub integration for project ${project.slug}:`, err)
            integrations[projectId] = null
          }
        })
      )

      this.githubIntegrationsByProjectId = integrations
    },

    hasGithubIntegration(projectId) {
      const integration = this.githubIntegrationsByProjectId[projectId]
      return Boolean(integration?.repoFullName && integration?.hasAccessToken)
    },

    canCreateGithubIssue(item) {
      return !item.githubIssue && this.hasGithubIntegration(item.projectId)
    },

    isCreatingGithubIssue(feedbackId) {
      return this.creatingGithubIssueFeedbackIds.includes(feedbackId)
    },

    async createGithubIssue(item) {
      if (!this.canCreateGithubIssue(item) || this.isCreatingGithubIssue(item.id)) return

      const integration = this.githubIntegrationsByProjectId[item.projectId]
      const repo = integration?.repoFullName
      if (!repo) return

      this.creatingGithubIssueFeedbackIds = [...this.creatingGithubIssueFeedbackIds, item.id]
      try {
        const response = await $fetch('/api/github/issues', {
          method: 'POST',
          body: {
            feedbackId: item.id,
            repo,
          },
        })

        const issue = response?.data?.issue
        if (issue) {
          item.githubIssue = {
            issueNumber: issue.number,
            issueUrl: issue.html_url,
            issueState: issue.state,
          }
        }

        const updatedFeedback = response?.data?.feedback
        if (updatedFeedback) {
          item.status = updatedFeedback.status
          item.updatedAt = updatedFeedback.updatedAt
        }

        this.updateStatusCounts()
      } catch (err) {
        console.error('Error creating GitHub issue:', err)
        alert(err?.data?.error?.message || 'Failed to create GitHub issue')
      } finally {
        this.creatingGithubIssueFeedbackIds = this.creatingGithubIssueFeedbackIds.filter(
          (feedbackId) => feedbackId !== item.id
        )
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
      if (this.viewMode !== 'table') return
      this.pagination.page = 1
      await this.loadFeedback()
    },

    async onViewModeChange(mode) {
      if (this.viewMode === mode) return

      this.viewMode = mode
      this.pagination.page = 1
      if (mode === 'kanban') {
        this.statusFilter = ''
      }
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
