<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:palette" class="h-5 w-5" />
          Board Appearance
        </CardTitle>
        <CardDescription>Customize how your public feedback board looks.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="accent-color">Accent Color</Label>
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="form.accentColor"
              class="w-8 h-8 rounded border cursor-pointer"
              @input="form.accentColor = $event.target.value"
            />
            <Input
              id="accent-color"
              v-model="form.accentColor"
              placeholder="#3b82f6"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Used for buttons and links on your public board.
          </p>
        </div>

        <div class="space-y-2">
          <Label for="logo-url">Logo URL</Label>
          <Input
            id="logo-url"
            v-model="form.logoUrl"
            placeholder="https://example.com/logo.png"
          />
          <p class="text-xs text-muted-foreground">
            Displayed in the header of your public feedback board.
          </p>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-sm">Show "Powered by Veerify"</p>
            <p class="text-xs text-muted-foreground">
              Display a small attribution badge on your public board.
            </p>
          </div>
          <Switch
            :checked="form.showPoweredBy"
            @update:checked="form.showPoweredBy = $event"
          />
        </div>

        <div class="flex justify-end">
          <Button :disabled="isSaving || !hasChanges" @click="save">
            <Icon v-if="isSaving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Preview -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:eye" class="h-5 w-5" />
          Preview
        </CardTitle>
        <CardDescription>A preview of your public board header.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="rounded-lg border overflow-hidden">
          <div
            class="p-4 flex items-center gap-3"
            :style="{ backgroundColor: form.accentColor || '#3b82f6' }"
          >
            <img
              v-if="form.logoUrl"
              :src="form.logoUrl"
              alt="Logo"
              class="h-8 w-8 rounded object-cover bg-white/20"
              @error="$event.target.style.display = 'none'"
            />
            <div
              v-else
              class="h-8 w-8 rounded bg-white/20 flex items-center justify-center"
            >
              <Icon name="lucide:message-square" class="w-4 h-4 text-white" />
            </div>
            <div>
              <p class="font-semibold text-white text-sm">{{ project.name }}</p>
              <p class="text-white/70 text-xs">Share your feedback and ideas</p>
            </div>
          </div>
          <div class="p-4 bg-background">
            <div class="flex items-center gap-2 mb-3">
              <div
                class="h-7 rounded-full px-3 flex items-center text-xs font-medium text-white"
                :style="{ backgroundColor: form.accentColor || '#3b82f6' }"
              >
                All
              </div>
              <div class="h-7 rounded-full px-3 flex items-center text-xs font-medium bg-muted text-muted-foreground">
                Feature
              </div>
              <div class="h-7 rounded-full px-3 flex items-center text-xs font-medium bg-muted text-muted-foreground">
                Bug
              </div>
            </div>
            <div class="h-10 rounded-md bg-muted" />
          </div>
          <div v-if="form.showPoweredBy" class="border-t px-4 py-2 text-center">
            <p class="text-xs text-muted-foreground">Powered by Veerify</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsAppearance',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['updated'],
  data() {
    const settings = this.project.settings || {}
    return {
      form: {
        accentColor: settings.accentColor || '#3b82f6',
        logoUrl: settings.logoUrl || '',
        showPoweredBy: settings.showPoweredBy !== false,
      },
      isSaving: false,
    }
  },
  computed: {
    currentSettings() {
      const settings = this.project.settings || {}
      return {
        accentColor: settings.accentColor || '#3b82f6',
        logoUrl: settings.logoUrl || '',
        showPoweredBy: settings.showPoweredBy !== false,
      }
    },
    hasChanges() {
      return (
        this.form.accentColor !== this.currentSettings.accentColor ||
        this.form.logoUrl !== this.currentSettings.logoUrl ||
        this.form.showPoweredBy !== this.currentSettings.showPoweredBy
      )
    },
  },
  watch: {
    project: {
      handler(newProject) {
        const settings = newProject.settings || {}
        this.form.accentColor = settings.accentColor || '#3b82f6'
        this.form.logoUrl = settings.logoUrl || ''
        this.form.showPoweredBy = settings.showPoweredBy !== false
      },
      deep: true,
    },
  },
  methods: {
    async save() {
      if (!this.hasChanges) return
      this.isSaving = true

      try {
        const existingSettings = this.project.settings || {}
        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: {
            settings: {
              ...existingSettings,
              accentColor: this.form.accentColor,
              logoUrl: this.form.logoUrl || null,
              showPoweredBy: this.form.showPoweredBy,
            },
          },
        })

        this.$emit('updated', response.data)
        toast.success('Appearance settings saved')
      } catch (err) {
        console.error('Error saving appearance:', err)
        toast.error(err?.data?.error?.message || 'Failed to save appearance settings')
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>
