<template>
  <div class="space-y-2" data-testid="feedback-attachment-picker">
    <div class="flex items-center justify-between gap-2">
      <Label>Attachments (optional)</Label>
      <span class="text-xs text-muted-foreground">{{ items.length }}/{{ maxCount }}</span>
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      :accept="accept"
      :disabled="disabled"
      @change="onFilesSelected"
    />

    <button
      v-if="items.length < maxCount"
      type="button"
      :disabled="disabled"
      class="flex w-full flex-col items-center gap-1 rounded-md border border-dashed border-input px-3 py-4 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
      @click="$refs.fileInput.click()"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <Icon name="lucide:paperclip" class="h-4 w-4" />
      <span>Add screenshots, logs or PDFs</span>
      <span class="text-xs">Up to {{ maxCount }} files, 10 MB each (png, jpg, webp, gif, pdf, txt, log, json)</span>
    </button>

    <ul v-if="items.length" class="space-y-2">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-center gap-3 rounded-md border bg-card p-2"
        :class="item.status === 'error' ? 'border-destructive/50' : 'border-border'"
      >
        <img
          v-if="item.previewUrl"
          :src="item.previewUrl"
          :alt="item.name"
          class="h-10 w-10 shrink-0 rounded object-cover"
        />
        <div v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Icon :name="iconFor(item.name)" class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ item.name }}</p>
          <p v-if="item.status === 'error'" class="text-xs text-destructive">{{ item.error }}</p>
          <template v-else-if="item.status === 'uploading'">
            <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div class="h-full bg-primary transition-all" :style="{ width: `${item.progress}%` }" />
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ item.progress >= 100 ? 'Verifying...' : `Uploading ${item.progress}%` }}
            </p>
          </template>
          <p v-else class="text-xs text-muted-foreground">{{ formatSize(item.size) }} - ready</p>
        </div>
        <Button
          v-if="item.status === 'error'"
          type="button"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="retry(item)"
        >
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          :aria-label="`Remove ${item.name}`"
          @click="remove(item)"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </Button>
      </li>
    </ul>
    <p v-if="notice" class="text-xs text-destructive">{{ notice }}</p>
  </div>
</template>

<script>
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_ALLOWED_EXTENSIONS,
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_COUNT,
  formatAttachmentSize,
} from '~/lib/feedback-attachment-limits'

let keyCounter = 0

