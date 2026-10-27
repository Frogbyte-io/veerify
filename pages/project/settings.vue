<template>
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
      <p class="text-lg font-medium mb-2">Failed to load project settings</p>
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <Button variant="outline" @click="load">
        <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
        Retry
      </Button>
    </div>

    <!-- Project Settings -->
    <template v-else-if="projectData">
      <div class="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">Project settings</h1>
          <p class="text-muted-foreground">
            {{ projectData.name }} <span class="text-xs">in {{ organization.name }}</span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button v-if="publicBoardUrl" variant="outline" size="sm" as="a" :href="publicBoardUrl" target="_blank">
            <Icon name="lucide:external-link" class="w-4 h-4 mr-1.5" />
            Preview site
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

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div class="lg:col-span-1">
          <nav class="bg-card rounded-lg border p-4">
            <ul class="space-y-2">
              <li v-for="tab in tabs" :key="tab.id">
                <button
                  :data-testid="`project-settings-tab-${tab.id}`"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === tab.id
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50',
                  ]"
                  @click="setActiveTab(tab.id)"
                >
                  <Icon :name="tab.icon" class="w-4 h-4 mr-2" />
                  {{ tab.label }}
                </button>
              </li>
            </ul>
          </nav>
        </div>

        <div class="lg:col-span-3 min-w-0">
          <p
            v-if="!canAdmin && activeTab !== 'danger'"
            class="mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
            data-testid="project-settings-lock"
          >
            <Icon name="lucide:lock" class="h-4 w-4" />
            Project admins can change this.
          </p>
          <fieldset :disabled="!canAdmin && activeTab !== 'danger'" class="min-w-0 border-0 p-0 m-0">
            <component
              :is="currentComponent"
              v-bind="currentComponentProps"
              @updated="onProjectUpdated"
              @deleted="onProjectDeleted"
              @products-changed="load({ silent: true })"
            />
          </fieldset>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import ProjectSettingsGeneral from '~/components/project/ProjectSettingsGeneral.vue'
import ProjectSettingsProducts from '~/components/project/ProjectSettingsProducts.vue'
import ProjectSettingsAccess from '~/components/project/ProjectSettingsAccess.vue'
import ProjectSettingsTools from '~/components/project/ProjectSettingsTools.vue'
import ProjectSettingsAppearance from '~/components/project/ProjectSettingsAppearance.vue'
import ProjectSettingsDomain from '~/components/project/ProjectSettingsDomain.vue'
import ProjectSettingsEmbed from '~/components/project/ProjectSettingsEmbed.vue'
import ProjectSettingsDanger from '~/components/project/ProjectSettingsDanger.vue'

const TAB_IDS = ['general', 'products', 'access', 'tools', 'appearance', 'domain', 'embed', 'danger']

