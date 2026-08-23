<template>
  <!-- The whole composer changes appearance in note mode, not just the toggle.
       An agent posting an internal note as a public reply is the worst failure
       mode in this product (stage-02 acceptance criterion 4), so mode is
       signalled by the container, the tabs, the placeholder, the caption, and
       the submit button - not by one highlighted tab. -->
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
        <Icon name="lucide:reply" class="w-3.5 h-3.5" />
        Reply
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
        <Icon name="lucide:lock" class="w-3.5 h-3.5" />
        Internal note
      </button>

      <span
        v-if="isNote"
        data-testid="support-composer-note-caption"
        class="ml-auto text-xs font-medium text-amber-700 dark:text-amber-400"
      >
        Only your team will see this
      </span>
      <span v-else class="ml-auto text-xs text-muted-foreground"> Visible to the customer </span>
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
        :data-testid="`support-composer-attachment-${attachment.clientId}`"
      >
        <Icon
          v-if="attachment.uploading"
          name="lucide:loader-circle"
          class="w-3.5 h-3.5 animate-spin text-muted-foreground"
        />
        <Icon v-else-if="attachment.error" name="lucide:alert-circle" class="w-3.5 h-3.5 text-destructive" />
        <Icon v-else name="lucide:paperclip" class="w-3.5 h-3.5 text-muted-foreground" />
        <span class="max-w-[12rem] truncate" :class="attachment.error ? 'text-destructive' : ''">
          {{ attachment.error ? `${attachment.fileName}: ${attachment.error}` : attachment.fileName }}
        </span>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground"
          :disabled="submitting"
          @click="removeAttachment(attachment.clientId)"
        >
          <Icon name="lucide:x" class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <div class="flex items-center justify-between mt-2">
      <div class="flex items-center gap-2">
        <p class="text-xs text-muted-foreground">
          <template v-if="isNote">Internal notes are stored on the ticket and never emailed.</template>
          <template v-else>Replies are stored on the ticket. Sending by email arrives in a later stage.</template>
        </p>
        <button
          type="button"
          data-testid="support-composer-attach"
          class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          :disabled="submitting"
          @click="openFilePicker"
        >
          <Icon name="lucide:paperclip" class="w-3.5 h-3.5" />
          Attach
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          data-testid="support-composer-file-input"
          @change="onFilesSelected"
        />
      </div>

      <Button
        size="sm"
        data-testid="support-composer-submit"
        :disabled="!canSubmit"
        :class="isNote ? 'bg-amber-500 hover:bg-amber-600 text-white dark:text-amber-950' : ''"
        @click="submit"
      >
        <Icon v-if="submitting" name="lucide:loader-circle" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
        <Icon v-else :name="isNote ? 'lucide:lock' : 'lucide:send'" class="w-3.5 h-3.5 mr-1.5" />
        {{ isNote ? 'Add internal note' : 'Send reply' }}
      </Button>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

// Mirrors `server/utils/support-attachments.ts` for early client-side
// rejection. The server re-checks both against the real bytes - this is UX
// only, not the authorization boundary.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
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

let clientIdCounter = 0
function nextClientId() {
  clientIdCounter += 1
  return `att-${clientIdCounter}`
}

export default {
  name: 'SupportComposer',

  props: {
    conversationId: {
      type: String,
      required: true,
    },
  },

  emits: ['posted'],

  data() {
    return {
      mode: 'reply',
      draft: '',
      submitting: false,
      attachments: [],
    }
  },

  computed: {
    isNote() {
      return this.mode === 'note'
    },
    placeholder() {
      return this.isNote ? 'Write an internal note for your team…' : 'Write a reply to the customer…'
    },
    canSubmit() {
      return !this.submitting && this.draft.trim().length > 0 && !this.attachments.some((a) => a.uploading || a.error)
    },
  },

  watch: {
    // A draft belongs to the conversation it was written in. Carrying it across
    // a selection change risks posting it to the wrong ticket. Mode resets too,
    // so a note draft can never silently become the next ticket's reply.
    conversationId() {
      this.draft = ''
      this.mode = 'reply'
      this.submitting = false
      this.attachments = []
    },
  },

  methods: {
    setMode(mode) {
      if (this.submitting) return
      this.mode = mode
    },

    async submit() {
      if (!this.canSubmit) return

      this.submitting = true
      const kind = this.isNote ? 'note' : 'outgoing'
      const body = this.draft.trim()
      // `messages/index.post.ts` does not read this field yet (Stage 04's
      // send wiring is still landing) - sending it now means nothing breaks
      // once it does. Unknown keys are stripped by the endpoint's zod schema
      // today, not rejected.
      const attachments = this.attachments.map((a) => ({
        storageKey: a.storageKey,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      }))

      try {
        await $fetch(`/api/support/conversations/${this.conversationId}/messages`, {
          method: 'POST',
          body: attachments.length > 0 ? { kind, body, attachments } : { kind, body },
        })

        this.draft = ''
        this.attachments = []
        // Mode deliberately persists after posting - an agent adding several
        // notes in a row should not have to reselect the mode each time, and
        // the composer stays visibly amber so the mode is never ambiguous.
        this.$emit('posted')
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to post message')
      } finally {
        this.submitting = false
      }
    },

    openFilePicker() {
      if (this.submitting) return
      this.$refs.fileInput?.click()
    },

    async onFilesSelected(event) {
      const files = Array.from(event.target.files || [])
      event.target.value = ''
      for (const file of files) {
        await this.uploadAttachment(file)
      }
    },

    async uploadAttachment(file) {
      const clientId = nextClientId()
      const contentType = file.type || 'application/octet-stream'

      if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
        this.attachments.push({
          clientId,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          storageKey: null,
          uploading: false,
          error: 'unsupported file type',
        })
        return
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.attachments.push({
          clientId,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          storageKey: null,
          uploading: false,
          error: `too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)`,
        })
        return
      }

      const entry = {
        clientId,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        storageKey: null,
        uploading: true,
        error: null,
      }
      this.attachments.push(entry)

      try {
        const presignResponse = await $fetch('/api/support/attachments/presign', {
          method: 'POST',
          body: {
            conversationId: this.conversationId,
            filename: file.name,
            contentType,
            sizeBytes: file.size,
          },
        })
        const target = presignResponse?.data

        const uploadResponse = await fetch(target.uploadUrl, {
          method: target.method,
          headers: target.headers,
          body: file,
        })
        if (!uploadResponse.ok) {
          throw new Error('Upload failed')
        }

        entry.storageKey = target.storageKey
        entry.uploading = false
      } catch (err) {
        entry.uploading = false
        entry.error = err?.data?.error?.message || 'upload failed'
      }
    },

    removeAttachment(clientId) {
      this.attachments = this.attachments.filter((a) => a.clientId !== clientId)
    },
  },
}
</script>
