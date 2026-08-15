<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Tools</h2>
      <p class="text-sm text-muted-foreground">
        Choose which Veerify modules this team uses. Disabling a module hides it from the sidebar — your data is kept
        and returns if you switch it back on.
      </p>
    </div>

    <div class="p-6">
      <div v-if="isLoading" class="space-y-3">
        <Skeleton v-for="i in 4" :key="i" class="h-20 w-full" />
      </div>

      <div v-else-if="error" class="text-center py-6" data-testid="settings-tools-error">
        <p class="text-sm text-destructive mb-2">Failed to load modules</p>
        <Button variant="outline" size="sm" @click="fetchModules">Retry</Button>
      </div>

      <div v-else-if="!teamId" class="text-center py-6">
        <p class="text-sm text-muted-foreground">Select a workspace team to configure its modules.</p>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="module in modules"
          :key="module.key"
          class="flex items-start justify-between rounded-lg border p-4 transition-colors"
          :class="values[module.key] ? 'border-border' : 'opacity-60'"
          :data-testid="`settings-tools-${module.key}`"
        >
          <div class="flex items-start gap-3 flex-1 min-w-0">
            <div
              class="w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5"
              :class="values[module.key] ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
            >
              <Icon :name="module.icon" class="w-4 h-4" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ module.label }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ module.description }}</p>
            </div>
          </div>
          <Switch
            :model-value="values[module.key]"
            :disabled="saving === module.key"
            class="shrink-0 ml-4 mt-0.5"
            @update:model-value="toggle(module.key, $event)"
          />
        </div>

        <p class="text-xs text-muted-foreground pt-2">
          Products have their own feature toggles as well. A module must be enabled here <em>and</em> on the product for
          it to appear.
        </p>
      </div>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

const MODULES = [
  {
    key: 'feedbackEnabled',
    label: 'Feedback',
    icon: 'lucide:message-square',
    description: 'Collect, vote on, and triage product feedback',
  },
  {
    key: 'roadmapEnabled',
    label: 'Roadmap',
    icon: 'lucide:map',
    description: 'Share planned work publicly as a kanban-style roadmap',
  },
  {
    key: 'changelogEnabled',
    label: 'Changelog',
    icon: 'lucide:newspaper',
    description: 'Publish release notes and product updates',
  },
  {
    key: 'supportEnabled',
    label: 'Support',
    icon: 'lucide:inbox',
    description: 'Shared inbox for customer conversations and contacts',
  },
]

export default {
  name: 'SettingsTools',

  data() {
    return {
      modules: MODULES,
      values: {
        feedbackEnabled: true,
        roadmapEnabled: false,
        changelogEnabled: false,
        supportEnabled: false,
      },
      teamId: null,
      isLoading: true,
      error: null,
      saving: null,
    }
  },

  async mounted() {
    await this.fetchModules()

    if (import.meta.client) {
      window.addEventListener('veerify:active-team-changed', this.handleTeamChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener('veerify:active-team-changed', this.handleTeamChanged)
    }
  },

  methods: {
    async handleTeamChanged() {
      await this.fetchModules()
    },

    async fetchModules() {
      this.isLoading = true
      this.error = null

      try {
        const activeTeam = await $fetch('/api/teams/active')
        this.teamId = activeTeam?.data?.id || null

        if (!this.teamId) {
          this.isLoading = false
          return
        }

        const response = await $fetch(`/api/teams/${this.teamId}/modules`)
        const modules = response?.data?.modules
        if (modules) this.values = { ...this.values, ...modules }
      } catch (err) {
        this.error = err?.data?.error?.message || 'Failed to load modules'
      } finally {
        this.isLoading = false
      }
    },

    async toggle(key, value) {
      const previous = this.values[key]
      this.values[key] = value
      this.saving = key

      try {
        await $fetch(`/api/teams/${this.teamId}/modules`, {
          method: 'PUT',
          body: { [key]: value },
        })

        // The sidebar reads these to decide which nav groups to render, and it
        // has no other reason to refetch - tell it explicitly.
        if (import.meta.client) {
          window.dispatchEvent(new CustomEvent('veerify:team-modules-changed'))
        }
      } catch (err) {
        this.values[key] = previous
        toast.error(err?.data?.error?.message || 'Failed to save module settings')
      } finally {
        this.saving = null
      }
    },
  },
}
</script>
