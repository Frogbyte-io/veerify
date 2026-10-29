<template>
  <PageContainer data-testid="project-settings-page">
    <PageHeader title="Project settings">
      <template #description>
        <template v-if="projectData">
          {{ projectData.name }} <span class="text-xs">in {{ organization?.name }}</span>
        </template>
        <span v-else-if="isLoading" class="inline-block h-4 w-48 animate-pulse rounded bg-muted align-middle" />
        <template v-else>Settings for the active project</template>
      </template>
      <!-- Rendered from the first paint: placeholders while loading so nothing pops in later -->
      <template #actions>
        <template v-if="projectData">
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
        </template>
        <template v-else-if="isLoading">
          <Skeleton class="h-8 w-28" />
          <Skeleton class="h-6 w-16 rounded-full" />
        </template>
      </template>
    </PageHeader>

    <!-- Error State -->
    <div v-if="error && !isLoading" class="rounded-lg border bg-card p-8 text-center">
      <Icon name="lucide:alert-circle" class="w-12 h-12 mx-auto text-destructive mb-4" />
      <p class="text-lg font-medium mb-2">Failed to load project settings</p>
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <Button variant="outline" @click="load">
        <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
        Retry
      </Button>
    </div>

    <SettingsTabs
      v-else
      :tabs="tabs"
      default-tab="general"
      test-id-prefix="project-settings"
      :loading="isLoading || !projectData"
      :skeleton-count="8"
    >
      <template #default="{ active, warm }">
        <p
          v-if="!canAdmin && active !== 'danger'"
          class="mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
          data-testid="project-settings-lock"
        >
          <Icon name="lucide:lock" class="h-4 w-4" />
          Project admins can change this.
        </p>
        <fieldset :disabled="!canAdmin && active !== 'danger'" class="min-w-0 border-0 p-0 m-0">
          <!-- Keyed by project so a switch remounts the tabs; warm (visited or hovered) tabs stay mounted -->
          <div v-for="tab in warm" v-show="tab === active" :key="`${projectData.id}:${tab}`">
            <component
              :is="TAB_COMPONENTS[tab] || 'ProjectSettingsGeneral'"
              v-bind="tabProps(tab)"
              @updated="onProjectUpdated"
              @deleted="onProjectDeleted"
              @products-changed="load({ silent: true })"
            />
          </div>
        </fieldset>
      </template>
    </SettingsTabs>
  </PageContainer>
</template>

<script>
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { loadActiveProject } from '~/lib/active-project'
import ProjectSettingsGeneral from '~/components/project/ProjectSettingsGeneral.vue'
import ProjectSettingsProducts from '~/components/project/ProjectSettingsProducts.vue'
import ProjectSettingsAccess from '~/components/project/ProjectSettingsAccess.vue'
import ProjectSettingsTools from '~/components/project/ProjectSettingsTools.vue'
import ProjectSettingsAppearance from '~/components/project/ProjectSettingsAppearance.vue'
import ProjectSettingsDomain from '~/components/project/ProjectSettingsDomain.vue'
import ProjectSettingsEmail from '~/components/project/ProjectSettingsEmail.vue'
import ProjectSettingsEmbed from '~/components/project/ProjectSettingsEmbed.vue'
import ProjectSettingsDanger from '~/components/project/ProjectSettingsDanger.vue'

const TAB_COMPONENTS = {
  general: 'ProjectSettingsGeneral',
  products: 'ProjectSettingsProducts',
  access: 'ProjectSettingsAccess',
  tools: 'ProjectSettingsTools',
  appearance: 'ProjectSettingsAppearance',
  domain: 'ProjectSettingsDomain',
  email: 'ProjectSettingsEmail',
  embed: 'ProjectSettingsEmbed',
  danger: 'ProjectSettingsDanger',
}

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
    ProjectSettingsEmail,
    ProjectSettingsEmbed,
    ProjectSettingsDanger,
  },
  data() {
    return {
      context: null,
      detail: null,
      isLoading: true,
      error: null,
      TAB_COMPONENTS,
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
        { id: 'email', label: 'Email', icon: 'lucide:mail' },
        { id: 'embed', label: 'Embed', icon: 'lucide:code-2' },
        { id: 'danger', label: 'Danger zone', icon: 'lucide:alert-triangle', requiresDelete: true },
      ]
      return all.filter((tab) => !tab.requiresDelete || this.canDelete)
    },
    publicBoardUrl() {
      if (!import.meta.client || !this.projectData || !this.organization || !this.projectData.isPublic) return ''
      return this.buildUrl(this.products.length > 1 ? undefined : this.products[0]?.slug)
    },
  },
  created() {
    useHead({
      title: () => (this.projectData?.name ? `${this.projectData.name} · Project settings` : 'Project settings'),
    })
  },
  async mounted() {
    window.addEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
    await this.load()
  },
  beforeUnmount() {
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
    tabProps(tab) {
      const project = this.projectData
      switch (tab) {
        case 'general':
        case 'embed':
          return { project, organization: this.organization, products: this.products }
        case 'products':
        case 'email':
          return { project, products: this.products }
        case 'access':
          return { project, organization: this.organization }
        default:
          return { project }
      }
    },
    onActiveProjectChanged() {
      this.load({ silent: true })
    },
    async load(options = {}) {
      if (!options.silent) this.isLoading = true
      this.error = null
      try {
        const context = await loadActiveProject({ force: Boolean(options.silent) })
        if (!context) throw new Error('No active project')
        const detailRes = await $fetch(`/api/projects/${context.project.slug}`)
        this.detail = detailRes?.data || detailRes
        this.context = context
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
