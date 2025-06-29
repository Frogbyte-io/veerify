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
              <li>
                <button 
                  @click="setActiveTab('profile')"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === 'profile'
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:user" class="w-4 h-4 mr-2" />
                  Profile
                </button>
              </li>
              <li>
                <button 
                  @click="setActiveTab('security')"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === 'security'
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:shield" class="w-4 h-4 mr-2" />
                  Security
                </button>
              </li>
              <li>
                <button 
                  @click="setActiveTab('notifications')"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === 'notifications'
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:bell" class="w-4 h-4 mr-2" />
                  Notifications
                </button>
              </li>
              <li>
                <button 
                  @click="setActiveTab('organization')"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === 'organization'
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:building" class="w-4 h-4 mr-2" />
                  Organization
                </button>
              </li>
              <li>
                <button 
                  @click="setActiveTab('billing')"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === 'billing'
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:credit-card" class="w-4 h-4 mr-2" />
                  Billing
                </button>
              </li>
              <li>
                <button 
                  @click="setActiveTab('appearance')"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                    activeTab === 'appearance'
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:palette" class="w-4 h-4 mr-2" />
                  Appearance
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
import SettingsBilling from '~/components/settings/SettingsBilling.vue'
import SettingsAppearance from '~/components/settings/SettingsAppearance.vue'

export default {
  name: 'SettingsPage',
  components: {
    SettingsProfile,
    SettingsSecurity,
    SettingsNotifications,
    SettingsOrganization,
    SettingsBilling,
    SettingsAppearance
  },
  data() {
    return {
      activeTab: 'profile'
    }
  },
  computed: {
    currentComponent() {
      const componentMap = {
        profile: 'SettingsProfile',
        security: 'SettingsSecurity',
        notifications: 'SettingsNotifications',
        organization: 'SettingsOrganization',
        billing: 'SettingsBilling',
        appearance: 'SettingsAppearance'
      }
      return componentMap[this.activeTab] || 'SettingsProfile'
    }
  },
  mounted() {
    // Check for hash in URL to set initial tab
    const hash = window.location.hash.replace('#', '')
    if (hash && ['profile', 'security', 'notifications', 'organization', 'billing', 'appearance'].includes(hash)) {
      this.activeTab = hash
    }
  },
  methods: {
    setActiveTab(tab) {
      this.activeTab = tab
      // Update URL hash for direct linking
      window.history.replaceState(null, null, `#${tab}`)
    }
  }
}
</script> 