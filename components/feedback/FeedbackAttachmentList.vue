<template>
  <div v-if="isLoading" class="space-y-2" data-testid="feedback-attachments-loading">
    <Skeleton class="h-4 w-24" />
    <div class="flex gap-2">
      <Skeleton class="h-20 w-20 rounded-md" />
      <Skeleton class="h-20 w-20 rounded-md" />
    </div>
  </div>

  <div
    v-else-if="error"
    class="flex items-center gap-3 text-sm text-muted-foreground"
    data-testid="feedback-attachments-error"
  >
    <Icon name="lucide:alert-circle" class="h-4 w-4 text-destructive" />
    <span>Could not load attachments.</span>
    <Button type="button" variant="outline" size="sm" @click="load">Retry</Button>
  </div>

  <div v-else-if="attachments.length || canUpload" class="space-y-3" data-testid="feedback-attachments">
    <div v-if="attachments.length" class="space-y-3">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Attachments ({{ attachments.length }})
      </p>

      <div v-if="images.length" class="flex flex-wrap gap-2">
        <div v-for="file in images" :key="file.id" class="group relative">
          <a :href="file.url" target="_blank" rel="noopener noreferrer" :title="file.fileName">
            <img
              :src="file.url"
              :alt="file.fileName"
              loading="lazy"
              class="h-24 w-24 rounded-md border border-border object-cover transition-opacity hover:opacity-90"
            />
          </a>
          <button
            v-if="file.canDelete"
            type="button"
            class="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow group-hover:flex focus-visible:flex"
            :aria-label="`Remove ${file.fileName}`"
            :disabled="removingId === file.id"
            @click="removeAttachment(file)"
          >
            <Icon name="lucide:x" class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div v-if="others.length" class="flex flex-wrap gap-2">
        <div
          v-for="file in others"
          :key="file.id"
          class="flex max-w-full items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-sm"
        >
          <Icon :name="iconFor(file)" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <a :href="file.url" download class="max-w-[200px] truncate hover:underline" :title="file.fileName">
            {{ file.fileName }}
          </a>
          <span class="shrink-0 text-xs text-muted-foreground">{{ formatSize(file.sizeBytes) }}</span>
          <button
            v-if="file.canDelete"
            type="button"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-muted"
            :aria-label="`Remove ${file.fileName}`"
            :disabled="removingId === file.id"
            @click="removeAttachment(file)"
          >
            <Icon name="lucide:x" class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p v-if="removeError" class="text-xs text-destructive">{{ removeError }}</p>
    </div>

    <FeedbackAttachmentPicker
      v-if="canUpload && attachments.length < maxCount"
      :feedback-id="feedbackId"
      :existing-count="attachments.length"
      @uploaded="load"
    />
  </div>
</template>

<script>
import { formatAttachmentSize } from '~/lib/feedback-attachment-limits'

// Refresh signed URLs shortly before they expire so long-open dialogs keep working.
const REFRESH_MARGIN_MS = 30 * 1000

export default {
  name: 'FeedbackAttachmentList',
  props: {
    feedbackId: { type: String, required: true },
  },
  data() {
    return {
      attachments: [],
      canUpload: false,
      maxCount: 5,
      isLoading: true,
      error: false,
      removingId: '',
      removeError: '',
      refreshTimer: null,
    }
  },
  computed: {
    images() {
      return this.attachments.filter((file) => file.kind === 'image')
    },
    others() {
      return this.attachments.filter((file) => file.kind !== 'image')
    },
  },
  watch: {
    feedbackId() {
      this.isLoading = true
      this.load()
    },
  },
  async mounted() {
    await this.load()
  },
  beforeUnmount() {
    clearTimeout(this.refreshTimer)
  },
  methods: {
    formatSize: formatAttachmentSize,
    iconFor(file) {
      if (file.contentType === 'application/pdf') return 'lucide:file-text'
      if (file.contentType === 'application/json') return 'lucide:file-json'
      return 'lucide:file-code'
    },
    async load() {
      this.error = false
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/attachments`)
        this.attachments = response?.data?.attachments || []
        this.canUpload = Boolean(response?.data?.canUpload)
        this.maxCount = response?.data?.maxCount || 5
        this.scheduleRefresh()
      } catch (err) {
        // Not visible to this viewer (hidden / private / support-derived): show nothing rather than an error.
        if (err?.statusCode === 404 || err?.status === 404) {
          this.attachments = []
          this.canUpload = false
        } else {
          this.error = true
        }
      } finally {
        this.isLoading = false
      }
    },
    scheduleRefresh() {
      clearTimeout(this.refreshTimer)
      if (!import.meta.client || !this.attachments.length) return
      const soonest = Math.min(...this.attachments.map((file) => new Date(file.urlExpiresAt).getTime()))
      const delay = Math.max(10 * 1000, soonest - Date.now() - REFRESH_MARGIN_MS)
      this.refreshTimer = setTimeout(() => this.load(), delay)
    },
    async removeAttachment(file) {
      this.removingId = file.id
      this.removeError = ''
      try {
        await $fetch(`/api/feedback-attachments/${file.id}`, { method: 'DELETE' })
        this.attachments = this.attachments.filter((entry) => entry.id !== file.id)
      } catch (err) {
        this.removeError = err?.data?.error?.message || 'Could not remove the attachment. Please try again.'
      } finally {
        this.removingId = ''
      }
    },
  },
}
</script>
