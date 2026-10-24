<template>
  <Card data-testid="workspace-projects">
    <CardHeader>
      <div class="flex items-center justify-between gap-3">
        <div>
          <CardTitle class="flex items-center gap-2">
            <Icon name="lucide:folder-kanban" class="h-5 w-5" />
            Projects
          </CardTitle>
          <CardDescription
            >Projects you can open in this workspace. Tools and people are set per project.</CardDescription
          >
        </div>
        <Button v-if="canCreate" size="sm" data-testid="workspace-project-create" @click="openCreate">
          <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
          New project
        </Button>
      </div>
    </CardHeader>

    <CardContent class="space-y-3">
      <p v-if="!canCreate" class="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon name="lucide:lock" class="h-3.5 w-3.5" />
        Only workspace owners and admins can change this.
      </p>

      <div v-if="isLoading" class="space-y-2">
        <Skeleton v-for="i in 3" :key="i" class="h-16 w-full" />
      </div>

      <div v-else-if="error" class="py-4 text-center" data-testid="workspace-projects-error">
        <p class="mb-2 text-sm text-destructive">{{ error }}</p>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <p v-else-if="projects.length === 0" class="py-4 text-center text-sm text-muted-foreground">No projects yet.</p>

      <div v-else class="space-y-2">
        <div
          v-for="project in projects"
          :key="project.id"
          class="flex items-center justify-between gap-3 rounded-lg border p-3"
          :data-testid="`workspace-project-${project.slug}`"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ project.name }}</p>
            <p class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" class="capitalize">{{ project.role }}</Badge>
              <Badge variant="outline">{{
                project.accessMode === 'restricted' ? 'Restricted' : 'Whole workspace'
              }}</Badge>
              <Badge variant="outline">{{ project.isPublic ? 'Public' : 'Private' }}</Badge>
              <span>{{ project.productCount }} product{{ project.productCount === 1 ? '' : 's' }}</span>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="openingId !== null"
            @click="openSettings(project)"
          >
            <Icon v-if="openingId === project.id" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Open settings
          </Button>
        </div>
      </div>
    </CardContent>

    <Dialog v-model:open="createOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>New projects are open to everyone in the workspace by default.</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="create">
          <div class="space-y-1.5">
            <Label for="workspace-project-name">Project name</Label>
            <Input
              id="workspace-project-name"
              v-model="newName"
              data-testid="workspace-project-name"
              maxlength="80"
              :disabled="isCreating"
            />
          </div>
          <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>
          <DialogFooter>
            <Button type="button" variant="outline" :disabled="isCreating" @click="createOpen = false">Cancel</Button>
            <Button type="submit" :disabled="isCreating || !newName.trim()">
              <Icon v-if="isCreating" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </Card>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'
import { clearDashboardBootstrapCache } from '~/lib/dashboard-bootstrap-client'

export default {
  name: 'WorkspaceProjects',

  props: {
    /** Workspace owners/admins can create projects */
    canCreate: { type: Boolean, default: false },
  },

  data() {
    return {
      projects: [],
      isLoading: true,
      error: null,
      openingId: null,
      createOpen: false,
      newName: '',
      isCreating: false,
      createError: null,
    }
  },

  mounted() {
    this.load()
  },

  methods: {
    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch('/api/projects')
        this.projects = response?.data || []
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load projects')
      } finally {
        this.isLoading = false
      }
    },

    announceActiveProjectChanged(projectId) {
      clearDashboardBootstrapCache()
      if (import.meta.client) {
        window.dispatchEvent(new CustomEvent('veerify:active-project-changed', { detail: { projectId } }))
      }
    },

    async activate(projectId) {
      await $fetch('/api/projects/active', { method: 'POST', body: { projectId } })
      this.announceActiveProjectChanged(projectId)
    },

    async openSettings(project) {
      this.openingId = project.id
      try {
        await this.activate(project.id)
        await navigateTo('/project/settings')
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to open the project')
      } finally {
        this.openingId = null
      }
    },

    openCreate() {
      this.newName = ''
      this.createError = null
      this.createOpen = true
    },

    async create() {
      const name = this.newName.trim()
      if (!name || this.isCreating) return
      this.isCreating = true
      this.createError = null
      try {
        await $fetch('/api/projects', { method: 'POST', body: { name } })
        this.createOpen = false
        await this.load()
        // The switcher lists accessible projects, so let it refresh.
        this.announceActiveProjectChanged(null)
      } catch (err) {
        this.createError = apiErrorMessage(err, 'Failed to create project')
      } finally {
        this.isCreating = false
      }
    },
  },
}
</script>
