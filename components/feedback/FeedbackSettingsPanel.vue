<template>
  <div class="space-y-6" data-testid="feedback-settings">
    <div v-if="isLoading" class="space-y-4" data-testid="feedback-settings-loading">
      <Skeleton class="h-9 w-80" />
      <Skeleton class="h-64 w-full" />
    </div>

    <Card v-else-if="error" data-testid="feedback-settings-error">
      <CardContent class="py-8 text-center">
        <Icon name="lucide:alert-circle" class="mx-auto mb-3 h-8 w-8 text-destructive" />
        <p class="mb-2 font-medium">Failed to load feedback settings</p>
        <p class="mb-4 text-sm text-muted-foreground">{{ error }}</p>
        <Button variant="outline" @click="loadProject">
          <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <template v-else-if="projectData">
      <div class="flex flex-wrap gap-1 border-b" role="tablist" aria-label="Feedback settings">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          role="tab"
          :aria-selected="activeSection === section.id"
          :data-testid="`feedback-settings-tab-${section.id}`"
          :class="
            cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              activeSection === section.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )
          "
          @click="setSection(section.id)"
          @pointerenter="prefetchSection(section.id)"
        >
          <Icon :name="section.icon" class="h-4 w-4" />
          {{ section.label }}
        </button>
      </div>

      <p
        v-if="!isAdmin && section.adminOnly"
        class="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="feedback-settings-lock"
      >
        <Icon name="lucide:lock" class="h-4 w-4" />
        Project admins can change this.
      </p>

      <fieldset
        :disabled="!isAdmin && section.adminOnly"
        :class="cn('min-w-0', !isAdmin && section.adminOnly ? 'pointer-events-none select-none opacity-70' : '')"
      >
        <KeepAlive>
          <component
            :is="section.component"
            v-bind="sectionProps"
            @categories-updated="onCategoriesUpdated"
            @statuses-updated="onStatusesUpdated"
            @feedback-default-updated="onFeedbackDefaultUpdated"
            @feedback-default-invalidated="invalidateFeedbackDefault"
            @feedback-default-status-replaced="onFeedbackDefaultStatusReplaced"
            @github-integration-updated="onGithubIntegrationUpdated"
            @github-repos-invalidated="invalidateGithubRepos"
          />
        </KeepAlive>
      </fieldset>
    </template>
  </div>
</template>

<script>
import { cn } from '~/lib/utils'
import FeedbackSettingsDefaults from '~/components/feedback/settings/FeedbackSettingsDefaults.vue'
import FeedbackSettingsCategories from '~/components/feedback/settings/FeedbackSettingsCategories.vue'
import FeedbackSettingsStatuses from '~/components/feedback/settings/FeedbackSettingsStatuses.vue'
import FeedbackSettingsGithub from '~/components/feedback/settings/FeedbackSettingsGithub.vue'
import FeedbackSettingsAppKeys from '~/components/feedback/settings/FeedbackSettingsAppKeys.vue'
import { apiErrorMessage } from '~/lib/api-error'

const DEFAULT_FEEDBACK_QUERY = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  search: '',
  status: '',
  categoryId: '',
}

const SECTIONS = [
  {
    id: 'defaults',
    label: 'Manage',
    icon: 'lucide:message-square',
    component: 'FeedbackSettingsDefaults',
    adminOnly: false,
  },
  {
    id: 'categories',
    label: 'Categories',
    icon: 'lucide:tags',
    component: 'FeedbackSettingsCategories',
    adminOnly: true,
  },
  {
    id: 'statuses',
    label: 'Statuses',
    icon: 'lucide:circle-dot',
    component: 'FeedbackSettingsStatuses',
    adminOnly: true,
  },
  { id: 'github', label: 'GitHub', icon: 'lucide:github', component: 'FeedbackSettingsGithub', adminOnly: true },
  // Key management endpoints are project-admin only, so members do not see this tab at all.
  {
    id: 'app-keys',
    label: 'App keys',
    icon: 'lucide:key-round',
    component: 'FeedbackSettingsAppKeys',
    adminOnly: true,
    hiddenForMembers: true,
  },
]

function createResourceState(initialData = null, status = 'idle') {
  return { data: initialData, status, error: null, promise: null, loadedAt: 0 }
}

function createResources() {
  return {
    categories: createResourceState(),
    statuses: createResourceState(),
    feedbackDefault: createResourceState(),
    githubIntegration: createResourceState(),
    githubRepos: createResourceState(),
  }
}

