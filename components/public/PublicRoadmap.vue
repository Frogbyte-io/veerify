<template>
  <div data-testid="public-roadmap">
    <PublicStateMessage
      v-if="!roadmapEnabled"
      icon="lucide:map"
      title="Roadmap not available"
      message="The roadmap feature is not enabled for this project."
      data-testid="public-roadmap-unavailable"
    >
      <NuxtLink
        :to="paths.feedback"
        class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Icon name="lucide:message-square" class="w-4 h-4" />
        View Feedback Board
      </NuxtLink>
    </PublicStateMessage>

    <template v-else>
      <PublicProductFilter
        :products="products"
        :selected="productFilter"
        :base-path="roadmapPath"
        :accent-color="accentColor"
      />

      <!-- Roadmap summary -->
      <p class="text-muted-foreground text-sm mb-6">A timeline view of all feedback items grouped by status.</p>

      <!-- Loading columns skeleton -->
      <div v-if="columnsLoading" class="flex gap-4 overflow-x-auto pb-4">
        <div v-for="n in 3" :key="n" class="flex-shrink-0 w-72 space-y-2">
          <Skeleton class="h-8 w-full" />
          <Skeleton v-for="m in 3" :key="m" class="h-24 w-full" />
        </div>
      </div>

      <PublicStateMessage
        v-else-if="columnsError"
        icon="lucide:alert-circle"
        kind="error"
        :title="columnsError"
        retryable
        @retry="loadRoadmap"
      />

      <!-- Empty state -->
      <PublicStateMessage
        v-else-if="visibleColumns.length === 0"
        icon="lucide:map"
        title="No roadmap items yet"
        message="Submit feedback to see it appear here."
      >
        <NuxtLink :to="feedbackBoardPath" prefetch-on="interaction" class="text-sm text-primary hover:underline">
          <Icon name="lucide:arrow-left" class="w-4 h-4 inline mr-1" />
          Back to feedback board
        </NuxtLink>
      </PublicStateMessage>

      <!-- Kanban columns -->
      <div v-else class="flex gap-4 overflow-x-auto pb-4">
        <div v-for="column in visibleColumns" :key="column.value" class="flex-shrink-0 w-72 flex flex-col">
          <!-- Column header -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span
                class="inline-block w-2.5 h-2.5 rounded-full"
                :style="{ backgroundColor: column.color || '#6b7280' }"
              />
              <h3 class="font-semibold text-sm">{{ column.name }}</h3>
            </div>
            <span class="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {{ column.items.length }}
            </span>
          </div>

          <!-- Column cards -->
          <div class="space-y-2 flex-1">
            <div
              v-for="item in column.items"
              :key="item.id"
              class="rounded-lg border bg-card p-3 hover:shadow-sm transition-shadow cursor-pointer"
              @click="openFeedbackItem(item)"
            >
              <!-- Pin indicator -->
              <div v-if="item.isPinned" class="flex items-center gap-1 text-xs text-amber-600 mb-1.5">
                <Icon name="lucide:pin" class="w-3 h-3" />
                <span>Pinned</span>
              </div>

              <!-- Category + tag -->
              <div v-if="item.category || item.tag" class="flex flex-wrap gap-1 mb-2">
                <span
                  v-if="item.category"
                  class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium"
                  :style="{
                    backgroundColor: item.category.color ? item.category.color + '22' : '#6b728022',
                    color: item.category.color || '#6b7280',
                  }"
                >
                  <Icon v-if="item.category.icon" :name="'lucide:' + item.category.icon" class="w-3 h-3" />
                  {{ item.category.name }}
                </span>
                <span
                  v-if="item.tag"
                  class="inline-flex items-center text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {{ feedbackTypeLabel(item.tag) }}
                </span>
              </div>

              <!-- Product -->
              <span
                v-if="productName(item)"
                class="inline-flex items-center text-xs px-1.5 py-0.5 rounded-full border mb-2"
                data-testid="public-roadmap-product-badge"
              >
                {{ productName(item) }}
              </span>

              <!-- Title -->
              <p class="text-sm font-medium line-clamp-2 mb-2">{{ item.title }}</p>

              <!-- Meta: votes + comments + date -->
              <div class="flex items-center gap-3 text-xs text-muted-foreground">
                <span class="flex items-center gap-1">
                  <Icon name="lucide:chevrons-up" class="w-3 h-3" />
                  {{ item.voteCount }}
                </span>
                <span class="flex items-center gap-1">
                  <Icon name="lucide:message-circle" class="w-3 h-3" />
                  {{ item.commentCount }}
                </span>
                <span class="ml-auto">{{ formatDate(item.createdAt) }}</span>
              </div>
            </div>

            <!-- Empty column placeholder -->
            <div
              v-if="column.items.length === 0"
              class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground"
            >
              No items
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Feedback detail dialog (reused from board) -->
    <Dialog :open="showDetailsDialog" @update:open="showDetailsDialog = $event">
      <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <div v-if="selectedFeedback" class="space-y-4">
          <DialogHeader>
            <DialogTitle class="text-xl font-bold pr-8">{{ selectedFeedback.title }}</DialogTitle>
          </DialogHeader>
          <p v-if="selectedFeedback.body" class="text-sm text-muted-foreground whitespace-pre-wrap">
            {{ selectedFeedback.body }}
          </p>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span class="px-2 py-0.5 rounded-full font-medium" :style="statusBadgeStyle(selectedFeedback.status)">
              {{ selectedFeedback.status }}
            </span>
            <span>{{ selectedFeedback.voteCount }} votes</span>
            <span>&middot;</span>
            <span>{{ formatDate(selectedFeedback.createdAt) }}</span>
          </div>
          <NuxtLink
            :to="feedbackBoardPath"
            prefetch-on="interaction"
            class="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Icon name="lucide:external-link" class="w-4 h-4" />
            View on feedback board
          </NuxtLink>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { publicCache, publicTabRequest } from '~/lib/public-cache'

