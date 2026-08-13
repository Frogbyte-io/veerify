<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <!-- Loading State -->
      <div v-if="isLoading" class="space-y-6">
        <div class="flex items-center gap-3">
          <Skeleton class="h-5 w-5" />
          <Skeleton class="h-8 w-48" />
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div class="lg:col-span-1">
            <Skeleton class="h-48 w-full rounded-lg" />
          </div>
          <div class="lg:col-span-3">
            <Skeleton class="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="rounded-lg border bg-card p-8 text-center">
        <Icon name="lucide:alert-circle" class="w-12 h-12 mx-auto text-destructive mb-4" />
        <p class="text-lg font-medium mb-2">Failed to load project</p>
        <p class="text-muted-foreground mb-4">{{ error }}</p>
        <div class="flex items-center justify-center gap-3">
          <Button variant="outline" @click="$router.push('/products')">
            <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
            Back to Products
          </Button>
          <Button variant="outline" @click="loadProject">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>

      <!-- Project Settings -->
      <template v-else-if="projectData">
        <div class="mb-6">
          <div class="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <NuxtLink to="/products" prefetch-on="interaction" class="hover:text-foreground transition-colors"
              >Products</NuxtLink
            >
            <Icon name="lucide:chevron-right" class="w-4 h-4" />
            <span class="text-foreground">{{ projectData.name }}</span>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-3xl font-bold">{{ projectData.name }}</h1>
              <p class="text-muted-foreground">Manage your product settings and configuration</p>
            </div>
            <div class="flex items-center gap-2">
              <Button v-if="publicBoardUrl" variant="outline" size="sm" as="a" :href="publicBoardUrl" target="_blank">
                <Icon name="lucide:external-link" class="w-4 h-4 mr-1.5" />
                Preview Board
              </Button>
              <span
                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                :class="
                  projectData.isPublic
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                "
              >
                {{ projectData.isPublic ? 'Public' : 'Private' }}
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <!-- Settings Navigation -->
          <div class="lg:col-span-1">
            <nav class="bg-card rounded-lg border p-4">
              <ul class="space-y-2">
                <li v-for="tab in tabs" :key="tab.id">
                  <button
                    :data-testid="`product-settings-tab-${tab.id}`"
                    :class="[
                      'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                      activeTab === tab.id
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent/50',
                    ]"
                    @mouseenter="prefetchTab(tab.id)"
                    @focus="prefetchTab(tab.id)"
                    @click="setActiveTab(tab.id)"
                  >
                    <Icon :name="tab.icon" class="w-4 h-4 mr-2" />
                    {{ tab.label }}
                  </button>
                </li>
              </ul>
            </nav>
          </div>

          <!-- Settings Content -->
          <div class="lg:col-span-3">
            <KeepAlive>
              <component
                :is="currentComponent"
                v-bind="currentComponentProps"
                @updated="onProjectUpdated"
                @deleted="onProjectDeleted"
                @categories-updated="onCategoriesUpdated"
                @statuses-updated="onStatusesUpdated"
                @feedback-default-updated="onFeedbackDefaultUpdated"
                @feedback-default-invalidated="invalidateFeedbackDefault"
                @feedback-default-status-replaced="onFeedbackDefaultStatusReplaced"
                @github-integration-updated="onGithubIntegrationUpdated"
                @github-repos-invalidated="invalidateGithubRepos"
              />
            </KeepAlive>
          </div>
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import ProductSettingsGeneral from '~/components/products/ProductSettingsGeneral.vue'
import ProductSettingsFeatures from '~/components/products/ProductSettingsFeatures.vue'
import ProductSettingsCategories from '~/components/products/ProductSettingsCategories.vue'
import ProductSettingsStatuses from '~/components/products/ProductSettingsStatuses.vue'
import ProductSettingsAppearance from '~/components/products/ProductSettingsAppearance.vue'
import ProductSettingsGithub from '~/components/products/ProductSettingsGithub.vue'
import ProductSettingsImport from '~/components/products/ProductSettingsImport.vue'
import ProductSettingsChangelog from '~/components/products/ProductSettingsChangelog.vue'
import ProductSettingsDomain from '~/components/products/ProductSettingsDomain.vue'
import ProductSettingsEmbed from '~/components/products/ProductSettingsEmbed.vue'
import ProductSettingsDanger from '~/components/products/ProductSettingsDanger.vue'
import ProductSettingsFeedback from '~/components/products/ProductSettingsFeedback.vue'
import { buildPublicBoardUrl } from '~/lib/public-board-url'

