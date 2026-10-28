<template>
  <PageContainer data-testid="settings-page" :data-hydrated="isHydrated ? 'true' : 'false'">
    <PageHeader
      title="Settings"
      description="Your personal account. Workspace and project settings live under Workspace settings and Project settings."
    />

    <SettingsTabs
      :tabs="availableTabs"
      default-tab="profile"
      test-id-prefix="settings"
      aria-label-suffix=" settings"
      :hash-redirects="hashRedirects"
    >
      <template #default="{ active }">
        <KeepAlive>
          <component :is="componentMap[active] || 'SettingsProfile'" :key="active" />
        </KeepAlive>
      </template>
    </SettingsTabs>
  </PageContainer>
</template>

<script>
import SettingsProfile from '~/components/settings/SettingsProfile.vue'
import SettingsSecurity from '~/components/settings/SettingsSecurity.vue'
import SettingsApiKeys from '~/components/settings/SettingsApiKeys.vue'
import SettingsNotifications from '~/components/settings/SettingsNotifications.vue'
import SettingsAppearance from '~/components/settings/SettingsAppearance.vue'

const tabs = [
  { id: 'profile', label: 'Profile', icon: 'lucide:user' },
  { id: 'security', label: 'Security', icon: 'lucide:shield' },
  { id: 'api-keys', label: 'API keys', icon: 'lucide:key-round' },
  { id: 'notifications', label: 'Notifications', icon: 'lucide:bell' },
  { id: 'appearance', label: 'Appearance', icon: 'lucide:palette' },
]

const componentMap = {
  profile: 'SettingsProfile',
  security: 'SettingsSecurity',
  'api-keys': 'SettingsApiKeys',
  notifications: 'SettingsNotifications',
  appearance: 'SettingsAppearance',
}

// Workspace and project sections that used to live here now have their own pages.
const HASH_REDIRECTS = {
  organization: { path: '/workspace', tab: 'general' },
  team: { path: '/workspace', tab: 'projects' },
  billing: { path: '/workspace', tab: 'billing' },
  status: { path: '/workspace', tab: 'status' },
  tools: { path: '/project/settings', tab: 'tools' },
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
      isHydrated: false,
      componentMap,
      hashRedirects: HASH_REDIRECTS,
    }
  },
  computed: {
    availableTabs() {
      return tabs
    },
  },
  created() {
    useHead({ title: 'Settings' })
  },
  mounted() {
    this.isHydrated = true
  },
}
</script>