/** Roadmap tab body. The shell (PublicProjectShell) owns header, tabs and theme. */
export default {
  name: 'PublicRoadmap',
  props: {
    orgSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
    projectData: { type: Object, required: true },
    paths: { type: Object, required: true },
  },
  data() {
    return {
      columns: [],
      columnsLoading: true,
      columnsError: null,
      roadmapSeq: 0,
      showDetailsDialog: false,
      selectedFeedback: null,
      feedbackTypeOptions: [
        { value: 'feature_request', label: 'Feature Request' },
        { value: 'bug_report', label: 'Bug Report' },
        { value: 'improvement', label: 'Improvement' },
        { value: 'question', label: 'Question' },
        { value: 'other', label: 'Other' },
      ],
    }
  },
  computed: {
    accentColor() {
      return this.projectData.project?.settings?.accentColor || '#6366f1'
    },
    products() {
      return this.projectData.products || []
    },
    productFilter() {
      const value = this.$route.query.product
      return typeof value === 'string' ? value : ''
    },
    roadmapPath() {
      return this.paths.roadmap
    },
    feedbackBoardPath() {
      return this.productFilter ? this.paths.product(this.productFilter) : this.paths.feedback
    },
    roadmapEnabled() {
      return this.projectData.project?.settings?.roadmapEnabled === true
    },
    visibleColumns() {
      return this.columns.filter((col) => col.items.length > 0)
    },
  },
  watch: {
    productFilter() {
      if (this.roadmapEnabled) this.loadRoadmap()
    },
  },
  async mounted() {
    if (this.roadmapEnabled) await this.loadRoadmap()
  },
  methods: {
    async loadRoadmap() {
      const seq = ++this.roadmapSeq
      const request = publicTabRequest('roadmap', this.orgSlug, this.projectSlug, { product: this.productFilter })
      const hit = publicCache.peek(request.key)
      this.columnsError = null
      if (hit) {
        this.columns = hit.data?.data?.columns || []
        this.columnsLoading = false
        if (!hit.stale) return
      } else {
        this.columnsLoading = true
      }
      try {
        const response = await publicCache.load(request.key, request.fetcher, { force: Boolean(hit) })
        if (seq !== this.roadmapSeq) return
        this.columns = response?.data?.columns || []
      } catch (err) {
        if (seq !== this.roadmapSeq || hit) return
        console.error('Error loading roadmap items:', err)
        this.columns = []
        this.columnsError = 'Failed to load the roadmap.'
      } finally {
        if (seq === this.roadmapSeq) this.columnsLoading = false
      }
    },
    productName(item) {
      if (this.products.length < 2) return ''
      if (item.product?.name) return item.product.name
      return this.products.find((p) => p.id === item.productId)?.name || ''
    },
    feedbackTypeLabel(value) {
      const option = this.feedbackTypeOptions.find((item) => item.value === value)
      return option?.label || value
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
    statusBadgeStyle(status) {
      const colorMap = {
        open: '#3b82f6',
        planned: '#8b5cf6',
        in_progress: '#f59e0b',
        completed: '#10b981',
        closed: '#6b7280',
        declined: '#ef4444',
      }
      const color = colorMap[status] || '#6b7280'
      return {
        backgroundColor: color + '22',
        color,
      }
    },
    openFeedbackItem(item) {
      this.selectedFeedback = item
      this.showDetailsDialog = true
    },
  },
}
</script>
