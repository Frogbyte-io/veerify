<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Notification Preferences</h2>
      <p class="text-sm text-muted-foreground">Configure how you receive notifications about your projects.</p>
    </div>
    <div class="p-6">
      <div v-if="isLoading" class="space-y-6">
        <Skeleton v-for="i in 5" :key="i" class="h-12 w-full" />
      </div>
      <div v-else-if="error" class="text-center py-6">
        <p class="text-sm text-destructive mb-2">Failed to load preferences</p>
        <Button variant="outline" size="sm" @click="fetchPreferences">Retry</Button>
      </div>
      <div v-else class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">Email Notifications</h3>
            <p class="text-sm text-muted-foreground">Receive email updates about subscribed feedback items</p>
          </div>
          <Switch
            :model-value="preferences.emailNotifications"
            @update:model-value="updatePreference('emailNotifications', $event)"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">In-App Notifications</h3>
            <p class="text-sm text-muted-foreground">Show notifications in the dashboard notification bell</p>
          </div>
          <Switch
            :model-value="preferences.inAppNotifications"
            @update:model-value="updatePreference('inAppNotifications', $event)"
          />
        </div>

        <SidebarSeparator />

        <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notification Types</p>

        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">New Feedback</h3>
            <p class="text-sm text-muted-foreground">When someone submits feedback to your projects</p>
          </div>
          <Switch
            :model-value="preferences.newFeedback"
            @update:model-value="updatePreference('newFeedback', $event)"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">Status Changes</h3>
            <p class="text-sm text-muted-foreground">When a feedback item's status is updated</p>
          </div>
          <Switch
            :model-value="preferences.statusChanges"
            @update:model-value="updatePreference('statusChanges', $event)"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">New Comments</h3>
            <p class="text-sm text-muted-foreground">When someone comments on feedback in your projects</p>
          </div>
          <Switch
            :model-value="preferences.newComments"
            @update:model-value="updatePreference('newComments', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsNotifications',
  data() {
    return {
      isLoading: true,
      error: false,
      isSaving: false,
      preferences: {
        emailNotifications: true,
        inAppNotifications: true,
        newFeedback: true,
        statusChanges: true,
        newComments: true,
      },
    }
  },
  methods: {
    async fetchPreferences() {
      this.isLoading = true
      this.error = false
      try {
        const res = await $fetch('/api/notifications/preferences')
        if (res.success) {
          this.preferences = { ...this.preferences, ...res.data }
        }
      } catch {
        this.error = true
      } finally {
        this.isLoading = false
      }
    },
    async updatePreference(key, value) {
      const previous = this.preferences[key]
      this.preferences[key] = value
      try {
        await $fetch('/api/notifications/preferences', {
          method: 'PUT',
          body: { [key]: value },
        })
      } catch {
        // Revert on failure
        this.preferences[key] = previous
      }
    },
  },
  mounted() {
    this.fetchPreferences()
  },
}
</script>
