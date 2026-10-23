<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="marketing-launch-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Launch kit</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            A checklist of places to launch and list your product, with your progress on each.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />
          <Button v-if="showContent" data-testid="launch-add" @click="addOpen = true">
            <Icon name="lucide:plus" class="mr-2 h-4 w-4" />
            Add custom directory
          </Button>
        </div>
      </div>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        The project could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!project" class="text-sm text-muted-foreground">Create a project to use the launch kit.</div>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <div v-else-if="isLoading" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton v-for="n in 6" :key="n" class="h-56 w-full" />
        </div>
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <template v-else-if="kit">
        <div class="rounded-lg border border-border bg-card p-4 text-sm" data-testid="launch-intro">
          <h2 class="font-medium">How to use this checklist</h2>
          <ol class="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Ship a good page first: a clear site, a pricing page and a few screenshots.</li>
            <li>
              Use your
              <NuxtLink to="/marketing/announcements" class="underline">changelog</NuxtLink>
              and
              <NuxtLink to="/marketing/reviews" class="underline">testimonials</NuxtLink>
              as social proof in each listing.
            </li>
            <li>
              Follow each community's rules on self-promotion. Pick a few places that fit your audience instead of
              posting everywhere.
            </li>
          </ol>
        </div>

        <MarketingLaunchProgress :progress="kit.progress" />

        <div class="space-y-2" data-testid="launch-filters">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium uppercase text-muted-foreground">Category</span>
            <Button
              v-for="option in categoryOptions"
              :key="option.value"
              size="sm"
              :variant="categoryFilter === option.value ? 'default' : 'outline'"
              :aria-pressed="categoryFilter === option.value"
              :data-testid="`launch-filter-category-${option.value}`"
              @click="categoryFilter = option.value"
            >
              {{ option.label }}
            </Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium uppercase text-muted-foreground">Status</span>
            <Button
              v-for="option in statusOptions"
              :key="option.value"
              size="sm"
              :variant="statusFilter === option.value ? 'default' : 'outline'"
              :aria-pressed="statusFilter === option.value"
              :data-testid="`launch-filter-status-${option.value}`"
              @click="statusFilter = option.value"
            >
              {{ option.label }}
            </Button>
          </div>
        </div>

        <p v-if="refreshError" class="flex items-center gap-2 text-sm text-destructive">
          <span>{{ refreshError }}</span>
          <Button variant="outline" size="sm" @click="refresh">Retry</Button>
        </p>

        <div v-if="!visible.length" class="text-sm text-muted-foreground" data-testid="launch-empty">
          No directories match these filters.
        </div>
        <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MarketingLaunchDirectory
            v-for="item in visible"
            :key="item.id"
            :item="item"
            :project-id="project.id"
            @changed="refresh"
            @forbidden="onForbidden"
          />
        </div>

        <MarketingLaunchAddDialog
          v-model:open="addOpen"
          :project-id="project.id"
          @added="refresh"
          @forbidden="onForbidden"
        />
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { LAUNCH_CATEGORIES, LAUNCH_STATUSES } from '~/lib/marketing-launch'

export default {
  name: 'MarketingLaunchPage',

  created() {
    useHead({ title: 'Launch kit · Marketing' })
  },

  data() {
    return {
      project: null,
      pickerSettled: false,
      pickerError: false,
      isLoading: false,
      error: null,
      refreshError: null,
      marketingOff: false,
      disabledMessage: '',
      kit: null,
      categoryFilter: 'all',
      statusFilter: 'all',
      addOpen: false,
      loadToken: 0,
    }
  },

  computed: {
    showContent() {
      return this.pickerSettled && Boolean(this.project) && !this.marketingOff && !this.isLoading && !this.error
    },
    categoryOptions() {
      return [{ value: 'all', label: 'All' }, ...LAUNCH_CATEGORIES]
    },
    statusOptions() {
      return [{ value: 'all', label: 'All' }, ...LAUNCH_STATUSES]
    },
    items() {
      return this.kit ? [...this.kit.directories, ...this.kit.custom] : []
    },
    visible() {
      return this.items.filter((item) => {
        const category = item.custom ? 'custom' : item.category
        if (this.categoryFilter !== 'all' && category !== this.categoryFilter) return false
        return this.statusFilter === 'all' || item.status === this.statusFilter
      })
    },
  },

  methods: {
    url(projectId = this.project.id) {
      return `/api/marketing/projects/${projectId}/launch-kit`
    },

    onPickerError() {
      this.project = null
      this.kit = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProjectChange(project) {
      this.project = project
      this.pickerSettled = true
      this.pickerError = false
      this.isLoading = false
      this.error = null
      this.refreshError = null
      this.marketingOff = false
      this.kit = null
      this.addOpen = false
      if (project) await this.load()
    },

    onForbidden(message) {
      this.marketingOff = true
      this.disabledMessage = message || ''
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      this.isLoading = true
      this.error = null
      this.refreshError = null
      this.marketingOff = false
      try {
        const response = await $fetch(this.url(projectId))
        if (this.project?.id !== projectId) return
        this.kit = response.data
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.onForbidden(apiErrorMessage(err, ''))
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the launch kit')
        }
      } finally {
        if (this.project?.id === projectId) this.isLoading = false
      }
    },

    /** Reload after a change without swapping the cards for skeletons. */
    async refresh() {
      if (!this.project) return
      const projectId = this.project.id
      const token = ++this.loadToken
      this.refreshError = null
      try {
        const response = await $fetch(this.url(projectId))
        if (this.project?.id !== projectId || token !== this.loadToken) return
        this.kit = response.data
      } catch (err) {
        if (this.project?.id !== projectId || token !== this.loadToken) return
        if (apiErrorStatus(err) === 403) this.onForbidden(apiErrorMessage(err, ''))
        else this.refreshError = apiErrorMessage(err, 'Could not refresh the launch kit')
      }
    },
  },
}
</script>
