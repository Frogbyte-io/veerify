<template>
  <div class="min-h-screen bg-background relative flex flex-col">
    <!-- Top-right controls: always visible -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
      <button
        v-if="showThemeToggle"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        @click="toggleTheme"
      >
        <Icon :name="currentThemeIcon" class="w-4 h-4" />
        {{ currentThemeLabel }}
      </button>
      <a
        :href="mainAppUrl + '/login?redirect=' + authRedirectTarget"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
      >
        <Icon name="lucide:log-in" class="w-4 h-4" />
        Log in
      </a>
      <a
        :href="mainAppUrl + '/signup?redirect=' + authRedirectTarget"
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Sign up
      </a>
    </div>

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
    <div v-else-if="projectData" class="flex-1 flex flex-col">
      <!-- Banner -->
      <img
        v-if="projectData.project.settings?.bannerUrl"
        :src="projectData.project.settings.bannerUrl"
        data-testid="public-board-banner"
        alt=""
        class="w-full h-48 md:h-64 object-cover"
        @error="$event.target.style.display = 'none'"
      />

      <div class="max-w-4xl mx-auto px-4 py-8">
        <!-- Header -->
        <div class="mb-8">
          <div class="flex items-center gap-3 mb-2">
            <img
              v-if="projectData.project.settings?.logoUrl"
              :src="projectData.project.settings.logoUrl"
              data-testid="public-board-logo"
              alt="Project logo"
              class="h-10 w-10 rounded object-cover border bg-muted"
              @error="$event.target.style.display = 'none'"
            />
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{{ projectData.team.name }}</span>
            </div>
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

            <select
              v-model="filters.categoryId"
              class="px-3 py-2 rounded-md border bg-background text-sm"
              @change="loadFeedback"
            >
              <option value="">All Categories</option>
              <option v-for="cat in projectData.categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
            </select>

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
            class="rounded-lg border bg-card hover:shadow-sm transition-shadow cursor-pointer"
            :class="item.isOwn ? 'ring-2 ring-primary/30' : ''"
            :data-testid="`public-feedback-item-${item.id}`"
            role="button"
            tabindex="0"
            @click="openFeedbackDetails(item)"
            @keydown.enter.prevent="openFeedbackDetails(item)"
            @keydown.space.prevent="openFeedbackDetails(item)"
          >
            <div class="flex items-start gap-4 p-4">
              <div class="flex flex-col items-center min-w-[48px]">
                <button
                  class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors"
                  @click.stop="handleVote(item)"
                >
                  <Icon
                    name="lucide:chevron-up"
                    class="w-5 h-5"
                    :class="item.hasVoted ? 'text-primary' : 'text-muted-foreground'"
                  />
                  <span class="text-sm font-semibold">{{ item.voteCount }}</span>
                </button>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                  <h3 class="font-medium">{{ item.title }}</h3>
                  <div class="flex items-center gap-2 shrink-0">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      :class="
                        statusClasses[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      "
                    >
                      {{ formatStatus(item.status) }}
                    </span>
                    <span
                      v-if="item.category"
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      :style="{ backgroundColor: item.category.color + '20', color: item.category.color }"
                    >
                      <span
                        v-if="item.category.icon"
                        :data-testid="`public-feedback-category-icon-${item.id}`"
                        class="mr-1"
                      >
                        {{ item.category.icon }}
                      </span>
                      {{ item.category.name }}
                    </span>
                  </div>
                </div>
                <p v-if="item.body" class="text-sm text-muted-foreground line-clamp-2 mb-2">
                  {{ item.body }}
                </p>
                <div class="flex items-center gap-4 text-xs text-muted-foreground">
                  <span v-if="item.isOwn" class="text-primary font-medium">
                    <Icon name="lucide:star" class="w-3 h-3 inline" />
                    Your submission
                  </span>
                  <span v-else-if="item.authorName">
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
                  <span class="ml-auto text-primary">View details</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="pagination.totalPages > 1" class="flex items-center justify-between pt-4">
            <p class="text-sm text-muted-foreground">
              Page {{ pagination.page }} of {{ pagination.totalPages }} ({{ pagination.total }} total)
            </p>
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="pagination.page <= 1"
                @click="changePage(pagination.page - 1)"
                >Previous</Button
              >
              <Button
                variant="outline"
                size="sm"
                :disabled="pagination.page >= pagination.totalPages"
                @click="changePage(pagination.page + 1)"
                >Next</Button
              >
            </div>
          </div>
        </div>

        <!-- Submit Feedback Dialog -->
        <Dialog :open="showSubmitDialog" @update:open="showSubmitDialog = $event">
          <DialogContent class="sm:max-w-[500px]">
            <DialogHeader>
              <h2 class="text-lg font-semibold">Submit Feedback</h2>
              <p class="text-sm text-muted-foreground">Share your ideas, report bugs, or suggest improvements.</p>
            </DialogHeader>
            <div class="space-y-4 py-4">
              <div class="space-y-2">
                <Label for="fb-title">Title</Label>
                <Input id="fb-title" v-model="submitForm.title" placeholder="Brief summary of your feedback" />
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
                  <option v-for="cat in projectData.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                </select>
              </div>
              <div class="space-y-2">
                <Label for="fb-name">Your Name</Label>
                <Input id="fb-name" v-model="submitForm.authorName" placeholder="John Doe" />
              </div>
              <div class="space-y-2">
                <Label for="fb-email">Email (optional)</Label>
                <Input id="fb-email" v-model="submitForm.authorEmail" type="email" placeholder="you@example.com" />
                <p class="text-xs text-muted-foreground">
                  Provide your email to receive updates on comments and status changes.
                </p>
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

        <Dialog :open="showDetailsDialog" @update:open="handleDetailsDialogChange">
          <DialogContent class="sm:max-w-[640px]">
            <DialogHeader>
              <h2 class="text-lg font-semibold">Feedback details</h2>
              <p class="text-sm text-muted-foreground">Review the full request and discussion in one place.</p>
            </DialogHeader>

            <div v-if="detailsLoading" class="space-y-3 py-2">
              <Skeleton class="h-7 w-3/4" />
              <Skeleton class="h-20 w-full" />
              <Skeleton class="h-5 w-1/2" />
              <Skeleton class="h-16 w-full" />
            </div>

            <div v-else-if="detailsError" class="rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <p class="text-sm text-destructive">{{ detailsError }}</p>
              <Button class="mt-3" size="sm" variant="outline" @click="retryLoadDetails">Retry</Button>
            </div>

            <div v-else-if="selectedFeedback" class="space-y-4 py-2">
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-lg font-semibold">{{ selectedFeedback.title }}</h3>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="
                      statusClasses[selectedFeedback.status] ||
                      'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                    "
                  >
                    {{ formatStatus(selectedFeedback.status) }}
                  </span>
                  <span
                    v-if="selectedFeedback.category"
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :style="{
                      backgroundColor: selectedFeedback.category.color + '20',
                      color: selectedFeedback.category.color,
                    }"
                  >
                    <span v-if="selectedFeedback.category.icon" class="mr-1">{{ selectedFeedback.category.icon }}</span>
                    {{ selectedFeedback.category.name }}
                  </span>
                </div>
                <p class="text-sm text-muted-foreground whitespace-pre-line">
                  {{ selectedFeedback.body || 'No description provided.' }}
                </p>
                <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    <Icon name="lucide:thumbs-up" class="w-3 h-3 inline" />
                    {{ selectedFeedback.voteCount || 0 }} votes
                  </span>
                  <span>
                    <Icon name="lucide:calendar" class="w-3 h-3 inline" />
                    {{ formatDate(selectedFeedback.createdAt) }}
                  </span>
                  <span>
                    <Icon name="lucide:message-circle" class="w-3 h-3 inline" />
                    {{ selectedFeedbackComments.length }} comments
                  </span>
                </div>
              </div>

              <div class="space-y-2">
                <h4 class="text-sm font-medium">Comments</h4>
                <div v-if="selectedFeedbackComments.length === 0" class="rounded-md border bg-muted/40 p-3 text-sm">
                  No comments yet.
                </div>
                <div v-else class="space-y-2 max-h-60 overflow-y-auto pr-1">
                  <div v-for="comment in selectedFeedbackComments" :key="comment.id" class="rounded-md border p-3">
                    <p class="text-sm whitespace-pre-line">{{ comment.body }}</p>
                    <div class="mt-2 text-xs text-muted-foreground flex items-center gap-2">
                      <span>{{ formatCommentAuthor(comment) }}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{{ formatDate(comment.createdAt) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" @click="showDetailsDialog = false">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <!-- Footer -->
      <div class="mt-auto py-3 text-center text-xs text-muted-foreground space-y-1">
        <div v-if="showCustomFooter" data-testid="public-footer-custom" class="space-y-1">
          <p v-if="customFooterBranding" class="text-xs font-medium text-foreground">
            {{ customFooterBranding }}
          </p>
          <p v-if="customFooterText" class="text-xs text-muted-foreground">
            {{ customFooterText }}
          </p>
          <div
            v-if="customFooterLinks.length > 0"
            class="flex items-center justify-center gap-3 text-xs text-muted-foreground"
          >
            <a
              v-for="(link, index) in customFooterLinks"
              :key="`${link.label}-${link.url}`"
              :data-testid="`public-footer-custom-link-${index}`"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              {{ link.label }}
            </a>
          </div>
        </div>
        <template v-else>
          <div v-if="projectData?.project?.settings?.showPoweredBy !== false" data-testid="public-footer-powered-by">
            Powered by
            <a href="https://veerify.io" target="_blank" rel="noopener noreferrer" class="hover:underline">Veerify</a>
          </div>
          <div v-if="projectData?.project?.settings?.showGithubFooter !== false" data-testid="public-footer-github">
            Open source &amp; contributions welcome &mdash;
            <a
              href="https://github.com/Frogbyte-io/veerify"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline inline-flex items-center gap-1"
            >
              <Icon name="lucide:github" class="h-3 w-3" />GitHub
            </a>
            &middot;
            <a
              href="https://github.com/Frogbyte-io/veerify/issues"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
              >report an issue</a
            >
            &middot;
            <a
              data-testid="public-footer-veerify-board"
              href="https://feedback.veerify.io"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              Veerify feedback board
            </a>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'PublicFeedbackBoard',
  props: {
    teamSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
  },
  data() {
    return {
      projectData: null,
      feedbackItems: [],
      isLoading: true,
      error: null,
      feedbackLoading: false,
      showSubmitDialog: false,
      showDetailsDialog: false,
      isSubmitting: false,
      detailsLoading: false,
      detailsError: null,
      selectedFeedbackId: null,
      selectedFeedback: null,
      selectedFeedbackComments: [],
      filters: { status: '', categoryId: '', sortBy: 'voteCount' },
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      submitForm: { title: '', body: '', categoryId: '', authorName: '', authorEmail: '' },
      previousColorMode: null,
      activeTheme: 'system',
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
  computed: {
    mainAppUrl() {
      if (!import.meta.client) return ''
      const config = useRuntimeConfig()
      const dashboardDomain = config.public.dashboardDomain || config.public.appDomain || 'localhost'
      const protocol = window.location.protocol
      const port = dashboardDomain === 'localhost' ? ':' + window.location.port : ''
      return `${protocol}//${dashboardDomain}${port}`
    },
    currentThemeIcon() {
      if (this.activeTheme === 'dark') return 'lucide:moon'
      if (this.activeTheme === 'light') return 'lucide:sun'
      return 'lucide:monitor'
    },
    currentThemeLabel() {
      if (this.activeTheme === 'dark') return 'Dark'
      if (this.activeTheme === 'light') return 'Light'
      return 'System'
    },
    showThemeToggle() {
      const forced = this.projectData?.project?.settings?.themeMode
      return !forced || forced === 'system'
    },
    authRedirectTarget() {
      if (!import.meta.client) return encodeURIComponent(`/${this.projectSlug}`)
      return encodeURIComponent(window.location.href)
    },
    customFooterBranding() {
      return this.projectData?.project?.settings?.customFooterBranding?.trim() || ''
    },
    customFooterText() {
      return this.projectData?.project?.settings?.customFooterText?.trim() || ''
    },
    customFooterLinks() {
      const settings = this.projectData?.project?.settings || {}
      const links = [
        {
          label: settings.customFooterPrimaryLabel?.trim(),
          url: settings.customFooterPrimaryUrl?.trim(),
        },
        {
          label: settings.customFooterSecondaryLabel?.trim(),
          url: settings.customFooterSecondaryUrl?.trim(),
        },
      ]
      return links.filter((link) => link.label && link.url)
    },
    showCustomFooter() {
      return (
        this.projectData?.project?.settings?.customFooterEnabled === true &&
        (this.customFooterBranding || this.customFooterText || this.customFooterLinks.length > 0)
      )
    },
  },
  beforeUnmount() {
    if (import.meta.client && this.previousColorMode) {
      this.$colorMode.preference = this.previousColorMode
    }
  },
  async mounted() {
    if (import.meta.client) {
      this.previousColorMode = this.$colorMode.preference
    }
    try {
      const response = await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}`)
      this.projectData = response?.data
      this.applyTheme(this.projectData?.project?.settings?.themeMode || 'system')
      await this.loadFeedback()
    } catch (err) {
      console.error('Error loading project:', err)
      this.error = 'This feedback page could not be found.'
    } finally {
      this.isLoading = false
    }
  },
  methods: {
    applyTheme(mode) {
      this.activeTheme = mode
      if (import.meta.client) {
        this.$colorMode.preference = mode
      }
    },
    toggleTheme() {
      const cycle = { system: 'light', light: 'dark', dark: 'system' }
      this.applyTheme(cycle[this.activeTheme] || 'system')
    },
    async loadFeedback() {
      if (!this.projectData) return
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
          `/api/public/t/${this.teamSlug}/${this.projectSlug}/feedback?${params.toString()}`
        )
        const data = response?.data
        this.feedbackItems = this.mergeWithLocalVotes(data?.items || [])
        this.pagination = data?.pagination || this.pagination
      } catch (err) {
        console.error('Error loading feedback:', err)
      } finally {
        this.feedbackLoading = false
      }
    },
    async submitFeedback() {
      if (!this.submitForm.title || !this.submitForm.body || !this.submitForm.authorName) return
      this.isSubmitting = true
      try {
        await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}/feedback`, {
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
        this.pagination.page = 1
        this.filters.sortBy = 'createdAt'
        await this.loadFeedback()
        const projectResponse = await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}`)
        this.projectData = projectResponse?.data
      } catch (err) {
        console.error('Error submitting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to submit feedback. Please try again.')
      } finally {
        this.isSubmitting = false
      }
    },
    async openFeedbackDetails(item) {
      if (!item?.id) return
      this.showDetailsDialog = true
      this.selectedFeedbackId = item.id
      await this.loadFeedbackDetails(item.id)
    },
    handleDetailsDialogChange(isOpen) {
      this.showDetailsDialog = isOpen
      if (!isOpen) {
        this.detailsError = null
      }
    },
    async retryLoadDetails() {
      if (!this.selectedFeedbackId) return
      await this.loadFeedbackDetails(this.selectedFeedbackId)
    },
    async loadFeedbackDetails(feedbackId) {
      this.detailsLoading = true
      this.detailsError = null
      try {
        const [feedbackResponse, commentsResponse] = await Promise.all([
          $fetch(`/api/feedback/${feedbackId}`),
          $fetch(`/api/feedback/${feedbackId}/comments`),
        ])
        this.selectedFeedback = feedbackResponse?.data || null
        this.selectedFeedbackComments = Array.isArray(commentsResponse?.data) ? commentsResponse.data : []
      } catch (err) {
        console.error('Error loading feedback details:', err)
        this.detailsError = err?.data?.error?.message || 'Failed to load feedback details'
        this.selectedFeedback = null
        this.selectedFeedbackComments = []
      } finally {
        this.detailsLoading = false
      }
    },
    async handleVote(item) {
      // Optimistic update for instant feedback
      const wasVoted = item.hasVoted
      item.hasVoted = !wasVoted
      item.voteCount += wasVoted ? -1 : 1
      try {
        const response = await $fetch(`/api/feedback/${item.id}/vote`, { method: 'POST' })
        const data = response?.data
        item.voteCount = data.voteCount
        item.hasVoted = data.voted
        this.saveLocalVote(item.id, data.voted)
      } catch (err) {
        // Revert optimistic update
        item.hasVoted = wasVoted
        item.voteCount += wasVoted ? 1 : -1
        console.error('Error voting:', err)
        alert('Failed to vote. Please try again.')
      }
    },
    getLocalVotedIds() {
      if (!import.meta.client) return new Set()
      try {
        const data = JSON.parse(localStorage.getItem('veerify_votes') || '[]')
        return new Set(Array.isArray(data) ? data : [])
      } catch {
        return new Set()
      }
    },
    saveLocalVote(feedbackId, voted) {
      if (!import.meta.client) return
      try {
        const votes = this.getLocalVotedIds()
        if (voted) {
          votes.add(feedbackId)
        } else {
          votes.delete(feedbackId)
        }
        localStorage.setItem('veerify_votes', JSON.stringify([...votes]))
      } catch {
        // localStorage might be unavailable (e.g. private browsing with storage blocked)
      }
    },
    mergeWithLocalVotes(items) {
      if (!import.meta.client) return items
      try {
        const localVotes = this.getLocalVotedIds()
        // Sync localStorage with any server-confirmed votes
        items.forEach((item) => {
          if (item.hasVoted) localVotes.add(item.id)
        })
        localStorage.setItem('veerify_votes', JSON.stringify([...localVotes]))
        // Apply localStorage state — if local says voted and server doesn't (e.g. cookie cleared), show as voted
        return items.map((item) => ({
          ...item,
          hasVoted: item.hasVoted || localVotes.has(item.id),
        }))
      } catch {
        return items
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
    formatCommentAuthor(comment) {
      return comment?.author?.name || comment?.authorName || 'Anonymous'
    },
  },
}
</script>
