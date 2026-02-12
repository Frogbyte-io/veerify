<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:settings" class="h-5 w-5" />
          General Settings
        </CardTitle>
        <CardDescription>Configure your product's basic information.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="project-name">Product Name</Label>
          <Input
            id="project-name"
            v-model="form.name"
            placeholder="My Product"
          />
        </div>

        <div class="space-y-2">
          <Label for="project-slug">URL Slug</Label>
          <Input
            id="project-slug"
            :model-value="project.slug"
            disabled
            class="opacity-60"
          />
          <p class="text-xs text-muted-foreground">
            Slug cannot be changed after creation.
          </p>
        </div>

        <div class="space-y-2">
          <Label for="project-description">Description</Label>
          <Textarea
            id="project-description"
            v-model="form.description"
            placeholder="A brief description of your product"
            rows="3"
          />
        </div>

        <div class="space-y-2">
          <Label for="project-domain">Custom Domain</Label>
          <Input
            id="project-domain"
            v-model="form.customDomain"
            placeholder="feedback.yourapp.com"
          />
          <p class="text-xs text-muted-foreground">
            Point a CNAME record to Veerify to use a custom domain.
          </p>
        </div>

      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:eye" class="h-5 w-5" />
          Visibility
        </CardTitle>
        <CardDescription>Control who can see and submit feedback to your product.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">Public Board</p>
            <p class="text-sm text-muted-foreground">
              When enabled, anyone can view and submit feedback without logging in.
            </p>
          </div>
          <Switch
            :checked="form.isPublic"
            @update:checked="form.isPublic = $event"
          />
        </div>

        <div v-if="project.organization" class="rounded-md bg-muted p-3">
          <p class="text-sm">
            <span class="font-medium">Public URL:</span>
            <span class="ml-1 text-muted-foreground">{{ publicUrl }}</span>
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex justify-end">
      <Button :disabled="isSaving || !hasChanges" @click="save">
        <Icon v-if="isSaving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
        Save Changes
      </Button>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsGeneral',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['updated'],
  data() {
    return {
      form: {
        name: this.project.name || '',
        description: this.project.description || '',
        customDomain: this.project.customDomain || '',
        isPublic: this.project.isPublic ?? true,
      },
      isSaving: false,
    }
  },
  computed: {
    hasChanges() {
      return (
        this.form.name !== (this.project.name || '') ||
        this.form.description !== (this.project.description || '') ||
        this.form.customDomain !== (this.project.customDomain || '') ||
        this.form.isPublic !== this.project.isPublic
      )
    },
    publicUrl() {
      const origin = import.meta.client ? window.location.origin : ''
      const orgSlug = this.project.organization?.slug || '...'
      return `${origin}/p/${orgSlug}/${this.project.slug}`
    },
  },
  watch: {
    project: {
      handler(newProject) {
        this.form.name = newProject.name || ''
        this.form.description = newProject.description || ''
        this.form.customDomain = newProject.customDomain || ''
        this.form.isPublic = newProject.isPublic ?? true
      },
      deep: true,
    },
  },
  methods: {
    async save() {
      if (!this.hasChanges) return
      this.isSaving = true

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: {
            name: this.form.name,
            description: this.form.description || null,
            customDomain: this.form.customDomain || null,
            isPublic: this.form.isPublic,
          },
        })

        this.$emit('updated', response.data)
        toast.success('Project settings saved')
      } catch (err) {
        console.error('Error saving project:', err)
        toast.error(err?.data?.error?.message || 'Failed to save project settings')
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>
