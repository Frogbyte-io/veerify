<template>
  <Card data-testid="workspace-settings-privacy">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Icon name="lucide:shield-check" class="h-5 w-5" />
        Data &amp; privacy
      </CardTitle>
      <CardDescription>
        Erase a person's data, and export or delete everything Marketing holds for a project. Turning Marketing off
        hides the data but does not delete it.
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-6">
      <p
        v-if="!canManage"
        class="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid="workspace-privacy-read-only"
      >
        Only workspace owners and admins can change this.
      </p>

      <section class="space-y-2" data-testid="privacy-erase">
        <h3 class="text-sm font-medium">Erase a person's data</h3>
        <p class="text-xs text-muted-foreground">
          Deletes every review request and testimonial for this email address across all of your workspace's projects,
          and makes sure they are never emailed again. Only the opt-out record is kept.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="eraseEmail"
            type="email"
            placeholder="person@example.com"
            class="max-w-xs"
            aria-label="Email address to erase"
            :disabled="erasing || !canManage"
            data-testid="privacy-erase-email"
          />
          <Button
            variant="outline"
            :disabled="erasing || !canManage || !eraseEmail.trim()"
            data-testid="privacy-erase-button"
            @click="eraseOpen = true"
          >
            Erase data
          </Button>
        </div>
        <p v-if="eraseError" class="text-sm text-destructive" role="alert">{{ eraseError }}</p>
        <p v-if="eraseResult" class="text-sm text-muted-foreground" role="status" data-testid="privacy-erase-result">
          Deleted {{ eraseResult.reviewRequestsDeleted }} review request{{
            eraseResult.reviewRequestsDeleted === 1 ? '' : 's'
          }}
          and {{ eraseResult.testimonialsDeleted }} testimonial{{ eraseResult.testimonialsDeleted === 1 ? '' : 's' }}.
          This address will not be contacted again.
        </p>
      </section>

      <section class="space-y-2" data-testid="privacy-export">
        <div v-if="projectsLoading" class="space-y-2">
          <Skeleton class="h-9 w-64" />
        </div>
        <div v-else-if="projectsError" class="flex items-center gap-2 text-sm text-destructive" role="alert">
          {{ projectsError }}
          <Button variant="outline" size="sm" @click="loadProjects">Retry</Button>
        </div>
        <div v-else class="space-y-1.5">
          <Label for="privacy-project">Project</Label>
          <select
            id="privacy-project"
            v-model="selectedProjectId"
            class="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            data-testid="privacy-project-select"
          >
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <h3 class="text-sm font-medium">Export a project's Marketing data</h3>
        <p class="text-xs text-muted-foreground">
          A JSON file with the site, terms, audits, AI visibility answers, mentions, review requests, testimonials,
          competitor changes, launch kit, insights and Search Console metrics. API keys and tokens are never included.
        </p>
        <Button
          variant="outline"
          :disabled="exporting || !selectedProject"
          data-testid="privacy-export-button"
          @click="exportData"
        >
          <Icon
            :name="exporting ? 'lucide:loader-circle' : 'lucide:download'"
            class="mr-2 h-4 w-4"
            :class="exporting ? 'animate-spin' : ''"
          />
          {{ exporting ? 'Exporting...' : 'Download export' }}
        </Button>
        <p v-if="exportError" class="text-sm text-destructive" role="alert">{{ exportError }}</p>
      </section>

      <section class="space-y-2 rounded-md border border-destructive/40 p-4" data-testid="privacy-danger">
        <h3 class="text-sm font-medium text-destructive">Delete a project's Marketing data</h3>
        <p class="text-xs text-muted-foreground">
          Permanently deletes the site, audits, AI visibility results, mentions, competitor watches, insights, Search
          Console connection and data, review requests, testimonials, launch kit and announcement drafts for the
          selected project. Workspace API keys are kept. This cannot be undone.
        </p>
        <Button
          variant="destructive"
          :disabled="!canManage || !selectedProject"
          data-testid="privacy-delete-button"
          @click="openDelete"
        >
          Delete Marketing data
        </Button>
        <p v-if="deleteResult" class="text-sm text-muted-foreground" role="status" data-testid="privacy-delete-result">
          Marketing data deleted.
        </p>
      </section>
    </CardContent>

    <Dialog :open="eraseOpen" @update:open="(open) => (eraseOpen = open)">
      <DialogContent class="sm:max-w-[480px]" data-testid="privacy-erase-dialog">
        <DialogHeader>
          <DialogTitle>Erase data for {{ eraseEmail.trim() }}?</DialogTitle>
          <DialogDescription>
            This permanently deletes their review requests and testimonials across your workspace and stops any future
            Marketing email to them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="erasing" @click="eraseOpen = false">Cancel</Button>
          <Button variant="destructive" :disabled="erasing" data-testid="privacy-erase-confirm" @click="erase">
            {{ erasing ? 'Erasing...' : 'Erase' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="deleteOpen" @update:open="(open) => (deleteOpen = open)">
      <DialogContent class="sm:max-w-[480px]" data-testid="privacy-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete all Marketing data for {{ selectedProject?.name }}?</DialogTitle>
          <DialogDescription>
            Type <strong>{{ selectedProject?.slug }}</strong> to confirm. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <Input
          v-model="confirmText"
          :disabled="deleting"
          :aria-label="`Type ${selectedProject?.slug} to confirm deletion`"
          autocomplete="off"
          data-testid="privacy-delete-confirm-input"
        />
        <p v-if="deleteError" class="text-sm text-destructive" role="alert">{{ deleteError }}</p>
        <DialogFooter>
          <Button variant="outline" :disabled="deleting" @click="deleteOpen = false">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="deleting || confirmText !== selectedProject?.slug"
            data-testid="privacy-delete-confirm"
            @click="deleteData"
          >
            {{ deleting ? 'Deleting...' : 'Delete everything' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>

<script>
import { toast } from 'vue-sonner'
import { apiErrorMessage } from '~/lib/api-error'

export default {
  name: 'WorkspaceDataPrivacy',

  props: {
    /** Workspace owners/admins only */
    canManage: { type: Boolean, default: false },
  },

  emits: ['changed'],

  data() {
    return {
      projects: [],
      projectsLoading: true,
      projectsError: null,
      selectedProjectId: '',
      eraseEmail: '',
      eraseOpen: false,
      erasing: false,
      eraseError: null,
      eraseResult: null,
      exporting: false,
      exportError: null,
      deleteOpen: false,
      confirmText: '',
      deleting: false,
      deleteError: null,
      deleteResult: null,
    }
  },

  computed: {
    selectedProject() {
      return this.projects.find((p) => p.id === this.selectedProjectId) || null
    },
  },

  mounted() {
    this.loadProjects()
  },

  methods: {
    async loadProjects() {
      this.projectsLoading = true
      this.projectsError = null
      try {
        const response = await $fetch('/api/projects')
        this.projects = response?.data || []
        if (!this.projects.some((p) => p.id === this.selectedProjectId)) {
          this.selectedProjectId = this.projects[0]?.id || ''
        }
      } catch (err) {
        this.projectsError = apiErrorMessage(err, 'Failed to load projects')
      } finally {
        this.projectsLoading = false
      }
    },

    async erase() {
      this.erasing = true
      this.eraseError = null
      this.eraseResult = null
      try {
        const response = await $fetch('/api/workspace/erase-contact', {
          method: 'POST',
          body: { email: this.eraseEmail.trim() },
        })
        this.eraseResult = response.data
        this.eraseEmail = ''
        this.eraseOpen = false
        this.$emit('changed')
      } catch (err) {
        this.eraseOpen = false
        this.eraseError = apiErrorMessage(err, 'Could not erase this person’s data')
      } finally {
        this.erasing = false
      }
    },

    async exportData() {
      this.exporting = true
      this.exportError = null
      try {
        const data = await $fetch(`/api/marketing/projects/${this.selectedProject.id}/export`)
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `marketing-${this.selectedProject?.slug}.json`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        toast.success('Export downloaded', { description: `marketing-${this.selectedProject?.slug}.json` })
      } catch (err) {
        this.exportError = apiErrorMessage(err, 'Could not export the data. Try again.')
      } finally {
        this.exporting = false
      }
    },

    // The dialog hands focus back to its trigger as it closes, so move to the page heading after that
    focusPageHeading() {
      setTimeout(() => {
        const heading = document.querySelector('h1')
        if (!heading) return
        heading.setAttribute('tabindex', '-1')
        heading.focus()
      }, 300)
    },

    openDelete() {
      this.confirmText = ''
      this.deleteError = null
      this.deleteOpen = true
    },

    async deleteData() {
      this.deleting = true
      this.deleteError = null
      try {
        await $fetch(`/api/marketing/projects/${this.selectedProject.id}/data`, {
          method: 'DELETE',
          body: { confirm: this.confirmText },
        })
        this.deleteResult = true
        this.deleteOpen = false
        toast.success('Marketing data deleted')
        this.$emit('changed')
        this.focusPageHeading()
      } catch (err) {
        this.deleteError = apiErrorMessage(err, 'Could not delete the data. Try again.')
      } finally {
        this.deleting = false
      }
    },
  },
}
</script>