export default {
  name: 'FeedbackAttachmentPicker',
  props: {
    // Upload before the feedback exists (public board / new feedback)...
    projectId: { type: String, default: '' },
    // ...or add to an existing feedback item (author / team member).
    feedbackId: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    // Slots already used by attachments that exist on the feedback item.
    existingCount: { type: Number, default: 0 },
  },
  emits: ['change', 'uploaded'],
  data() {
    return {
      items: [],
      notice: '',
      committed: false,
      accept: FEEDBACK_ATTACHMENT_ACCEPT,
    }
  },
  computed: {
    maxCount() {
      return FEEDBACK_ATTACHMENT_MAX_COUNT - this.existingCount
    },
  },
  beforeUnmount() {
    this.items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    })
    // Uploads that were never submitted are discarded right away; the scheduled
    // cleanup is only the backstop.
    if (!this.committed && !this.feedbackId) {
      this.items
        .filter((item) => item.attachmentId)
        .forEach((item) =>
          $fetch(`/api/feedback-attachments/${item.attachmentId}`, { method: 'DELETE' }).catch(() => {})
        )
    }
  },
  methods: {
    formatSize: formatAttachmentSize,
    iconFor(name) {
      const ext = String(name).split('.').pop().toLowerCase()
      if (ext === 'pdf') return 'lucide:file-text'
      if (ext === 'json') return 'lucide:file-json'
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'lucide:image'
      return 'lucide:file-code'
    },
    emitChange() {
      this.$emit('change', {
        ids: this.items.filter((item) => item.status === 'ready').map((item) => item.attachmentId),
        busy: this.items.some((item) => item.status === 'uploading'),
      })
    },
    /** Called by the parent once the feedback was created so uploads are kept. */
    markCommitted() {
      this.committed = true
    },
    /** Clear the list after a successful submission (does not delete server-side). */
    clear() {
      this.markCommitted()
      this.items.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      })
      this.items = []
      this.notice = ''
      this.emitChange()
    },
    onDrop(event) {
      this.addFiles(Array.from(event.dataTransfer?.files || []))
    },
    onFilesSelected(event) {
      this.addFiles(Array.from(event.target.files || []))
      event.target.value = ''
    },
    addFiles(files) {
      this.notice = ''
      for (const file of files) {
        if (this.items.length >= this.maxCount) {
          this.notice = `You can attach at most ${FEEDBACK_ATTACHMENT_MAX_COUNT} files.`
          break
        }
        const ext = file.name.split('.').pop().toLowerCase()
        const item = {
          key: ++keyCounter,
          file,
          name: file.name,
          size: file.size,
          status: 'uploading',
          progress: 0,
          error: '',
          attachmentId: '',
          previewUrl: file.type.startsWith('image/') && file.type !== 'image/svg+xml' ? URL.createObjectURL(file) : '',
        }
        this.items.push(item)
        // Use the reactive proxy so progress updates render.
        const reactiveItem = this.items[this.items.length - 1]
        if (!FEEDBACK_ATTACHMENT_ALLOWED_EXTENSIONS.includes(ext)) {
          this.fail(reactiveItem, 'This file type is not allowed.')
        } else if (file.size <= 0) {
          this.fail(reactiveItem, 'This file is empty.')
        } else if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
          this.fail(reactiveItem, 'This file is larger than 10 MB.')
        } else {
          this.upload(reactiveItem)
        }
      }
      this.emitChange()
    },
    fail(item, message) {
      item.status = 'error'
      item.error = message
      this.emitChange()
    },
    errorMessage(err, fallback) {
      return err?.data?.error?.message || err?.data?.message || fallback
    },
    async upload(item) {
      item.status = 'uploading'
      item.progress = 0
      item.error = ''
      this.emitChange()
      try {
        const presign = await $fetch('/api/feedback-attachments/presign', {
          method: 'POST',
          body: {
            ...(this.feedbackId ? { feedbackId: this.feedbackId } : { projectId: this.projectId }),
            fileName: item.name,
            contentType: item.file.type || 'application/octet-stream',
            sizeBytes: item.file.size,
          },
        })
        const target = presign.data
        item.attachmentId = target.attachmentId
        await this.putFile(item, target)
        item.progress = 100
        await $fetch(`/api/feedback-attachments/${target.attachmentId}/finalize`, { method: 'POST' })
        item.status = 'ready'
        if (this.feedbackId) {
          // Already attached to the feedback item: hand over to the list, which re-fetches.
          this.items = this.items.filter((entry) => entry.key !== item.key)
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
          this.emitChange()
          this.$emit('uploaded', target.attachmentId)
        } else {
          this.emitChange()
        }
      } catch (err) {
        this.fail(item, this.errorMessage(err, 'Upload failed. Please try again.'))
      }
    },
    putFile(item, target) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open(target.method || 'PUT', target.uploadUrl)
        Object.entries(target.headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value))
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) item.progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve()
          let message = 'Upload failed. Please try again.'
          try {
            message = JSON.parse(xhr.responseText)?.error?.message || message
          } catch {
            // keep the generic message
          }
          reject(Object.assign(new Error(message), { data: { error: { message } } }))
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.send(item.file)
      })
    },
    retry(item) {
      this.upload(item)
    },
    async remove(item) {
      const attachmentId = item.attachmentId
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      this.items = this.items.filter((entry) => entry.key !== item.key)
      this.notice = ''
      this.emitChange()
      if (attachmentId) {
        try {
          await $fetch(`/api/feedback-attachments/${attachmentId}`, { method: 'DELETE' })
        } catch {
          // The scheduled cleanup removes anything left behind.
        }
      }
    },
  },
}
</script>
