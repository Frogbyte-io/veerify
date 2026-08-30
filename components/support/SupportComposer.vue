<template>
  <div
    class="border-t p-3 transition-colors"
    :class="isNote ? 'bg-amber-500/10 dark:bg-amber-500/[0.08] border-t-amber-400/70' : 'bg-background'"
    :data-testid="`support-composer-${mode}`"
    :data-composer-mode="mode"
  >
    <div class="flex items-center gap-1 mb-2">
      <button
        type="button"
        data-testid="support-composer-mode-reply"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        :class="
          !isNote ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        "
        :aria-pressed="!isNote"
        @click="setMode('reply')"
      >
        <Icon name="lucide:reply" class="w-3.5 h-3.5" />Reply
      </button>
      <button
        type="button"
        data-testid="support-composer-mode-note"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        :class="
          isNote
            ? 'bg-amber-500 text-white dark:bg-amber-500 dark:text-amber-950'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        "
        :aria-pressed="isNote"
        @click="setMode('note')"
      >
        <Icon name="lucide:lock" class="w-3.5 h-3.5" />Internal note
      </button>
      <span
        v-if="isNote"
        data-testid="support-composer-note-caption"
        class="ml-auto text-xs font-medium text-amber-700 dark:text-amber-400"
        >Only your team will see this</span
      >
      <span v-else class="ml-auto text-xs text-muted-foreground">Visible to the customer</span>
    </div>

    <textarea
      ref="input"
      v-model="draft"
      data-testid="support-composer-input"
      rows="3"
      :placeholder="placeholder"
      :disabled="submitting"
      class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      :class="isNote ? 'border-amber-400/70' : 'border-input'"
      @keydown.ctrl.enter.prevent="submit"
      @keydown.meta.enter.prevent="submit"
    />

    <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 mt-2" data-testid="support-composer-attachments">
      <div
        v-for="attachment in attachments"
        :key="attachment.clientId"
        class="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
        :class="attachment.phase === 'expired' || attachment.phase === 'failed' ? 'border-destructive/60' : ''"
        :data-testid="`support-composer-attachment-${attachment.clientId}`"
        :data-phase="attachment.phase"
      >
        <Icon
          v-if="attachment.phase === 'uploading' || attachment.phase === 'completing'"
          name="lucide:loader-circle"
          class="w-3.5 h-3.5 animate-spin text-muted-foreground"
        />
        <Icon
          v-else-if="attachment.phase === 'failed' || attachment.phase === 'expired'"
          name="lucide:alert-circle"
          class="w-3.5 h-3.5 text-destructive"
        />
        <Icon
          v-else-if="attachment.phase === 'ready'"
          name="lucide:check-circle-2"
          class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"
        />
        <Icon v-else name="lucide:paperclip" class="w-3.5 h-3.5 text-muted-foreground" />
        <span
          class="max-w-[12rem] truncate"
          :class="attachment.phase === 'failed' || attachment.phase === 'expired' ? 'text-destructive' : ''"
          >{{ attachment.fileName }}</span
        >
        <span class="text-muted-foreground">{{ formatBytes(attachment.sizeBytes) }}</span>
        <progress
          v-if="attachment.phase === 'uploading' && attachment.progress !== null"
          class="h-1.5 w-16 accent-primary"
          role="progressbar"
          :value="attachment.progress"
          max="100"
          :aria-label="`Uploading ${attachment.fileName}`"
          :data-testid="`support-composer-attachment-${attachment.clientId}-progress`"
        />
        <span
          class="text-muted-foreground max-w-[11rem] truncate"
          role="status"
          aria-live="polite"
          :data-testid="`support-composer-attachment-${attachment.clientId}-status`"
          >{{ attachmentStatus(attachment) }}</span
        >
        <span
          v-if="attachment.phase === 'uploading' && attachment.progress !== null"
          class="text-muted-foreground"
          aria-hidden="true"
          >{{ attachment.progress }}%</span
        >
        <button
          v-if="attachment.phase === 'failed'"
          type="button"
          class="text-xs text-primary underline hover:no-underline"
          :aria-label="`Retry upload for ${attachment.fileName}`"
          :data-testid="`support-composer-attachment-${attachment.clientId}-retry`"
          :disabled="submitting"
          @click="retryAttachment(attachment)"
        >
          Retry
        </button>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground disabled:opacity-50"
          :aria-label="`Remove ${attachment.fileName}`"
          :data-testid="`support-composer-attachment-${attachment.clientId}-remove`"
          :disabled="submitting"
          @click="removeAttachment(attachment.clientId)"
        >
          <Icon name="lucide:x" class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
    <p
      v-if="expiredAttachment"
      class="mt-2 text-xs text-destructive"
      role="alert"
      data-testid="support-composer-expired-error"
    >
      {{ expiredCopy }}
    </p>

    <div class="flex items-center justify-between mt-2">
      <div class="flex items-center gap-2">
        <p class="text-xs text-muted-foreground">
          <template v-if="isNote">Internal notes are stored on the ticket and never emailed.</template
          ><template v-else>Replies are stored on the ticket. Sending by email arrives in a later stage.</template>
        </p>
        <button
          v-if="!isNote"
          type="button"
          data-testid="support-composer-attach"
          class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          :disabled="submitting || attachments.length >= maxAttachmentFiles"
          @click="openFilePicker"
        >
          <Icon name="lucide:paperclip" class="w-3.5 h-3.5" />Attach
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
          class="hidden"
          data-testid="support-composer-file-input"
          @change="onFilesSelected"
        >
      </div>
      <Button
        size="sm"
        data-testid="support-composer-submit"
        :disabled="!canSubmit"
        :class="isNote ? 'bg-amber-500 hover:bg-amber-600 text-white dark:text-amber-950' : ''"
        @click="submit"
      >
        <Icon v-if="submitting" name="lucide:loader-circle" class="w-3.5 h-3.5 mr-1.5 animate-spin" /><Icon
          v-else
          :name="isNote ? 'lucide:lock' : 'lucide:send'"
          class="w-3.5 h-3.5 mr-1.5"
        />{{ isNote ? 'Add internal note' : 'Send reply' }}
      </Button>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