export default {
  name: 'ProjectSettingsPage',
  // Registered locally so `<component :is>` can resolve the tab by name.
  components: {
    ProjectSettingsGeneral,
    ProjectSettingsProducts,
    ProjectSettingsAccess,
    ProjectSettingsTools,
    ProjectSettingsAppearance,
    ProjectSettingsDomain,
    ProjectSettingsEmbed,
    ProjectSettingsDanger,
  },
  data() {
    return {
      context: null,
      detail: null,
      isLoading: true,
      error: null,
      activeTab: 'general',
    }
  },
  computed: {
    organization() {
      return this.context?.organization || null
    },
    products() {
      return this.context?.products || []
    },
    projectData() {
      if (!this.context) return null
      return {
        ...this.context.project,
        ...(this.detail || {}),
        settings: this.detail?.settings || this.context.project.settings,
        role: this.context.project.role,
        organization: this.organization,
      }
    },
    canAdmin() {
      return this.projectData?.role === 'admin'
    },
    canDelete() {
      return ['owner', 'admin'].includes(this.organization?.role)
    },
    tabs() {
      const all = [
        { id: 'general', label: 'General', icon: 'lucide:settings' },
        { id: 'products', label: 'Products', icon: 'lucide:boxes' },
        { id: 'access', label: 'Members & access', icon: 'lucide:users' },
        { id: 'tools', label: 'Tools', icon: 'lucide:layout-grid' },
        { id: 'appearance', label: 'Appearance', icon: 'lucide:palette' },
        { id: 'domain', label: 'Domain', icon: 'lucide:globe' },
        { id: 'embed', label: 'Embed', icon: 'lucide:code-2' },
        { id: 'danger', label: 'Danger zone', icon: 'lucide:alert-triangle', requiresDelete: true },
      ]
      return all.filter((tab) => !tab.requiresDelete || this.canDelete)
    },
    publicBoardUrl() {
      if (!import.meta.client || !this.projectData || !this.organization || !this.projectData.isPublic) return ''
      return this.buildUrl(this.products.length > 1 ? undefined : this.products[0]?.slug)
    },
    currentComponent() {
      const map = {
        general: 'ProjectSettingsGeneral',
        products: 'ProjectSettingsProducts',
        access: 'ProjectSettingsAccess',
        tools: 'ProjectSettingsTools',
        appearance: 'ProjectSettingsAppearance',
        domain: 'ProjectSettingsDomain',
        embed: 'ProjectSettingsEmbed',
        danger: 'ProjectSettingsDanger',
      }
      return map[this.activeTab] || 'ProjectSettingsGeneral'
    },
    currentComponentProps() {
      const project = this.projectData
      switch (this.activeTab) {
        case 'general':
        case 'embed':
          return { project, organization: this.organization, products: this.products }
        case 'products':
          return { project, products: this.products }
        case 'access':
          return { project, organization: this.organization }
        default:
          return { project }
      }
    },
  },
  created() {
    useHead({
      title: () => (this.projectData?.name ? `${this.projectData.name} · Project settings` : 'Project settings'),
    })
  },
  async mounted() {
    this.readHash()
    window.addEventListener('hashchange', this.readHash)
    window.addEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
    await this.load()
  },
  beforeUnmount() {
    window.removeEventListener('hashchange', this.readHash)
    window.removeEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
  },
  methods: {
    errorMessage(err, fallback) {
      return err?.data?.error?.message || err?.statusMessage || fallback
    },
    buildUrl(productSlug) {
      const project = this.projectData
      const hasActiveDomain = project.customDomain && project.settings?.domainStatus === 'active'
      return buildPublicBoardUrl({
        orgSlug: this.organization.slug,
        projectSlug: project.slug,
        productSlug,
        customDomain: hasActiveDomain ? project.customDomain : undefined,
        appDomain: useRuntimeConfig().public.appDomain || 'localhost',
        protocol: window.location.protocol,
        port: window.location.port,
      })
    },
    readHash() {
      const hash = window.location.hash.replace('#', '')
      if (TAB_IDS.includes(hash)) this.activeTab = hash
    },
    setActiveTab(id) {
      this.activeTab = id
      window.history.replaceState(null, '', `#${id}`)
    },
    onActiveProjectChanged() {
      this.load({ silent: true })
    },
    async load(options = {}) {
      if (!options.silent) this.isLoading = true
      this.error = null
      try {
        const activeRes = await $fetch('/api/projects/active')
        const context = activeRes?.data || activeRes
        const detailRes = await $fetch(`/api/projects/${context.project.slug}`)
        this.detail = detailRes?.data || detailRes
        this.context = context
        if (!this.tabs.some((t) => t.id === this.activeTab)) this.setActiveTab('general')
      } catch (err) {
        this.error = this.errorMessage(err, 'Could not load the active project')
      } finally {
        this.isLoading = false
      }
    },
    async onProjectUpdated(updated) {
      // The slug may have changed; reload both the context and the detail.
      if (updated && typeof updated === 'object') {
        this.detail = { ...(this.detail || {}), ...updated }
      }
      await this.load({ silent: true })
      if (import.meta.client) window.dispatchEvent(new CustomEvent('veerify:active-project-changed'))
    },
    async onProjectDeleted() {
      try {
        const listRes = await $fetch('/api/projects')
        const projects = listRes?.data || listRes
        const next = Array.isArray(projects) ? projects.find((p) => p.id !== this.projectData?.id) : null
        if (next) {
          await $fetch('/api/projects/active', { method: 'POST', body: { projectId: next.id } })
        }
        if (import.meta.client) window.dispatchEvent(new CustomEvent('veerify:active-project-changed'))
        await navigateTo(next ? '/dashboard' : '/onboarding')
      } catch {
        await navigateTo('/dashboard')
      }
    },
  },
}
</script>
