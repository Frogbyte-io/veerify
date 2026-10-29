<template>
  <PageContainer data-testid="workspace-page" :data-hydrated="isHydrated ? 'true' : 'false'">
    <PageHeader
      title="Workspace settings"
      description="Manage your workspace, its people and projects, and the keys shared by every project"
    />

    <div v-if="error && !isLoading" class="py-10 text-center" data-testid="workspace-error">
      <p class="mb-3 text-sm text-destructive">{{ error }}</p>
      <Button variant="outline" @click="loadOrganization">Retry</Button>
    </div>

    <div v-else-if="!isLoading && !organization" class="py-10 text-center">
      <p class="font-medium">No workspace yet</p>
      <p class="mt-1 mb-4 text-sm text-muted-foreground">Create a workspace to manage projects and people.</p>
      <Button as-child>
        <NuxtLink to="/get-started">Create a workspace</NuxtLink>
      </Button>
    </div>

    <SettingsTabs
      v-else
      :tabs="availableTabs"
      default-tab="general"
      test-id-prefix="workspace"
      aria-label-suffix=" settings"
      :loading="isLoading"
      :aliases="tabAliases"
    >
      <template #default="{ active, warm }">
        <!-- Keyed by workspace so a switch remounts the tabs; warm (visited or hovered) tabs stay mounted -->
        <div v-for="tab in warm" v-show="tab === active" :key="`${organization.id}:${tab}`">
          <component :is="tabComponent(tab)" v-bind="tabProps(tab)" @updated="onOrganizationUpdated" />
        </div>
      </template>
    </SettingsTabs>
  </PageContainer>
</template>

<script>
import WorkspaceGeneral from '~/components/workspace/WorkspaceGeneral.vue'
import WorkspaceMembers from '~/components/workspace/WorkspaceMembers.vue'
import WorkspaceProjects from '~/components/workspace/WorkspaceProjects.vue'
import WorkspaceApiKeys from '~/components/workspace/WorkspaceApiKeys.vue'
import WorkspaceIntegrations from '~/components/workspace/WorkspaceIntegrations.vue'
import WorkspaceDataPrivacy from '~/components/workspace/WorkspaceDataPrivacy.vue'
import WorkspaceBilling from '~/components/workspace/WorkspaceBilling.vue'
import WorkspaceStatus from '~/components/workspace/WorkspaceStatus.vue'
const baseTabs = [
  { id: 'general', label: 'General', icon: 'lucide:building-2' },
  { id: 'members', label: 'Members', icon: 'lucide:users' },
  { id: 'projects', label: 'Projects', icon: 'lucide:folder-kanban' },
  { id: 'keys', label: 'AI & API keys', icon: 'lucide:key-round' },
  { id: 'integrations', label: 'Integrations', icon: 'lucide:plug-zap' },
  { id: 'privacy', label: 'Data & privacy', icon: 'lucide:shield-check' },
]

const TAB_COMPONENTS = {
  general: 'WorkspaceGeneral',
  members: 'WorkspaceMembers',
  projects: 'WorkspaceProjects',
  keys: 'WorkspaceApiKeys',
  integrations: 'WorkspaceIntegrations',
  privacy: 'WorkspaceDataPrivacy',
  billing: 'WorkspaceBilling',
  status: 'WorkspaceStatus',
}

export default {
  name: 'WorkspacePage',

  // Registered locally: <component :is> takes these names as strings
  components: {
    WorkspaceGeneral,
    WorkspaceMembers,
    WorkspaceProjects,
    WorkspaceApiKeys,
    WorkspaceIntegrations,
    WorkspaceDataPrivacy,
    WorkspaceBilling,
    WorkspaceStatus,
  },

  data() {
    return {
      isHydrated: false,
      isLoading: true,
      error: null,
      organization: null,
      deploymentMode: useRuntimeConfig().public.deploymentMode || 'cloud',
    }
  },

  computed: {
    isSelfHosted() {
      return this.deploymentMode === 'self-hosted'
    },

    currentOrgRole() {
      return this.organization?.currentUserRole || null
    },

    canManage() {
      return ['owner', 'admin'].includes(this.currentOrgRole || '')
    },

    // Billing is replaced by Status on self-hosted installs (old `#billing` / `?tab=billing` links).
    tabAliases() {
      return this.isSelfHosted ? { billing: 'status' } : {}
    },

    availableTabs() {
      const tabs = [...baseTabs]
      // Billing is hidden during the beta period; self-hosted installs get the owner-only Status tab instead.
      if (this.isSelfHosted && this.currentOrgRole === 'owner') {
        tabs.push({ id: 'status', label: 'Status', icon: 'lucide:activity' })
      }
      return tabs
    },
  },

  created() {
    useHead({ title: 'Workspace settings' })
  },

  async mounted() {
    this.isHydrated = true
    window.addEventListener('veerify:active-project-changed', this.onContextChanged)
    await this.loadOrganization()
  },

  beforeUnmount() {
    window.removeEventListener('veerify:active-project-changed', this.onContextChanged)
  },

  methods: {
    tabComponent(tab) {
      return TAB_COMPONENTS[tab] || 'WorkspaceGeneral'
    },

    tabProps(tab) {
      switch (tab) {
        case 'members':
          return { organization: this.organization }
        case 'projects':
          return { canCreate: this.canManage }
        case 'integrations':
        case 'privacy':
          return { canManage: this.canManage }
        case 'keys':
        case 'billing':
        case 'status':
          return {}
        default:
          return { organization: this.organization }
      }
    },

    // A workspace switch happens through the project switcher; reload so the page shows the new one.
    onContextChanged() {
      this.loadOrganization({ silent: true })
    },

    async loadOrganization({ silent = false } = {}) {
      if (!silent) this.isLoading = true
      this.error = null
      try {
        let activeOrg = await $fetch('/api/auth/organization/get-full-organization').catch(() => null)
        if (!activeOrg?.id && !activeOrg?.name) {
          // A fresh session has no active workspace yet: activate the user's first one, like the
          // project switcher would, instead of claiming they have none.
          activeOrg = await this.activateFirstOrganization()
        }
        if (!activeOrg?.id && !activeOrg?.name) {
          this.organization = null
          useState('hasActiveOrganization', () => null).value = false
          return
        }
        useState('hasActiveOrganization', () => null).value = true

        let slug = activeOrg.slug || null
        if (!slug) {
          const listedOrgs = await $fetch('/api/auth/organization/list').catch(() => null)
          const organizations = Array.isArray(listedOrgs) ? listedOrgs : listedOrgs?.data || []
          slug = organizations.find((org) => org.id === activeOrg.id)?.slug || null
        }
        if (!slug) {
          this.error = 'Failed to load the workspace'
          return
        }

        const response = await $fetch(`/api/orgs/${slug}`)
        this.organization = response?.data || null
      } catch (_error) {
        this.error = 'Failed to load the workspace'
      } finally {
        this.isLoading = false
      }
    },

    async activateFirstOrganization() {
      const listedOrgs = await $fetch('/api/auth/organization/list').catch(() => null)
      const organizations = Array.isArray(listedOrgs) ? listedOrgs : listedOrgs?.data || []
      const first = organizations[0]
      if (!first?.id) return null
      await $fetch('/api/organizations/active', { method: 'POST', body: { organizationId: first.id } })
      if (import.meta.client) window.dispatchEvent(new CustomEvent('veerify:active-project-changed'))
      return $fetch('/api/auth/organization/get-full-organization').catch(() => null)
    },

    onOrganizationUpdated(organization) {
      this.organization = organization
    },
  },
}
</script>
