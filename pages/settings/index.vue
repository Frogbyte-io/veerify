<template>
  <div data-testid="settings-page" :data-hydrated="isHydrated ? 'true' : 'false'" class="p-6">
    <div class="mb-6">
      <h1 class="text-3xl font-bold">Settings</h1>
      <p class="text-muted-foreground">
        Your personal account. Workspace and project settings live under Workspace settings and Project settings.
      </p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- Settings Navigation -->
      <div class="lg:col-span-1">
        <nav class="bg-card rounded-lg border p-4">
          <ul class="space-y-2">
            <li v-for="tab in availableTabs" :key="tab.key">
              <button
                :data-testid="`settings-tab-${tab.key}`"
                :aria-label="`${tab.label} settings`"
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
</template>

<script>
import SettingsProfile from '~/components/settings/SettingsProfile.vue'
import SettingsSecurity from '~/components/settings/SettingsSecurity.vue'
import SettingsApiKeys from '~/components/settings/SettingsApiKeys.vue'
import SettingsNotifications from '~/components/settings/SettingsNotifications.vue'
import SettingsAppearance from '~/components/settings/SettingsAppearance.vue'

const tabs = [
  { key: 'profile', label: 'Profile', icon: 'lucide:user' },
  { key: 'security', label: 'Security', icon: 'lucide:shield' },
  { key: 'api-keys', label: 'API keys', icon: 'lucide:key-round' },
  { key: 'notifications', label: 'Notifications', icon: 'lucide:bell' },
  { key: 'appearance', label: 'Appearance', icon: 'lucide:palette' },
]

const componentMap = {
  profile: 'SettingsProfile',
  security: 'SettingsSecurity',
  'api-keys': 'SettingsApiKeys',
  notifications: 'SettingsNotifications',
  appearance: 'SettingsAppearance',
}

// Workspace-level sections that used to live here now have their own page.
const MOVED_TO_WORKSPACE = {
  organization: 'general',
  team: 'projects',
  billing: 'billing',
  status: 'status',
}

export default {
  name: 'SettingsPage',
  components: {
    SettingsProfile,
    SettingsSecurity,
    SettingsApiKeys,
    SettingsNotifications,
    SettingsAppearance,
  },
  data() {
    return {
      activeTab: 'profile',
      isHydrated: false,
    }
  },
  computed: {
    availableTabs() {
      return tabs
    },
    currentComponent() {
      return componentMap[this.activeTab] || 'SettingsProfile'
    },
  },
  created() {
    useHead({ title: 'Settings' })
  },

  async mounted() {
    this.isHydrated = true

    const hash = window.location.hash.replace('#', '')
    if (hash in MOVED_TO_WORKSPACE) {
      await navigateTo(`/workspace#${MOVED_TO_WORKSPACE[hash]}`, { replace: true })
      return
    }
    if (hash === 'tools') {
      await navigateTo('/project/settings#tools', { replace: true })
      return
    }

    if (hash && this.availableTabs.some((tab) => tab.key === hash)) {
      this.activeTab = hash
    } else if (hash) {
      this.activeTab = 'profile'
      window.history.replaceState(null, null, '#profile')
    }
  },
  methods: {
    setActiveTab(tab) {
      this.activeTab = tab
      window.history.replaceState(null, null, `#${tab}`)
    },
  },
}
</script>
