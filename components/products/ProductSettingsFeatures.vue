<template>
  <div class="rounded-lg border bg-card">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Features</h2>
      <p class="text-sm text-muted-foreground mt-1">
        Enable or disable features for this product. Disabled features will be hidden from both the settings and the
        public product board.
      </p>
    </div>
    <div class="p-6 space-y-3">
      <!-- Feedback -->
      <div
        class="flex items-start justify-between rounded-lg border p-4 transition-colors"
        :class="localFeatures.feedbackEnabled ? 'border-border' : 'opacity-60'"
      >
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div
            class="w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            :class="localFeatures.feedbackEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            <Icon name="lucide:message-square" class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium">Feedback Board</p>
            <p class="text-xs text-muted-foreground mt-0.5">
              Allow users to submit, vote, and discuss feedback for your product
            </p>
          </div>
        </div>
        <Switch
          :model-value="localFeatures.feedbackEnabled"
          :disabled="savingFeature === 'feedbackEnabled'"
          class="shrink-0 ml-4 mt-0.5"
          @update:model-value="toggleFeature('feedbackEnabled', $event)"
        />
      </div>

      <!-- Roadmap -->
      <div
        class="flex items-start justify-between rounded-lg border p-4 transition-colors"
        :class="localFeatures.roadmapEnabled ? 'border-border' : 'opacity-60'"
      >
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div
            class="w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            :class="localFeatures.roadmapEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            <Icon name="lucide:map" class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium">Roadmap</p>
            <p class="text-xs text-muted-foreground mt-0.5">
              Share your planned features and priorities publicly as a kanban-style roadmap
            </p>
          </div>
        </div>
        <Switch
          :model-value="localFeatures.roadmapEnabled"
          :disabled="savingFeature === 'roadmapEnabled'"
          class="shrink-0 ml-4 mt-0.5"
          @update:model-value="toggleFeature('roadmapEnabled', $event)"
        />
      </div>

      <!-- Changelog -->
      <div
        class="flex items-start justify-between rounded-lg border p-4 transition-colors"
        :class="localFeatures.changelogEnabled ? 'border-border' : 'opacity-60'"
      >
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div
            class="w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            :class="localFeatures.changelogEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            <Icon name="lucide:newspaper" class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium">Changelog</p>
            <p class="text-xs text-muted-foreground mt-0.5">Publish release notes and product updates for your users</p>
          </div>
        </div>
        <Switch
          :model-value="localFeatures.changelogEnabled"
          :disabled="savingFeature === 'changelogEnabled'"
          class="shrink-0 ml-4 mt-0.5"
          @update:model-value="toggleFeature('changelogEnabled', $event)"
        />
      </div>
    </div>

    <!-- Disable Feature Confirmation Dialog -->
    <Dialog :open="showDisableDialog" @update:open="cancelDisable">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disable {{ disableFeatureLabel }}?</DialogTitle>
          <DialogDescription>
            Your data will not be deleted, but the public and private {{ disableFeatureLabel.toLowerCase() }} will be
            hidden. There will be no way to view the {{ disableFeatureDataLabel }} until this feature is re-enabled.
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

const FEATURE_LABELS = {
  feedbackEnabled: { label: 'Feedback Board', dataLabel: 'feedback data' },
  roadmapEnabled: { label: 'Roadmap', dataLabel: 'roadmap data' },
  changelogEnabled: { label: 'Changelog', dataLabel: 'changelog entries' },
}

export default {
  name: 'ProductSettingsFeatures',

  props: {
    project: {
      type: Object,
      required: true,
    },
  },

  emits: ['updated'],

  data() {
    return {
      savingFeature: null,
      showDisableDialog: false,
      pendingDisableFeature: null,
      localFeatures: {
        feedbackEnabled: this.project?.settings?.feedbackEnabled !== false,
        roadmapEnabled: this.project?.settings?.roadmapEnabled === true,
        changelogEnabled: this.project?.settings?.changelogEnabled === true,
      },
    }
  },

  computed: {
    disableFeatureLabel() {
      return FEATURE_LABELS[this.pendingDisableFeature]?.label || ''
    },
    disableFeatureDataLabel() {
      return FEATURE_LABELS[this.pendingDisableFeature]?.dataLabel || ''
    },
  },

  watch: {
    project(newProject) {
      this.localFeatures = {
        feedbackEnabled: newProject?.settings?.feedbackEnabled !== false,
        roadmapEnabled: newProject?.settings?.roadmapEnabled === true,
        changelogEnabled: newProject?.settings?.changelogEnabled === true,
      }
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
              feedbackEnabled: this.localFeatures.feedbackEnabled,
              roadmapEnabled: this.localFeatures.roadmapEnabled,
              changelogEnabled: this.localFeatures.changelogEnabled,
            },
          },
        })

        this.$emit('updated', response?.data || response)
      } catch (err) {
        // Revert optimistic update
        this.localFeatures[feature] = !value
        toast.error(err?.data?.error?.message || 'Failed to save feature settings')
      } finally {
        this.savingFeature = null
      }
    },
  },
}
</script>