/**
 * Feedback tool settings for the active project: manage list, categories,
 * statuses, the GitHub integration and app keys (admins). The section lives in `?section=` so it
 * can be linked. Members see the admin-only sections read-only with a lock line.
 */
export default {
  name: 'FeedbackSettingsPanel',
  // Registered locally so `<component :is>` can resolve each section by name.
  components: {
    FeedbackSettingsDefaults,
    FeedbackSettingsCategories,
    FeedbackSettingsStatuses,
    FeedbackSettingsGithub,
    FeedbackSettingsAppKeys,
  },

  props: {
    // Slug of the active project (settings endpoints are /api/projects/[slug]/...)
    projectSlug: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
  },

  data() {
    return {
      isLoading: true,
      error: null,
      projectData: null,
      resources: createResources(),
    }
  },

  computed: {
    sections() {
      return SECTIONS.filter((s) => this.isAdmin || !s.hiddenForMembers)
    },
    activeSection() {
      const wanted = String(this.$route.query.section || '')
      return this.sections.some((s) => s.id === wanted) ? wanted : 'defaults'
    },
    section() {
      return this.sections.find((s) => s.id === this.activeSection)
    },
    sectionProps() {
      const base = { project: this.projectData }
      switch (this.activeSection) {
        case 'categories':
          return {
            ...base,
            resourceState: this.resources.categories,
            ensureLoaded: () => this.ensureCategoriesLoaded(),
            refresh: () => this.ensureCategoriesLoaded({ force: true }),
          }
        case 'statuses':
          return {
            ...base,
            resourceState: this.resources.statuses,
            ensureLoaded: () => this.ensureStatusesLoaded(),
            refresh: () => this.ensureStatusesLoaded({ force: true }),
          }
        case 'app-keys':
          return base
        case 'github':
          return {
            ...base,
            integrationResourceState: this.resources.githubIntegration,
            reposResourceState: this.resources.githubRepos,
            ensureIntegrationLoaded: () => this.ensureGithubIntegrationLoaded(),
            refreshIntegration: () => this.ensureGithubIntegrationLoaded({ force: true }),
            ensureReposLoaded: () => this.ensureGithubReposLoaded(),
            refreshRepos: () => this.ensureGithubReposLoaded({ force: true }),
            isActive: true,
          }
        default:
          return {
            ...base,
            resourceState: this.resources.feedbackDefault,
            categories: this.resources.categories.data || [],
            statuses: this.resources.statuses.data || [],
            ensureLoaded: () => this.ensureDefaultFeedbackLoaded(),
            refresh: () => this.ensureDefaultFeedbackLoaded({ force: true }),
          }
      }
    },
  },

  watch: {
    projectSlug() {
      this.loadProject()
    },
  },

  async mounted() {
    await this.loadProject()
  },

  methods: {
    cn,

    setSection(id) {
      this.$router.replace({ query: { ...this.$route.query, section: id } })
      this.prefetchSection(id)
    },

    prefetchSection(id) {
      this.warmSection(id).catch(() => {})
    },

    async warmSection(id) {
      if (!this.projectData) return null
      switch (id) {
        case 'categories':
          return this.ensureCategoriesLoaded()
        case 'statuses':
          return this.ensureStatusesLoaded()
        case 'app-keys':
          return null
        case 'github':
          return this.ensureGithubIntegrationLoaded()
        default:
          return Promise.all([
            this.ensureCategoriesLoaded(),
            this.ensureStatusesLoaded(),
            this.ensureDefaultFeedbackLoaded(),
          ])
      }
    },

    cloneArray(items) {
      return Array.isArray(items) ? items.map((item) => ({ ...item })) : []
    },

    setResourceReady(key, data) {
      const resource = this.resources[key]
      resource.data = data
      resource.status = 'ready'
      resource.error = null
      resource.promise = null
      resource.loadedAt = Date.now()
      return data
    },

    invalidateResource(key, data = null) {
      const resource = this.resources[key]
      resource.status = 'idle'
      resource.error = null
      resource.promise = null
      resource.loadedAt = 0
      resource.data = data
    },

    async ensureResource(key, loader, options = {}) {
      const resource = this.resources[key]
      if (!options.force && resource.status === 'ready') return resource.data
      if (!options.force && resource.promise) return resource.promise

      resource.status = 'loading'
      resource.error = null
      const promise = Promise.resolve()
        .then(() => loader())
        .then((data) => this.setResourceReady(key, data))
        .catch((err) => {
          resource.status = 'error'
          resource.error = apiErrorMessage(err, options.fallbackError || 'Failed to load data')
          throw err
        })
        .finally(() => {
          resource.promise = null
        })
      resource.promise = promise
      return promise
    },

    ensureCategoriesLoaded(options = {}) {
      return this.ensureResource(
        'categories',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/categories`)
          return this.cloneArray(response?.data)
        },
        { force: options.force === true, fallbackError: 'Failed to load categories' }
      )
    },

    ensureStatusesLoaded(options = {}) {
      return this.ensureResource(
        'statuses',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/statuses`)
          return this.cloneArray(response?.data)
        },
        { force: options.force === true, fallbackError: 'Failed to load statuses' }
      )
    },

    ensureDefaultFeedbackLoaded(options = {}) {
      return this.ensureResource(
        'feedbackDefault',
        async () => {
          const params = new URLSearchParams({
            projectIds: this.projectData.id,
            page: String(DEFAULT_FEEDBACK_QUERY.page),
            limit: String(DEFAULT_FEEDBACK_QUERY.limit),
            sortBy: DEFAULT_FEEDBACK_QUERY.sortBy,
            sortOrder: DEFAULT_FEEDBACK_QUERY.sortOrder,
          })
          const response = await $fetch(`/api/feedback?${params.toString()}`)
          const data = response?.data
          return {
            items: Array.isArray(data?.items) ? data.items : [],
            pagination: data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
            query: { search: '', status: '', categoryId: '' },
          }
        },
        { force: options.force === true, fallbackError: 'Failed to load feedback' }
      )
    },

    ensureGithubIntegrationLoaded(options = {}) {
      return this.ensureResource(
        'githubIntegration',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/github`)
          return response?.data || null
        },
        { force: options.force === true, fallbackError: 'Failed to load GitHub integration settings' }
      )
    },

    ensureGithubReposLoaded(options = {}) {
      return this.ensureResource(
        'githubRepos',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/github/repos`)
          return Array.isArray(response?.data) ? response.data : []
        },
        { force: options.force === true, fallbackError: 'Failed to load repositories from GitHub' }
      )
    },

    async loadProject() {
      this.isLoading = true
      this.error = null
      this.resources = createResources()
      try {
        const response = await $fetch(`/api/projects/${encodeURIComponent(this.projectSlug)}`)
        this.projectData = response?.data || null
        if (!this.projectData) {
          this.error = 'Project not found'
          return
        }
        if (Array.isArray(this.projectData.categories)) {
          this.setResourceReady('categories', this.cloneArray(this.projectData.categories))
        }
        await this.warmSection(this.activeSection).catch(() => null)
        if (
          this.activeSection === 'github' &&
          (this.resources.githubIntegration.data?.hasAccessToken || this.$route.query.githubConnected === '1')
        ) {
          await this.ensureGithubReposLoaded().catch(() => null)
        }
      } catch (err) {
        console.error('Error loading feedback settings:', err)
        this.error = apiErrorMessage(err, 'Failed to load project')
      } finally {
        this.isLoading = false
      }
    },

    onCategoriesUpdated(categories) {
      const next = this.cloneArray(categories)
      this.setResourceReady('categories', next)
      this.projectData = { ...this.projectData, categories: next }
    },

    onStatusesUpdated(statuses) {
      this.setResourceReady('statuses', this.cloneArray(statuses))
    },

    onFeedbackDefaultUpdated(payload) {
      this.setResourceReady('feedbackDefault', payload)
    },

    invalidateFeedbackDefault() {
      this.invalidateResource('feedbackDefault')
    },

    onFeedbackDefaultStatusReplaced({ fromValue, toValue }) {
      const resource = this.resources.feedbackDefault
      if (!Array.isArray(resource?.data?.items)) return
      const items = resource.data.items.map((item) => ({
        ...item,
        status: item.status === fromValue ? toValue : item.status,
      }))
      this.setResourceReady('feedbackDefault', { ...resource.data, items })
    },

    onGithubIntegrationUpdated(integration) {
      this.setResourceReady('githubIntegration', integration)
    },

    invalidateGithubRepos() {
      this.invalidateResource('githubRepos', [])
    },
  },
}
</script>
