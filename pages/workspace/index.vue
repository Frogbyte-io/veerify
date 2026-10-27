<template>
  <div data-testid="workspace-page" :data-hydrated="isHydrated ? 'true' : 'false'" class="p-6">
    <div class="mb-6">
      <h1 class="text-3xl font-bold">Workspace settings</h1>
      <p class="text-muted-foreground">
        Manage your workspace, its people and projects, and the keys shared by every project
      </p>
    </div>

    <div v-if="isLoading" class="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <Skeleton class="h-64 w-full lg:col-span-1" />
      <Skeleton class="h-64 w-full lg:col-span-3" />
    </div>

    <div v-else-if="error" class="py-10 text-center" data-testid="workspace-error">
      <p class="mb-3 text-sm text-destructive">{{ error }}</p>
      <Button variant="outline" @click="loadOrganization">Retry</Button>
    </div>

    <div v-else-if="!organization" class="py-10 text-center">
      <p class="font-medium">No workspace yet</p>
      <p class="mt-1 mb-4 text-sm text-muted-foreground">Create a workspace to manage projects and people.</p>
      <Button as-child>
        <NuxtLink to="/get-started">Create a workspace</NuxtLink>
      </Button>
    </div>

    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div class="lg:col-span-1">
        <nav class="rounded-lg border bg-card p-4">
          <ul class="space-y-2">
            <li v-for="tab in availableTabs" :key="tab.key">
              <button
                :data-testid="`workspace-tab-${tab.key}`"
                :aria-label="`${tab.label} settings`"
                :class="[
                  'flex w-full items-center rounded-md px-3 py-2 text-left transition-colors',
                  activeTab === tab.key
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
                ]"
                @click="setActiveTab(tab.key)"
              >
                <Icon :name="tab.icon" class="mr-2 h-4 w-4" />
                {{ tab.label }}
              </button>
            </li>
          </ul>
        </nav>
      </div>

      <div class="lg:col-span-3">
        <WorkspaceGeneral
          v-if="activeTab === 'general'"
          :organization="organization"
          @updated="onOrganizationUpdated"
        />
        <WorkspaceMembers v-else-if="activeTab === 'members'" :organization="organization" />
        <WorkspaceProjects v-else-if="activeTab === 'projects'" :can-create="canManage" />
        <WorkspaceApiKeys v-else-if="activeTab === 'keys'" />
        <WorkspaceIntegrations v-else-if="activeTab === 'integrations'" :can-manage="canManage" />
        <WorkspaceDataPrivacy v-else-if="activeTab === 'privacy'" :can-manage="canManage" />
        <WorkspaceBilling v-else-if="activeTab === 'billing'" />
        <WorkspaceStatus v-else-if="activeTab === 'status'" />
      </div>
    </div>
  </div>
</template>

<script>
const baseTabs = [
  { key: 'general', label: 'General', icon: 'lucide:building-2' },
  { key: 'members', label: 'Members', icon: 'lucide:users' },
  { key: 'projects', label: 'Projects', icon: 'lucide:folder-kanban' },
  { key: 'keys', label: 'AI & API keys', icon: 'lucide:key-round' },
  { key: 'integrations', label: 'Integrations', icon: 'lucide:plug-zap' },
  { key: 'privacy', label: 'Data & privacy', icon: 'lucide:shield-check' },
]

export default {
  name: 'WorkspacePage',

  data() {
    return {
      activeTab: 'general',
      isHydrated: false,
      isLoading: true,
      error: null,
      organization: null,
      deploymentMode: 'cloud',
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

    availableTabs() {
      const tabs = [...baseTabs]
      // Billing is hidden during the beta period; self-hosted installs get the owner-only Status tab instead.
      if (this.isSelfHosted && this.currentOrgRole === 'owner') {
        tabs.push({ key: 'status', label: 'Status', icon: 'lucide:activity' })
      }
      return tabs
    },
  },

  created() {
    useHead({ title: 'Workspace settings' })
  },

  async mounted() {
    this.isHydrated = true
    this.deploymentMode = useRuntimeConfig().public.deploymentMode || 'cloud'
    await this.loadOrganization()
    this.applyHash()
    window.addEventListener('hashchange', this.applyHash)
    window.addEventListener('veerify:active-project-changed', this.onContextChanged)
  },

  beforeUnmount() {
    window.removeEventListener('hashchange', this.applyHash)
    window.removeEventListener('veerify:active-project-changed', this.onContextChanged)
  },

  methods: {
    normalizeTabHash(hash) {
      if (this.isSelfHosted && hash === 'billing') return 'status'
      return hash
    },

    applyHash() {
      const hash = this.normalizeTabHash(window.location.hash.replace('#', ''))
      if (hash && this.availableTabs.some((tab) => tab.key === hash)) {
        this.activeTab = hash
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

    setActiveTab(tab) {
      this.activeTab = tab
      window.history.replaceState(null, null, `#${tab}`)
    },
  },
}
</script>
