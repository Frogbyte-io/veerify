<template>
  <div class="space-y-6" data-testid="changelog-editor">
    <div v-if="isLoading" class="space-y-4">
      <Skeleton class="h-10 w-full" />
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <Card v-else-if="loadError">
      <CardContent class="text-center py-8">
        <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
        <p class="font-medium mb-2">Failed to load the entry</p>
        <p class="text-sm text-muted-foreground mb-4">{{ loadError }}</p>
        <Button variant="outline" @click="load">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Badge :variant="isPublished ? 'default' : 'outline'" class="capitalize">{{ status }}</Badge>
          <a
            v-if="isPublished && publicUrl"
            :href="publicUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            data-testid="changelog-public-link"
          >
            <Icon name="lucide:external-link" class="w-4 h-4" />
            View public page
          </a>
          <NuxtLink
            v-if="isPublished && !isNew"
            :to="{ path: '/marketing/announcements', query: { product: project.slug, entry: entryId } }"
            class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            data-testid="changelog-announcements-link"
          >
            <Icon name="lucide:send" class="w-4 h-4" />
            Draft announcements
          </NuxtLink>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            v-if="!isNew"
            variant="outline"
            class="text-destructive"
            :disabled="isBusy"
            data-testid="changelog-delete"
            @click="showDelete = true"
          >
            <Icon name="lucide:trash-2" class="w-4 h-4 mr-2" />
            Delete
          </Button>
          <Button v-if="isPublished" variant="outline" :disabled="isBusy" @click="unpublish">
            <Icon name="lucide:eye-off" class="w-4 h-4 mr-2" />
            Unpublish
          </Button>
          <Button variant="outline" :disabled="isBusy" data-testid="changelog-save" @click="save()">
            <Icon name="lucide:save" class="w-4 h-4 mr-2" />
            {{ isSaving ? 'Saving...' : 'Save' }}
          </Button>
          <Button v-if="!isPublished" :disabled="isBusy" data-testid="changelog-publish" @click="publish">
            <Icon name="lucide:send" class="w-4 h-4 mr-2" />
            {{ isPublishing ? 'Publishing...' : 'Publish' }}
          </Button>
        </div>
      </div>

      <p v-if="actionError" class="text-sm text-destructive" data-testid="changelog-error">{{ actionError }}</p>

      <div class="space-y-2">
        <Label for="changelog-title">Title</Label>
        <Input id="changelog-title" v-model="title" maxlength="200" placeholder="What shipped?" />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label for="changelog-summary">Summary</Label>
          <span class="text-xs text-muted-foreground">{{ summary.length }}/280</span>
        </div>
        <Textarea
          id="changelog-summary"
          v-model="summary"
          maxlength="280"
          rows="2"
          placeholder="One or two sentences shown in the list"
        />
      </div>

      <div class="space-y-2">
        <Label>Labels</Label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="label in labelOptions"
            :key="label"
            type="button"
            class="rounded-full border px-3 py-1 text-sm capitalize transition-colors"
            :class="labels.includes(label) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
            :aria-pressed="labels.includes(label)"
            :data-testid="`changelog-label-${label}`"
            @click="toggleLabel(label)"
          >
            {{ label }}
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label for="changelog-body">Body (markdown)</Label>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{{ body.length }}/50000</span>
            <Button variant="outline" size="sm" data-testid="changelog-preview-toggle" @click="togglePreview">
              <Icon :name="showPreview ? 'lucide:pencil' : 'lucide:eye'" class="w-4 h-4 mr-2" />
              {{ showPreview ? 'Edit' : 'Preview' }}
            </Button>
          </div>
        </div>

        <template v-if="showPreview">
          <Skeleton v-if="previewLoading" class="h-40 w-full" />
          <div v-else-if="previewError" class="flex items-center gap-2 text-sm text-destructive">
            <span>{{ previewError }}</span>
            <Button variant="outline" size="sm" @click="loadPreview">Retry</Button>
          </div>
          <!-- Safe: html is produced and sanitised by the server (renderMarkdown allowlist) -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            v-else
            class="changelog-prose rounded-md border p-4 min-h-40"
            data-testid="changelog-preview"
            v-html="previewHtml"
          />
        </template>
        <Textarea
          v-else
          id="changelog-body"
          v-model="body"
          maxlength="50000"
          rows="16"
          class="font-mono text-sm"
          placeholder="Write the release notes in markdown"
        />
      </div>

      <div class="space-y-2">
        <Label for="changelog-feedback-search">Shipped feedback</Label>
        <div v-if="linkedFeedback.length > 0" class="flex flex-wrap gap-2">
          <span
            v-for="item in linkedFeedback"
            :key="item.id"
            class="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm"
          >
            <span class="max-w-64 truncate">{{ item.title }}</span>
            <button type="button" class="text-muted-foreground hover:text-foreground" @click="unlink(item.id)">
              <Icon name="lucide:x" class="w-3 h-3" />
              <span class="sr-only">Remove {{ item.title }}</span>
            </button>
          </span>
        </div>
        <Input
          id="changelog-feedback-search"
          v-model="searchQuery"
          placeholder="Search feedback to link"
          :disabled="linkedFeedback.length >= 50"
          @input="onSearchInput"
        />
        <p v-if="searchError" class="text-sm text-destructive">{{ searchError }}</p>
        <Skeleton v-if="searching" class="h-8 w-full" />
        <ul v-else-if="searchResults.length > 0" class="rounded-md border divide-y">
          <li v-for="result in searchResults" :key="result.id">
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2"
              @click="link(result)"
            >
              <span class="truncate">{{ result.title }}</span>
              <Icon name="lucide:plus" class="w-4 h-4 shrink-0" />
            </button>
          </li>
        </ul>
        <p v-else-if="searched" class="text-sm text-muted-foreground">No matching feedback</p>
      </div>
    </template>

    <Dialog :open="showDelete" @update:open="showDelete = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this entry?</DialogTitle>
          <DialogDescription>
            This permanently deletes "{{ title }}". If it is published, its public page disappears.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="isDeleting" @click="showDelete = false">Cancel</Button>
          <Button variant="destructive" :disabled="isDeleting" data-testid="changelog-delete-confirm" @click="remove">
            {{ isDeleting ? 'Deleting...' : 'Delete' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { apiErrorMessage } from '~/lib/api-error'
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { hasUnsavedChanges, resolveLinkedFeedback, snapshotPayload } from '~/lib/changelog-editor'

const LEAVE_MESSAGE = 'You have unsaved changes. Leave without saving?'

export default {
  name: 'ChangelogEntryEditor',

  props: {
    project: { type: Object, required: true },
    teamSlug: { type: String, default: '' },
    // 'new' creates a draft on first save
    entryId: { type: String, required: true },
  },

  data() {
    return {
      isLoading: true,
      loadError: null,
      actionError: null,
      id: null,
      slug: '',
      status: 'draft',
      title: '',
      summary: '',
      body: '',
      labels: [],
      linkedFeedback: [],
      labelOptions: ['new', 'improved', 'fixed'],
      isSaving: false,
      isPublishing: false,
      isDeleting: false,
      showDelete: false,
      showPreview: false,
      previewHtml: '',
      previewLoading: false,
      previewError: null,
      searchQuery: '',
      searchResults: [],
      searching: false,
      searched: false,
      searchError: null,
      searchTimer: null,
      searchSeq: 0,
      savedSnapshot: null,
      removeRouteGuard: null,
    }
  },

  computed: {
    isNew() {
      return this.id === null
    },
    isPublished() {
      return this.status === 'published'
    },
    isDirty() {
      return hasUnsavedChanges(this.payload(), this.savedSnapshot)
    },
    isBusy() {
      return this.isSaving || this.isPublishing || this.isDeleting
    },
    base() {
      return `/api/changelog/projects/${this.project.id}`
    },
    publicUrl() {
      if (!import.meta.client || !this.slug) return ''
      const boardUrl = buildPublicBoardUrl({
        project: this.project,
        teamSlug: this.teamSlug || '...',
        appDomain: useRuntimeConfig().public.appDomain || 'localhost',
        protocol: window.location.protocol,
        port: window.location.port,
      })
      return `${boardUrl}/changelog/${this.slug}`
    },
  },

  watch: {
    // Route changes to another entry reload; the replace after the first save
    // of a new entry already matches `id` and must not reload.
    async entryId(next) {
      if (next === this.id) return
      this.id = null
      await this.load()
    },
  },

  async mounted() {
    // Router guard (this component is not a route component, so no beforeRouteLeave)
    this.removeRouteGuard = this.$router.beforeEach((to, from) => {
      if (to.path === from.path || !this.isDirty || this.isDeleting) return true
      return window.confirm(LEAVE_MESSAGE)
    })
    window.addEventListener('beforeunload', this.onBeforeUnload)
    await this.load()
  },

  beforeUnmount() {
    clearTimeout(this.searchTimer)
    if (this.removeRouteGuard) this.removeRouteGuard()
    window.removeEventListener('beforeunload', this.onBeforeUnload)
  },

  methods: {
    applyEntry(entry) {
      this.id = entry.id
      this.slug = entry.slug
      this.status = entry.status
      this.title = entry.title
      this.summary = entry.summary || ''
      this.body = entry.body || ''
      this.labels = [...(entry.labels || [])]
      this.linkedFeedback = resolveLinkedFeedback(this.linkedFeedback, entry)
      this.savedSnapshot = snapshotPayload(this.payload())
    },

    onBeforeUnload(event) {
      if (!this.isDirty) return
      event.preventDefault()
      event.returnValue = ''
    },

    async load() {
      this.loadError = null
      if (this.entryId === 'new') {
        this.slug = ''
        this.status = 'draft'
        this.title = ''
        this.summary = ''
        this.body = ''
        this.labels = []
        this.linkedFeedback = []
        this.savedSnapshot = snapshotPayload(this.payload())
        this.isLoading = false
        return
      }
      this.isLoading = true
      try {
        const response = await $fetch(`${this.base}/entries/${this.entryId}`)
        this.applyEntry(response.data)
      } catch (err) {
        this.loadError = apiErrorMessage(err, 'Failed to load the entry')
      } finally {
        this.isLoading = false
      }
    },

    payload() {
      return {
        title: this.title.trim(),
        summary: this.summary.trim() || null,
        body: this.body,
        labels: this.labels,
        feedbackIds: this.linkedFeedback.map((item) => item.id),
      }
    },

    /** Saves the entry. Returns true on success. */
    async save({ quiet = false } = {}) {
      this.actionError = null
      if (!this.title.trim()) {
        this.actionError = 'Title is required'
        return false
      }
      this.isSaving = true
      try {
        if (this.isNew) {
          const response = await $fetch(`${this.base}/entries`, { method: 'POST', body: this.payload() })
          this.applyEntry(response.data)
          // Move to the saved entry's URL without remounting the editor
          this.$router.replace({ path: `/dashboard/changelog/${this.id}`, query: this.$route.query })
        } else {
          const response = await $fetch(`${this.base}/entries/${this.id}`, { method: 'PUT', body: this.payload() })
          this.applyEntry(response.data)
        }
        if (!quiet) toast.success('Saved')
        return true
      } catch (err) {
        this.actionError = apiErrorMessage(err, 'Failed to save the entry')
        return false
      } finally {
        this.isSaving = false
      }
    },

    async publish() {
      if (!(await this.save({ quiet: true }))) return
      this.isPublishing = true
      try {
        const response = await $fetch(`${this.base}/entries/${this.id}/publish`, { method: 'POST' })
        this.applyEntry(response.data)
        toast.success('Published')
      } catch (err) {
        this.actionError = apiErrorMessage(err, 'Failed to publish the entry')
      } finally {
        this.isPublishing = false
      }
    },

    async unpublish() {
      this.actionError = null
      this.isPublishing = true
      try {
        const response = await $fetch(`${this.base}/entries/${this.id}/unpublish`, { method: 'POST' })
        this.applyEntry(response.data)
        toast.success('Moved back to draft')
      } catch (err) {
        this.actionError = apiErrorMessage(err, 'Failed to unpublish the entry')
      } finally {
        this.isPublishing = false
      }
    },

    async remove() {
      this.isDeleting = true
      try {
        await $fetch(`${this.base}/entries/${this.id}`, { method: 'DELETE' })
        toast.success('Entry deleted')
        this.showDelete = false
        await navigateTo({ path: '/dashboard/changelog', query: { product: this.project.slug } })
      } catch (err) {
        this.showDelete = false
        this.actionError = apiErrorMessage(err, 'Failed to delete the entry')
      } finally {
        this.isDeleting = false
      }
    },

    toggleLabel(label) {
      this.labels = this.labels.includes(label) ? this.labels.filter((l) => l !== label) : [...this.labels, label]
    },

    async togglePreview() {
      this.showPreview = !this.showPreview
      if (this.showPreview) await this.loadPreview()
    },

    async loadPreview() {
      this.previewLoading = true
      this.previewError = null
      try {
        const response = await $fetch(`${this.base}/preview`, { method: 'POST', body: { body: this.body } })
        this.previewHtml = response?.data?.html || ''
      } catch (err) {
        this.previewError = apiErrorMessage(err, 'Failed to render the preview')
      } finally {
        this.previewLoading = false
      }
    },

    onSearchInput() {
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(this.runSearch, 250)
    },

    async runSearch() {
      const q = this.searchQuery.trim()
      if (!q) {
        this.searchResults = []
        this.searched = false
        this.searchError = null
        return
      }
      const seq = ++this.searchSeq
      this.searching = true
      this.searchError = null
      try {
        const response = await $fetch(`${this.base}/feedback-search`, { query: { q } })
        if (seq !== this.searchSeq) return
        const linked = new Set(this.linkedFeedback.map((item) => item.id))
        this.searchResults = (response?.data?.results || []).filter((item) => !linked.has(item.id))
        this.searched = true
      } catch (err) {
        if (seq !== this.searchSeq) return
        this.searchError = apiErrorMessage(err, 'Failed to search feedback')
      } finally {
        if (seq === this.searchSeq) this.searching = false
      }
    },

    link(result) {
      if (this.linkedFeedback.length >= 50) return
      this.linkedFeedback = [...this.linkedFeedback, { id: result.id, title: result.title }]
      this.searchResults = this.searchResults.filter((item) => item.id !== result.id)
    },

    unlink(id) {
      this.linkedFeedback = this.linkedFeedback.filter((item) => item.id !== id)
    },
  },
}
</script>

<style scoped>
.changelog-prose :deep(h2),
.changelog-prose :deep(h3),
.changelog-prose :deep(h4) {
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.changelog-prose :deep(p) {
  margin: 0.5rem 0;
}
.changelog-prose :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
}
.changelog-prose :deep(ol) {
  list-style: decimal;
  padding-left: 1.5rem;
}
.changelog-prose :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.changelog-prose :deep(code) {
  background: var(--muted);
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
}
.changelog-prose :deep(pre) {
  background: var(--muted);
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
}
.changelog-prose :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 1rem;
  color: var(--muted-foreground);
}
.changelog-prose :deep(img) {
  max-width: 100%;
}
</style>
