<template>
  <div class="rounded-lg border bg-card">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Tools</h2>
      <p class="text-sm text-muted-foreground mt-1">
        Switch tools on or off for this project. Switched-off tools are hidden from the sidebar and the public site.
        Your data is kept.
      </p>
    </div>
    <div class="p-6 space-y-3">
      <div
        v-for="feature in features"
        :key="feature.key"
        class="flex items-start justify-between rounded-lg border p-4 transition-colors"
        :class="localFeatures[feature.key] ? 'border-border' : 'opacity-60'"
      >
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div
            class="w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            :class="localFeatures[feature.key] ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            <Icon :name="feature.icon" class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ feature.label }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ feature.description }}</p>
          </div>
        </div>
        <Switch
          :model-value="localFeatures[feature.key]"
          :disabled="savingFeature === feature.key"
          :aria-label="feature.label"
          class="shrink-0 ml-4 mt-0.5"
          @update:model-value="toggleFeature(feature.key, $event)"
        />
      </div>
    </div>

    <!-- Disable Feature Confirmation Dialog -->
    <Dialog :open="showDisableDialog" @update:open="cancelDisable">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disable {{ disableFeatureLabel }}?</DialogTitle>
          <DialogDescription>
            Your data will not be deleted, but {{ disableFeatureLabel }} will be hidden from the sidebar and the public
            site. There will be no way to view the {{ disableFeatureDataLabel }} until this tool is switched back on.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="flex-row justify-end gap-2 sm:gap-2">
          <Button variant="outline" @click="cancelDisable">Cancel</Button>
          <Button variant="destructive" @click="confirmDisable">Disable</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { MODULES, resolveProjectModules } from '~/lib/modules'

export default {
  name: 'ProjectSettingsTools',

  props: {
    project: {
      type: Object,
      required: true,
    },
  },

  emits: ['updated'],

  data() {
    return {
      features: MODULES,
      savingFeature: null,
      showDisableDialog: false,
      pendingDisableFeature: null,
      localFeatures: resolveProjectModules(this.project?.settings),
    }
  },

  computed: {
    pendingDisableModule() {
      return MODULES.find((module) => module.key === this.pendingDisableFeature) || null
    },
    disableFeatureLabel() {
      return this.pendingDisableModule?.label || ''
    },
    disableFeatureDataLabel() {
      return this.pendingDisableModule?.dataLabel || ''
    },
  },

  watch: {
    project(newProject) {
      this.localFeatures = resolveProjectModules(newProject?.settings)
    },
  },

  methods: {
    toggleFeature(feature, value) {
      if (!value) {
        this.pendingDisableFeature = feature
        this.showDisableDialog = true
        return
      }
      this.saveFeature(feature, value)
    },

    confirmDisable() {
      const feature = this.pendingDisableFeature
      this.showDisableDialog = false
      this.pendingDisableFeature = null
      this.saveFeature(feature, false)
    },

    cancelDisable() {
      this.showDisableDialog = false
      this.pendingDisableFeature = null
    },

    async saveFeature(feature, value) {
      this.localFeatures[feature] = value
      this.savingFeature = feature

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: {
            settings: {
              ...this.project.settings,
              ...this.localFeatures,
            },
          },
        })

        this.$emit('updated', response?.data || response)
        if (import.meta.client) window.dispatchEvent(new CustomEvent('veerify:project-modules-changed'))
      } catch (err) {
        // Revert optimistic update
        this.localFeatures[feature] = !value
        toast.error(err?.data?.error?.message || 'Failed to save tool settings')
      } finally {
        this.savingFeature = null
      }
    },
  },
}
</script>