const MAX_ATTACHMENT_FILES = 10
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
])
const EXPIRED_COPY = 'This attachment expired. Remove it and upload the file again.'

let clientIdCounter = 0
function nextClientId() {
  clientIdCounter += 1
  return `att-${clientIdCounter}`
}

export default {
  name: 'SupportComposer',
  props: { conversationId: { type: String, required: true } },
  emits: ['posted'],

  data() {
    return { mode: 'reply', draft: '', submitting: false, attachments: [], conversationGeneration: 0 }
  },

  computed: {
    isNote() {
      return this.mode === 'note'
    },
    maxAttachmentFiles() {
      return MAX_ATTACHMENT_FILES
    },
    expiredCopy() {
      return EXPIRED_COPY
    },
    placeholder() {
      return this.isNote ? 'Write an internal note for your team…' : 'Write a reply to the customer…'
    },
    expiredAttachment() {
      return this.attachments.some((attachment) => attachment.phase === 'expired')
    },
    canSubmit() {
      const blocked = new Set(['preparing', 'uploading', 'completing', 'failed', 'expired'])
      return (
        !this.submitting &&
        this.draft.trim().length > 0 &&
        !(this.isNote && this.attachments.length > 0) &&
        !this.attachments.some((attachment) => blocked.has(attachment.phase))
      )
    },
  },

  watch: {
    conversationId() {
      this.conversationGeneration += 1
      this.abortUploads()
      this.draft = ''
      this.mode = 'reply'
      this.submitting = false
      this.attachments = []
    },
  },

  beforeUnmount() {
    this.abortUploads()
  },

  methods: {
    setMode(mode) {
      if (this.submitting) return
      if (mode === 'note' && this.attachments.length > 0) {
        toast.warning('Remove attachments before switching to an internal note.')
        return
      }
      this.mode = mode
    },

    syncExpiredAttachments() {
      const now = Date.now()
      for (const attachment of this.attachments) {
        if (attachment.expiresAt && new Date(attachment.expiresAt).getTime() <= now) this.markExpired(attachment)
      }
    },

    async submit() {
      this.syncExpiredAttachments()
      if (!this.canSubmit) return
      const submitConversationId = this.conversationId
      const submitGeneration = this.conversationGeneration
      this.submitting = true
      const kind = this.isNote ? 'note' : 'outgoing'
      const body = this.draft.trim()
      const attachments = this.attachments.map((attachment) => ({ uploadId: attachment.uploadId }))
      try {
        await $fetch(`/api/support/conversations/${submitConversationId}/messages`, {
          method: 'POST',
          body: attachments.length > 0 ? { kind, body, attachments } : { kind, body },
        })
        if (submitGeneration !== this.conversationGeneration || submitConversationId !== this.conversationId) return
        this.clearAttachmentTimers()
        this.draft = ''
        this.attachments = []
        this.$emit('posted')
      } catch (err) {
        if (submitGeneration !== this.conversationGeneration || submitConversationId !== this.conversationId) return
        toast.error(err?.data?.error?.message || 'Failed to post message')
      } finally {
        if (submitGeneration === this.conversationGeneration && submitConversationId === this.conversationId)
          this.submitting = false
      }
    },

    openFilePicker() {
      if (!this.submitting && !this.isNote) this.$refs.fileInput?.click()
    },

    async onFilesSelected(event) {
      const files = Array.from(event.target.files || [])
      event.target.value = ''
      if (files.length === 0) return
      if (this.attachments.length + files.length > MAX_ATTACHMENT_FILES) {
        toast.error(`You can attach up to ${MAX_ATTACHMENT_FILES} files.`)
        return
      }
      const existingBytes = this.attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0)
      if (existingBytes + files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
        toast.error('Attachments must be 25 MB or less in total.')
        return
      }
      for (const file of files) this.addAttachment(file)
    },

    addAttachment(file) {
      const clientId = nextClientId()
      const contentType = (file.type || 'application/octet-stream').toLowerCase()
      const entry = {
        clientId,
        file,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        uploadId: null,
        expiresAt: null,
        progress: null,
        phase: 'preparing',
        error: null,
        xhr: null,
        expiryTimer: null,
        cancelled: false,
      }
      this.attachments.push(entry)
      if (file.size === 0) {
        entry.phase = 'failed'
        entry.error = 'empty files are not allowed'
        return
      }
      if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
        entry.phase = 'failed'
        entry.error = 'unsupported file type'
        return
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        entry.phase = 'failed'
        entry.error = 'too large (max 10 MB)'
        return
      }
      void this.startUpload(entry)
    },

    async startUpload(entry) {
      const uploadConversationId = this.conversationId
      const uploadGeneration = this.conversationGeneration
      this.clearExpiryTimer(entry)
      entry.uploadId = null
      entry.expiresAt = null
      entry.progress = null
      entry.cancelled = false
      entry.phase = 'preparing'
      entry.error = null
      try {
        const response = await $fetch('/api/support/attachments/presign', {
          method: 'POST',
          body: {
            conversationId: uploadConversationId,
            filename: entry.fileName,
            contentType: entry.contentType,
            sizeBytes: entry.sizeBytes,
          },
        })
        if (!this.isUploadCurrent(entry, uploadConversationId, uploadGeneration)) return
        const target = response?.data
        if (
          typeof target?.uploadId !== 'string' ||
          target.uploadId.length === 0 ||
          typeof target?.uploadUrl !== 'string' ||
          target.uploadUrl.length === 0
        )
          throw new Error('Upload target was incomplete')
        if (String(target.method || 'PUT').toUpperCase() !== 'PUT') throw new Error('Upload target method was invalid')
        if (!target.headers || typeof target.headers !== 'object' || Array.isArray(target.headers))
          throw new Error('Upload target headers were invalid')
        const expiresAt = new Date(target.expiresAt || '').getTime()
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Upload target expiry was invalid')
        entry.uploadId = target.uploadId
        entry.expiresAt = target.expiresAt || null
        this.scheduleExpiry(entry)
        entry.phase = 'uploading'
        await this.uploadBytes(entry, target)
        if (!this.isUploadCurrent(entry, uploadConversationId, uploadGeneration)) return
        const uploadUrl = new URL(target.uploadUrl, window.location.origin)
        const isProxyTarget =
          uploadUrl.origin === window.location.origin &&
          uploadUrl.pathname.startsWith('/api/support/attachments/upload/')
        if (!isProxyTarget) {
          entry.phase = 'completing'
          await $fetch(`/api/support/attachments/${encodeURIComponent(entry.uploadId)}/complete`, { method: 'POST' })
        }
        if (!this.isUploadCurrent(entry, uploadConversationId, uploadGeneration)) return
        entry.phase = 'ready'
        entry.progress = 100
      } catch (err) {
        if (!this.isUploadCurrent(entry, uploadConversationId, uploadGeneration)) return
        this.clearExpiryTimer(entry)
        entry.phase = 'failed'
        entry.error = err?.data?.error?.message || err?.message || 'upload failed'
      }
    },

    isUploadCurrent(entry, conversationId, generation) {
      return (
        !entry.cancelled &&
        this.attachments.includes(entry) &&
        this.conversationId === conversationId &&
        this.conversationGeneration === generation
      )
    },

    uploadBytes(entry, target) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        entry.xhr = xhr
        xhr.open(target.method || 'PUT', target.uploadUrl)
        for (const [name, value] of Object.entries(target.headers || {})) xhr.setRequestHeader(name, value)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) entry.progress = Math.min(100, Math.round((event.loaded / event.total) * 100))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.onabort = () => reject(new Error('Upload aborted'))
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed')))
        xhr.send(entry.file)
      }).finally(() => {
        entry.xhr = null
      })
    },

    scheduleExpiry(entry) {
      this.clearExpiryTimer(entry)
      if (!entry.expiresAt) return
      entry.expiryTimer = setTimeout(
        () => this.markExpired(entry),
        Math.max(0, new Date(entry.expiresAt).getTime() - Date.now())
      )
    },

    markExpired(entry) {
      if (!this.attachments.includes(entry) || entry.phase === 'expired') return
      entry.phase = 'expired'
      entry.error = EXPIRED_COPY
      entry.cancelled = true
      this.clearExpiryTimer(entry)
      entry.xhr?.abort()
      entry.xhr = null
    },

    attachmentStatus(attachment) {
      if (attachment.phase === 'preparing') return 'Preparing attachment…'
      if (attachment.phase === 'uploading')
        return attachment.progress === null
          ? 'Uploading attachment…'
          : `Uploading attachment, ${attachment.progress}% complete`
      if (attachment.phase === 'completing') return 'Verifying and completing attachment…'
      if (attachment.phase === 'ready') return 'Attachment ready'
      if (attachment.phase === 'expired') return EXPIRED_COPY
      return `Attachment failed: ${attachment.error || 'upload failed'}`
    },

    formatBytes(value) {
      if (!Number.isFinite(value) || value < 0) return ''
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
      return `${(value / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
    },

    retryAttachment(entry) {
      if (!this.submitting && entry.phase === 'failed') void this.startUpload(entry)
    },

    removeAttachment(clientId) {
      const entry = this.attachments.find((attachment) => attachment.clientId === clientId)
      if (!entry) return
      this.abortEntry(entry)
      this.attachments = this.attachments.filter((attachment) => attachment !== entry)
    },

    abortEntry(entry) {
      entry.cancelled = true
      this.clearExpiryTimer(entry)
      entry.xhr?.abort()
      entry.xhr = null
    },
    abortUploads() {
      for (const attachment of this.attachments) this.abortEntry(attachment)
      this.clearAttachmentTimers()
    },
    clearExpiryTimer(entry) {
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer)
      entry.expiryTimer = null
    },
    clearAttachmentTimers() {
      for (const attachment of this.attachments) this.clearExpiryTimer(attachment)
    },
  },
}
</script>
