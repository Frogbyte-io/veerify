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
          <Input id="project-name" v-model="form.name" placeholder="My Product" />
        </div>

        <div class="space-y-2">
          <Label for="project-slug">URL Slug</Label>
          <Input id="project-slug" v-model="form.slug" placeholder="my-product" />
          <p class="text-xs text-muted-foreground">Used in your public feedback URL.</p>
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
          <Switch v-model="form.isPublic" />
        </div>

        <div v-if="publicUrl" class="rounded-md bg-muted p-3 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm min-w-0">
              <span class="font-medium">Public URL:</span>
              <span class="ml-1 text-muted-foreground break-all">{{ publicUrl }}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="project-visibility-copy-url"
              @click="copyPublicUrl"
            >
              <Icon name="lucide:copy" class="h-4 w-4 mr-2" />
              Copy URL
            </Button>
          </div>
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
import { buildPublicBoardUrl } from '~/lib/public-board-url'

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
        slug: this.project.slug || '',
        description: this.project.description || '',
        isPublic: this.project.isPublic ?? true,
      },
      isSaving: false,
    }
  },
  computed: {
    hasChanges() {
      return (
        this.form.name !== (this.project.name || '') ||
        this.form.slug !== (this.project.slug || '') ||
        this.form.description !== (this.project.description || '') ||
        this.form.isPublic !== this.project.isPublic
      )
    },
    publicUrl() {
      if (!import.meta.client) return ''
      return buildPublicBoardUrl({
        project: this.project,
        projectSlug: this.form.slug || this.project.slug || '...',
        appDomain: useRuntimeConfig().public.appDomain || 'localhost',
        protocol: window.location.protocol,
        port: window.location.port,
      })
    },
  },
  watch: {
    project: {
      handler(newProject) {
        this.form.name = newProject.name || ''
        this.form.slug = newProject.slug || ''
        this.form.description = newProject.description || ''
        this.form.isPublic = newProject.isPublic ?? true
      },
      deep: true,
    },
  },
  methods: {
    async copyPublicUrl() {
      if (!import.meta.client || !this.publicUrl) return

      try {
        await navigator.clipboard.writeText(this.publicUrl)
        toast.success('Public URL copied')
      } catch (err) {
        console.error('Failed to copy public URL:', err)
        toast.error('Could not copy URL. Please copy it manually.')
      }
    },
    async save() {
      if (!this.hasChanges) return
      this.isSaving = true

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: {
            name: this.form.name,
            slug: this.form.slug !== this.project.slug ? this.form.slug : undefined,
            description: this.form.description || null,
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