const DEFAULT_FEEDBACK_QUERY = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  search: '',
  status: '',
  categoryId: '',
}

function createResourceState(initialData = null, status = 'idle') {
  return {
    data: initialData,
    status,
    error: null,
    promise: null,
    loadedAt: 0,
  }
}

function createTabResources() {
  return {
    categories: createResourceState(),
    statuses: createResourceState(),
    feedbackDefault: createResourceState(),
    githubIntegration: createResourceState(),
    githubRepos: createResourceState(),
    importRuns: createResourceState([]),
    changelogPosts: createResourceState(),
  }
}

export default {
  name: 'ProductSettingsPage',
  components: {
    ProductSettingsGeneral,
    ProductSettingsFeatures,
    ProductSettingsCategories,
    ProductSettingsStatuses,
    ProductSettingsAppearance,
    ProductSettingsGithub,
    ProductSettingsImport,
    ProductSettingsChangelog,
    ProductSettingsDomain,
    ProductSettingsEmbed,
    ProductSettingsDanger,
    ProductSettingsFeedback,
  },
  data() {
    return {
      projectData: null,
      isLoading: true,
      error: null,
      activeTab: 'general',
      tabResources: createTabResources(),
      idleWarmupHandle: null,
    }
  },
  computed: {
    enabledFeatures() {
      const settings = this.projectData?.settings || {}
      return {
        feedbackEnabled: settings.feedbackEnabled !== false,
        roadmapEnabled: settings.roadmapEnabled === true,
        changelogEnabled: settings.changelogEnabled === true,
      }
    },
    tabs() {
      const all = [
        { id: 'general', label: 'General', icon: 'lucide:settings' },
        { id: 'features', label: 'Features', icon: 'lucide:layout-grid' },
        { id: 'feedback', label: 'Feedback', icon: 'lucide:message-square', requiresFeature: 'feedbackEnabled' },
        { id: 'categories', label: 'Categories', icon: 'lucide:tags', requiresFeature: 'feedbackEnabled' },
        { id: 'statuses', label: 'Statuses', icon: 'lucide:circle-dot', requiresFeature: 'feedbackEnabled' },
        { id: 'changelog', label: 'Changelog', icon: 'lucide:newspaper' },
        { id: 'appearance', label: 'Appearance', icon: 'lucide:palette' },
        { id: 'github', label: 'GitHub', icon: 'lucide:github', requiresFeature: 'feedbackEnabled' },
        { id: 'import', label: 'Import', icon: 'lucide:database-zap' },
        { id: 'domain', label: 'Custom Domain', icon: 'lucide:globe' },
        { id: 'embed', label: 'Embed', icon: 'lucide:code-2' },
        { id: 'danger', label: 'Danger Zone', icon: 'lucide:alert-triangle' },
      ]
      return all.filter((tab) => !tab.requiresFeature || this.enabledFeatures[tab.requiresFeature])
    },
    publicBoardUrl() {
      if (!import.meta.client || !this.projectData) return ''
      return buildPublicBoardUrl({
        project: this.projectData,
        appDomain: useRuntimeConfig().public.appDomain || 'localhost',
        protocol: window.location.protocol,
        port: window.location.port,
      })
    },
    currentComponent() {
      const componentMap = {
        general: 'ProductSettingsGeneral',
        features: 'ProductSettingsFeatures',
        feedback: 'ProductSettingsFeedback',
        categories: 'ProductSettingsCategories',
        statuses: 'ProductSettingsStatuses',
        changelog: 'ProductSettingsChangelog',
        appearance: 'ProductSettingsAppearance',
        github: 'ProductSettingsGithub',
        import: 'ProductSettingsImport',
        domain: 'ProductSettingsDomain',
        embed: 'ProductSettingsEmbed',
        danger: 'ProductSettingsDanger',
      }
      return componentMap[this.activeTab] || 'ProductSettingsGeneral'
    },
    currentComponentProps() {
      const baseProps = {
        project: this.projectData,
      }

      switch (this.activeTab) {
        case 'categories':
          return {
            ...baseProps,
            resourceState: this.tabResources.categories,
            ensureLoaded: () => this.ensureCategoriesLoaded(),
            refresh: () => this.refreshCategories(),
          }
        case 'statuses':
          return {
            ...baseProps,
            resourceState: this.tabResources.statuses,
            ensureLoaded: () => this.ensureStatusesLoaded(),
            refresh: () => this.refreshStatuses(),
          }
        case 'feedback':
          return {
            ...baseProps,
            resourceState: this.tabResources.feedbackDefault,
            categories: this.tabResources.categories.data || [],
            statuses: this.tabResources.statuses.data || [],
            ensureLoaded: () => this.ensureDefaultFeedbackLoaded(),
            refresh: () => this.refreshDefaultFeedback(),
          }
        case 'github':
          return {
            ...baseProps,
            integrationResourceState: this.tabResources.githubIntegration,
            reposResourceState: this.tabResources.githubRepos,
            ensureIntegrationLoaded: () => this.ensureGithubIntegrationLoaded(),
            refreshIntegration: () => this.refreshGithubIntegration(),
            ensureReposLoaded: () => this.ensureGithubReposLoaded(),
            refreshRepos: () => this.refreshGithubRepos(),
            isActive: this.activeTab === 'github',
          }
        case 'import':
          return {
            ...baseProps,
            resourceState: this.tabResources.importRuns,
            categories: this.tabResources.categories.data || [],
            statuses: this.tabResources.statuses.data || [],
            ensureLoaded: () => this.ensureImportRunsLoaded(),
            refresh: () => this.refreshImportRuns(),
            ensureCategoriesLoaded: () => this.ensureCategoriesLoaded(),
            ensureStatusesLoaded: () => this.ensureStatusesLoaded(),
            isActive: this.activeTab === 'import',
          }
        case 'changelog':
          return {
            ...baseProps,
            resourceState: this.tabResources.changelogPosts,
            ensureLoaded: () => this.ensureChangelogLoaded(),
            refresh: () => this.refreshChangelog(),
            isActive: this.activeTab === 'changelog',
          }
        default:
          return baseProps
      }
    },
  },
  async mounted() {
    const hash = window.location.hash.replace('#', '')
    if (
      hash &&
      [
        'general',
        'features',
        'feedback',
        'categories',
        'statuses',
        'changelog',
        'appearance',
        'github',
        'import',
        'domain',
        'embed',
        'danger',
      ].includes(hash)
    ) {
      this.activeTab = hash
    }
    await this.loadProject()
  },
  beforeUnmount() {
    this.cancelIdleWarmup()
  },
  methods: {
    normalizeErrorMessage(err, fallbackMessage) {
      return err?.data?.error?.message || err?.statusMessage || fallbackMessage
    },
    buildDefaultFeedbackParams() {
      const params = new URLSearchParams({
        projectId: this.projectData.id,
        page: String(DEFAULT_FEEDBACK_QUERY.page),
        limit: String(DEFAULT_FEEDBACK_QUERY.limit),
        sortBy: DEFAULT_FEEDBACK_QUERY.sortBy,
        sortOrder: DEFAULT_FEEDBACK_QUERY.sortOrder,
      })
      return params
    },
    buildDefaultFeedbackPayload(responseData) {
      return {
        items: Array.isArray(responseData?.items) ? responseData.items : [],
        pagination: responseData?.pagination || {
          page: DEFAULT_FEEDBACK_QUERY.page,
          limit: DEFAULT_FEEDBACK_QUERY.limit,
          total: 0,
          totalPages: 1,
        },
        query: { ...DEFAULT_FEEDBACK_QUERY },
      }
    },
    cloneResourceArray(items) {
      if (!Array.isArray(items)) return []
      return items.map((item) => ({ ...item }))
    },
    setResourceReady(key, data) {
      const resource = this.tabResources[key]
      if (!resource) return data
      resource.data = data
      resource.status = 'ready'
      resource.error = null
      resource.promise = null
      resource.loadedAt = Date.now()
      return data
    },
    invalidateResource(key, options = {}) {
      const resource = this.tabResources[key]
      if (!resource) return
      resource.status = 'idle'
      resource.error = null
      resource.promise = null
      resource.loadedAt = 0
      resource.data = options.preserveData === true ? resource.data : (options.data ?? null)
    },
    async ensureResource(key, loader, options = {}) {
      const resource = this.tabResources[key]
      if (!resource) return null

      if (!options.force && resource.status === 'ready') {
        return resource.data
      }

      if (!options.force && resource.promise) {
        return resource.promise
      }

      resource.status = 'loading'
      resource.error = null

      const promise = Promise.resolve()
        .then(() => loader())
        .then((data) => this.setResourceReady(key, data))
        .catch((err) => {
          resource.status = 'error'
          resource.error = this.normalizeErrorMessage(err, options.fallbackError || 'Failed to load data')
          throw err
        })
        .finally(() => {
          resource.promise = null
        })

      resource.promise = promise
      return promise
    },
    seedProjectResources() {
      if (Array.isArray(this.projectData?.categories)) {
        this.setResourceReady('categories', this.cloneResourceArray(this.projectData.categories))
      }
    },
    async ensureCategoriesLoaded(options = {}) {
      if (
        !options.force &&
        Array.isArray(this.tabResources.categories.data) &&
        this.tabResources.categories.status === 'ready'
      ) {
        return this.tabResources.categories.data
      }

      return this.ensureResource(
        'categories',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/categories`)
          return this.cloneResourceArray(response?.data || [])
        },
        { force: options.force === true, fallbackError: 'Failed to load categories' }
      )
    },
    async refreshCategories() {
      return this.ensureCategoriesLoaded({ force: true })
    },
    async ensureStatusesLoaded(options = {}) {
      return this.ensureResource(
        'statuses',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/statuses`)
          return this.cloneResourceArray(response?.data || [])
        },
        { force: options.force === true, fallbackError: 'Failed to load statuses' }
      )
    },
    async refreshStatuses() {
      return this.ensureStatusesLoaded({ force: true })
    },
    async ensureDefaultFeedbackLoaded(options = {}) {
      return this.ensureResource(
        'feedbackDefault',
        async () => {
          const response = await $fetch(`/api/feedback?${this.buildDefaultFeedbackParams().toString()}`)
          return this.buildDefaultFeedbackPayload(response?.data)
        },
        { force: options.force === true, fallbackError: 'Failed to load feedback' }
      )
    },
    async refreshDefaultFeedback() {
      return this.ensureDefaultFeedbackLoaded({ force: true })
    },
    async ensureGithubIntegrationLoaded(options = {}) {
      return this.ensureResource(
        'githubIntegration',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/github`)
          return response?.data || null
        },
        { force: options.force === true, fallbackError: 'Failed to load GitHub integration settings' }
      )
    },
    async refreshGithubIntegration() {
      return this.ensureGithubIntegrationLoaded({ force: true })
    },
    async ensureGithubReposLoaded(options = {}) {
      return this.ensureResource(
        'githubRepos',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/github/repos`)
          return Array.isArray(response?.data) ? response.data : []
        },
        { force: options.force === true, fallbackError: 'Failed to load repositories from GitHub' }
      )
    },
    async refreshGithubRepos() {
      return this.ensureGithubReposLoaded({ force: true })
    },
    async ensureImportRunsLoaded(options = {}) {
      return this.ensureResource(
        'importRuns',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/imports`)
          return Array.isArray(response?.data) ? response.data : []
        },
        { force: options.force === true, fallbackError: 'Failed to load import history' }
      )
    },
    async refreshImportRuns() {
      return this.ensureImportRunsLoaded({ force: true })
    },
    async ensureChangelogLoaded(options = {}) {
      return this.ensureResource(
        'changelogPosts',
        async () => {
          const response = await $fetch(`/api/projects/${this.projectData.slug}/changelog`)
          return Array.isArray(response?.data) ? response.data : []
        },
        { force: options.force === true, fallbackError: 'Failed to load changelog posts' }
      )
    },
    async refreshChangelog() {
      return this.ensureChangelogLoaded({ force: true })
    },
    cancelIdleWarmup() {
      if (!import.meta.client || !this.idleWarmupHandle) return

      if (this.idleWarmupHandle.type === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.idleWarmupHandle.id)
      }

      if (this.idleWarmupHandle.type === 'timeout') {
        clearTimeout(this.idleWarmupHandle.id)
      }

      this.idleWarmupHandle = null
    },
    scheduleIdleWarmup() {
      if (!import.meta.client || !this.projectData) return

      this.cancelIdleWarmup()

      const runWarmup = () => {
        this.idleWarmupHandle = null
        this.ensureStatusesLoaded().catch(() => {})
        this.ensureDefaultFeedbackLoaded().catch(() => {})
        this.ensureChangelogLoaded().catch(() => {})
        this.ensureGithubIntegrationLoaded().catch(() => {})
      }

      if (typeof window.requestIdleCallback === 'function') {
        this.idleWarmupHandle = {
          type: 'idle',
          id: window.requestIdleCallback(() => runWarmup()),
        }
        return
      }

      this.idleWarmupHandle = {
        type: 'timeout',
        id: window.setTimeout(runWarmup, 0),
      }
    },
    async warmTab(tabId) {
      if (!this.projectData) return null

      switch (tabId) {
        case 'categories':
          return this.ensureCategoriesLoaded()
        case 'statuses':
          return this.ensureStatusesLoaded()
        case 'feedback':
          return Promise.all([
            this.ensureCategoriesLoaded(),
            this.ensureStatusesLoaded(),
            this.ensureDefaultFeedbackLoaded(),
          ])
        case 'github':
          return this.ensureGithubIntegrationLoaded()
        case 'import':
          return Promise.all([
            this.ensureCategoriesLoaded(),
            this.ensureStatusesLoaded(),
            this.ensureImportRunsLoaded(),
          ])
        case 'changelog':
          return this.ensureChangelogLoaded()
        default:
          return null
      }
    },
    prefetchTab(tabId) {
      this.warmTab(tabId).catch(() => {})
    },
    async primeActiveTab() {
      await this.warmTab(this.activeTab).catch(() => null)

      if (this.activeTab !== 'github') return

      const integration = this.tabResources.githubIntegration.data
      const hasOauthCallback = this.$route.query.githubConnected === '1'
      if (integration?.hasAccessToken || hasOauthCallback) {
        await this.ensureGithubReposLoaded().catch(() => null)
      }
    },
    async loadProject() {
      this.cancelIdleWarmup()
      this.isLoading = true
      this.error = null
      this.tabResources = createTabResources()

      try {
        const slug = this.$route.params.slug
        const response = await $fetch(`/api/projects/${slug}`)
        this.projectData = response?.data || null

        if (!this.projectData) {
          this.error = 'Project not found'
          return
        }

        this.seedProjectResources()
        await this.primeActiveTab()
        this.scheduleIdleWarmup()
      } catch (err) {
        console.error('Error loading project:', err)
        this.error = this.normalizeErrorMessage(err, 'Failed to load project')
      } finally {
        this.isLoading = false
      }
    },
    setActiveTab(tab) {
      this.activeTab = tab
      window.history.replaceState(null, '', `#${tab}`)
      this.warmTab(tab).catch(() => {})

      if (tab !== 'github') return

      const integration = this.tabResources.githubIntegration.data
      const hasOauthCallback = this.$route.query.githubConnected === '1'
      if (integration?.hasAccessToken || hasOauthCallback) {
        this.ensureGithubReposLoaded().catch(() => {})
      }
    },
    onProjectUpdated(updatedProject) {
      this.projectData = { ...this.projectData, ...updatedProject }
      if (Array.isArray(this.projectData?.categories)) {
        this.setResourceReady('categories', this.cloneResourceArray(this.projectData.categories))
      }
      // If the active tab is no longer visible after a feature toggle, reset to general
      const visibleTabIds = this.tabs.map((t) => t.id)
      if (!visibleTabIds.includes(this.activeTab)) {
        this.activeTab = 'general'
        window.history.replaceState(null, '', '#general')
      }
    },
    onCategoriesUpdated(categories) {
      const nextCategories = this.cloneResourceArray(categories)
      this.setResourceReady('categories', nextCategories)
      this.projectData = {
        ...this.projectData,
        categories: nextCategories,
      }
    },
    onStatusesUpdated(statuses) {
      this.setResourceReady('statuses', this.cloneResourceArray(statuses))
    },
    onFeedbackDefaultUpdated(payload) {
      this.setResourceReady('feedbackDefault', payload)
    },
    invalidateFeedbackDefault() {
      this.invalidateResource('feedbackDefault')
    },
    onFeedbackDefaultStatusReplaced({ fromValue, toValue }) {
      const resource = this.tabResources.feedbackDefault
      if (!resource?.data?.items || !Array.isArray(resource.data.items)) return

      const nextItems = resource.data.items.map((item) => ({
        ...item,
        status: item.status === fromValue ? toValue : item.status,
      }))

      this.setResourceReady('feedbackDefault', {
        ...resource.data,
        items: nextItems,
      })
    },
    onGithubIntegrationUpdated(integration) {
      this.setResourceReady('githubIntegration', integration)
    },
    invalidateGithubRepos() {
      this.invalidateResource('githubRepos', { data: [] })
    },
    onProjectDeleted() {
      this.$router.push('/products')
    },
  },
}
</script>
