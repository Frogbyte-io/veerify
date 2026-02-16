<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold">Settings</h1>
        <p class="text-muted-foreground">Manage your account and application preferences</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <!-- Settings Navigation -->
        <div class="lg:col-span-1">
          <nav class="bg-card rounded-lg border p-4">
            <ul class="space-y-2">
              <li v-for="tab in availableTabs" :key="tab.key">
                <button
                  :data-testid="`settings-tab-${tab.key}`"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === tab.key
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50',
                  ]"
                  @click="setActiveTab(tab.key)"
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
          <component :is="currentComponent" />
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import SettingsProfile from '~/components/settings/SettingsProfile.vue'
import SettingsSecurity from '~/components/settings/SettingsSecurity.vue'
import SettingsNotifications from '~/components/settings/SettingsNotifications.vue'
import SettingsOrganization from '~/components/settings/SettingsOrganization.vue'
import SettingsTeam from '~/components/settings/SettingsTeam.vue'
import SettingsBilling from '~/components/settings/SettingsBilling.vue'
import SettingsAppearance from '~/components/settings/SettingsAppearance.vue'

const allTabs = [
  { key: 'profile', label: 'Profile', icon: 'lucide:user' },
  { key: 'security', label: 'Security', icon: 'lucide:shield' },
  { key: 'notifications', label: 'Notifications', icon: 'lucide:bell' },
  { key: 'organization', label: 'Workspace', icon: 'lucide:building-2' },
  { key: 'team', label: 'Teams', icon: 'lucide:users' },
  { key: 'billing', label: 'Billing', icon: 'lucide:credit-card' },
  { key: 'appearance', label: 'Appearance', icon: 'lucide:palette' },
]

const componentMap = {
  profile: 'SettingsProfile',
  security: 'SettingsSecurity',
  notifications: 'SettingsNotifications',
  organization: 'SettingsOrganization',
  team: 'SettingsTeam',
  billing: 'SettingsBilling',
  appearance: 'SettingsAppearance',
}

export default {
  name: 'SettingsPage',
  components: {
    SettingsProfile,
    SettingsSecurity,
    SettingsNotifications,
    SettingsOrganization,
    SettingsTeam,
    SettingsBilling,
    SettingsAppearance,
  },
  data() {
    return {
      activeTab: 'profile',
      currentOrgRole: null,
      hasOrganization: false,
    }
  },
  computed: {
    availableTabs() {
      return allTabs.filter((tab) => {
        // Teams and billing are only visible in workspace context
        if (['team', 'billing'].includes(tab.key) && !this.hasOrganization) {
          return false
        }
        if (tab.key === 'billing') {
          return this.currentOrgRole === 'owner'
        }
        return true
      })
    },
    currentComponent() {
      return componentMap[this.activeTab] || 'SettingsProfile'
    },
  },
  async mounted() {
    await this.loadOrgRole()

    const hash = window.location.hash.replace('#', '')
    const validKeys = this.availableTabs.map((t) => t.key)
    if (hash && validKeys.includes(hash)) {
      this.activeTab = hash
    } else if (hash === 'organization') {
      // Workspace tab is always available — navigate to it
      this.activeTab = 'organization'
    } else if (hash && !validKeys.includes(hash)) {
      this.activeTab = 'profile'
      window.history.replaceState(null, null, '#profile')
    }
  },
  methods: {
    async loadOrgRole() {
      try {
        const activeOrg = await $fetch('/api/auth/organization/get-full-organization').catch(() => null)
        if (!activeOrg?.id && !activeOrg?.name) {
          this.currentOrgRole = null
          this.hasOrganization = false
          return
        }

        this.hasOrganization = true

        let slug = activeOrg.slug || null
        if (!slug) {
          const listedOrgs = await $fetch('/api/auth/organization/list').catch(() => null)
          const organizations = Array.isArray(listedOrgs) ? listedOrgs : listedOrgs?.data || []
          const matched = organizations.find((org) => org.id === activeOrg.id)
          slug = matched?.slug || null
        }

        if (slug) {
          const response = await $fetch(`/api/orgs/${slug}`).catch(() => null)
          this.currentOrgRole = response?.data?.currentUserRole || null
        }
      } catch (_error) {
        this.currentOrgRole = null
      }
    },
    setActiveTab(tab) {
      this.activeTab = tab
      window.history.replaceState(null, null, `#${tab}`)
    },
  },
}
</script>
