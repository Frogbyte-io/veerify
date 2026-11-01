<template>
  <div class="px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4">
    <div
      class="relative mx-auto w-full max-w-3xl rounded-xl border transition-colors"
      :class="isNote ? 'border-amber-400/60 bg-amber-500/[0.07] dark:bg-amber-500/[0.06]' : 'bg-card'"
      :data-testid="`support-composer-${mode}`"
      :data-composer-mode="mode"
    >
      <div class="flex flex-wrap items-center gap-1 gap-y-1.5 px-2 pt-2">
        <button
          type="button"
          data-testid="support-composer-mode-reply"
          :class="tabClass(!isNote, false)"
          :aria-pressed="!isNote"
          @click="setMode('reply')"
        >
          <Icon name="lucide:reply" class="h-3.5 w-3.5" />Reply
        </button>
        <button
          type="button"
          data-testid="support-composer-mode-note"
          :class="tabClass(isNote, true)"
          :aria-pressed="isNote"
          @click="setMode('note')"
        >
          <Icon name="lucide:lock" class="h-3.5 w-3.5" />Note
        </button>

        <span
          v-if="isNote"
          data-testid="support-composer-note-caption"
          class="ml-auto pr-1 text-xs font-medium text-amber-700 dark:text-amber-400"
          >Only your project will see this</span
        >
        <template v-else>
          <!-- What this reply is: a plain mail or a tracked support case -->
          <div
            v-if="conversation"
            class="ml-auto inline-flex gap-0.5 rounded-lg border p-0.5"
            role="radiogroup"
            aria-label="Send as"
          >
            <button
              type="button"
              role="radio"
              data-testid="support-composer-type-mail"
              :aria-checked="String(sendAs === 'mail')"
              :class="segmentClass(sendAs === 'mail')"
              title="A normal email, no case tracking"
              @click="sendAs = 'mail'"
            >
              <Icon name="lucide:mail" class="h-3.5 w-3.5" />Mail
            </button>
            <button
              type="button"
              role="radio"
              data-testid="support-composer-type-case"
              :aria-checked="String(sendAs === 'helpdesk')"
              :class="segmentClass(sendAs === 'helpdesk')"
              title="Tracked with status, assignee, SLA and a rating survey"
              @click="sendAs = 'helpdesk'"
            >
              <Icon name="lucide:life-buoy" class="h-3.5 w-3.5" />Support case
            </button>
          </div>

          <DropdownMenu v-if="sendableAddresses.length > 1">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                data-testid="support-composer-from"
                class="order-last flex w-full min-w-0 items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground sm:order-none sm:w-auto sm:bg-transparent sm:hover:bg-accent"
              >
                From
                <span class="min-w-0 truncate font-medium text-foreground">{{ fromAddressLabel }}</span>
                <span v-if="projectName" class="min-w-0 truncate" data-testid="support-composer-from-project">
                  ({{ projectName }}'s inbox)
                </span>
                <Icon name="lucide:chevron-down" class="h-3.5 w-3.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-72">
              <DropdownMenuLabel class="text-xs text-muted-foreground">Reply from</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="address in sendableAddresses"
                :key="address.id || 'inbox'"
                :data-testid="`support-composer-from-${address.id || 'inbox'}`"
                @select="fromAddressId = address.id"
              >
                <Icon :name="address.behaviour === 'mail' ? 'lucide:mail' : 'lucide:life-buoy'" class="h-4 w-4" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ address.address }}</span>
                  <span
                    v-if="address.id && address.id === conversation?.mailAddressId"
                    class="text-[11px] text-muted-foreground"
                  >
                    Received here
                  </span>
                  <span v-else-if="!address.id" class="text-[11px] text-muted-foreground">Inbox default</span>
                </span>
                <Icon v-if="address.id === fromAddressId" name="lucide:check" class="h-4 w-4" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span
            v-else-if="fromAddressLabel"
            data-testid="support-composer-from-static"
            class="order-last w-full truncate px-2 text-xs text-muted-foreground sm:order-none sm:w-auto"
          >
            From <span class="font-medium text-foreground">{{ fromAddressLabel }}</span>
            <span v-if="projectName" class="ml-1" data-testid="support-composer-from-project">
              ({{ projectName }}'s inbox)
            </span>
          </span>
        </template>
      </div>

      <textarea
        ref="input"
        v-model="draft"
        data-testid="support-composer-input"
        rows="3"
        :placeholder="placeholder"
        :disabled="submitting"
        class="block max-h-[40dvh] min-h-16 w-full resize-y bg-transparent px-3.5 py-2.5 text-base outline-none disabled:opacity-60 sm:text-sm"
        @click="rememberCursor"
        @keyup="rememberCursor"
        @select="rememberCursor"
        @keydown.enter.exact.ctrl.prevent="submit()"
        @keydown.enter.exact.meta.prevent="submit()"
        @keydown.enter.ctrl.shift.prevent="submit({ resolve: true })"
        @keydown.enter.meta.shift.prevent="submit({ resolve: true })"
      />

      <p
        v-if="typeChangeNote"
        data-testid="support-composer-type-note"
        class="flex gap-2 px-3.5 pb-2 text-xs text-muted-foreground"
      >
        <Icon
          :name="sendAs === 'mail' ? 'lucide:mail' : 'lucide:life-buoy'"
          class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
        />
        <span>{{ typeChangeNote }}</span>
      </p>

      <div class="px-3">
        <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 pb-2" data-testid="support-composer-attachments">
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
      </div>

      <div class="flex items-center gap-1 px-2 pt-1 pb-2">
        <button
          v-if="!isNote"
          type="button"
          data-testid="support-composer-attach"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          :disabled="submitting || attachments.length >= maxAttachmentFiles"
          title="Attach files"
          aria-label="Attach files"
          @click="openFilePicker"
        >
          <Icon name="lucide:paperclip" class="h-4 w-4" />
        </button>
        <div class="relative">
          <button
            type="button"
            data-testid="support-composer-canned-trigger"
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            :disabled="submitting || !projectId"
            title="Saved replies (type /)"
            aria-label="Saved replies"
            @click="toggleCannedResponses"
          >
            <Icon name="lucide:zap" class="h-4 w-4" />
          </button>
          <div
            v-if="showCannedResponses"
            data-testid="support-composer-canned-menu"
            class="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            <div v-if="isLoadingCannedResponses" class="p-3 text-xs text-muted-foreground">Loading responses...</div>
            <div v-else-if="cannedResponsesError" class="p-3 text-xs text-destructive">
              {{ cannedResponsesError }}
            </div>
            <div v-else-if="visibleCannedResponses.length === 0" class="p-3 text-xs text-muted-foreground">
              No saved responses
            </div>
            <template v-else>
              <button
                v-for="response in visibleCannedResponses"
                :key="response.id"
                type="button"
                class="block w-full px-3 py-2 text-left hover:bg-muted"
                :data-testid="`support-composer-canned-option-${response.shortcode}`"
                @click="insertCannedResponse(response)"
              >
                <span class="block text-xs font-medium">/{{ response.shortcode }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ response.title }}</span>
              </button>
            </template>
          </div>
        </div>
        <!-- prettier-ignore -->
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
          class="hidden"
          data-testid="support-composer-file-input"
          @change="onFilesSelected"
        >
        <span class="flex-1" />
        <span class="mr-2 hidden text-[11px] text-muted-foreground [@media(hover:hover)]:inline">
          <kbd class="rounded border border-b-2 px-1 font-mono">⌘</kbd>
          <kbd class="rounded border border-b-2 px-1 font-mono">↵</kbd>
          send
        </span>
        <div class="inline-flex">
          <Button
            size="sm"
            data-testid="support-composer-submit"
            class="h-8"
            :class="[
              isNote ? 'bg-amber-500 text-white hover:bg-amber-600 dark:text-amber-950' : '',
              canResolveOnSend ? 'rounded-r-none' : '',
            ]"
            :disabled="!canSubmit"
            @click="submit()"
          >
            <Icon v-if="submitting" name="lucide:loader-circle" class="h-3.5 w-3.5 animate-spin" /><Icon
              v-else
              :name="isNote ? 'lucide:lock' : 'lucide:send'"
              class="h-3.5 w-3.5"
            />{{ isNote ? 'Add note' : 'Send' }}
          </Button>
          <DropdownMenu v-if="canResolveOnSend">
            <DropdownMenuTrigger as-child>
              <Button
                size="sm"
                data-testid="support-composer-submit-menu"
                class="h-8 w-8 rounded-l-none border-l border-l-primary-foreground/25 px-0"
                :disabled="!canSubmit"
                aria-label="More send options"
              >
                <Icon name="lucide:chevron-down" class="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem data-testid="support-composer-submit-resolve" @select="submit({ resolve: true })">
                <Icon name="lucide:check-check" class="h-4 w-4" />
                <span class="flex-1">Send and {{ sendAs === 'mail' ? 'mark done' : 'resolve' }}</span>
                <span class="text-[11px] text-muted-foreground">⌘⇧↵</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { insertTextAtCursor, substituteCannedResponse } from '~/lib/support-canned-responses'

const MAX_ATTACHMENT_FILES = 10
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
const DRAFT_STORAGE_PREFIX = 'veerify:support:draft'
const DRAFT_MODES = ['reply', 'note']
const SUPPORT_DRAFT_STATE_CHANGED_EVENT = 'veerify:support-draft-state-changed'
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
  props: {
    conversationId: { type: String, required: true },
    projectId: { type: String, default: '' },
    // All projects: the project whose inbox the reply goes out from, named next to the From address.
    projectName: { type: String, default: '' },
    contact: { type: Object, default: null },
    currentUserName: { type: String, default: '' },
    // The conversation being answered: its type (`behaviour`), case number and receiving address.
    conversation: { type: Object, default: null },
    // The inbox's addresses, each with `canSendFrom`.
    addresses: { type: Array, default: () => [] },
    inboxSendingAddress: { type: String, default: null },
  },
  emits: ['posted', 'draft-state-changed'],

  data() {
    return {
      mode: 'reply',
      draft: '',
      submitting: false,
      attachments: [],
      conversationGeneration: 0,
      isRestoringDraft: false,
      cannedResponses: [],
      isLoadingCannedResponses: false,
      cannedResponsesError: null,
      showCannedResponses: false,
      lastCursor: 0,
      // 'mail' | 'helpdesk': what this reply is sent as. Differs from the conversation's
      // type when the agent switches it, and the send then changes the conversation.
      sendAs: 'helpdesk',
      // project_mail_address id to reply from; null means the inbox's own address.
      fromAddressId: null,
    }
  },

  computed: {
    isNote() {
      return this.mode === 'note'
    },
    conversationType() {
      return this.conversation?.behaviour === 'mail' ? 'mail' : 'helpdesk'
    },
    sendableAddresses() {
      const options = this.addresses
        .filter((address) => address.canSendFrom)
        .map((address) => ({ id: address.id, address: address.address, behaviour: address.behaviour }))
      if (this.inboxSendingAddress && !options.some((option) => option.address === this.inboxSendingAddress)) {
        options.push({ id: null, address: this.inboxSendingAddress, behaviour: 'helpdesk' })
      }
      return options
    },
    fromAddressLabel() {
      const match = this.sendableAddresses.find((option) => option.id === this.fromAddressId)
      return match?.address || this.inboxSendingAddress || ''
    },
    typeChangeNote() {
      if (this.isNote || !this.conversation || this.sendAs === this.conversationType) return ''
      const number = this.conversation.displayId
      if (this.sendAs === 'helpdesk') {
        return `Sending this turns the mail into support case #${number}. It gets a status, assignee and SLA, and the customer gets a rating survey when it is resolved.`
      }
      return `Sending this as plain mail ends the support case. It keeps #${number} for reference, but the SLA stops and no rating survey goes out.`
    },
    canResolveOnSend() {
      return !this.isNote && Boolean(this.conversation) && !this.conversation.deletedAt && !this.conversation.spamAt
    },
    maxAttachmentFiles() {
      return MAX_ATTACHMENT_FILES
    },
    expiredCopy() {
      return EXPIRED_COPY
    },
    placeholder() {
      return this.isNote ? 'Write an internal note for your project…' : 'Write a reply to the customer…'
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
    visibleCannedResponses() {
      const query = this.currentShortcodeQuery()
      if (!query) return this.cannedResponses
      return this.cannedResponses.filter((response) => response.shortcode.startsWith(query))
    },
  },

  watch: {
    draft() {
      if (this.isRestoringDraft) return
      this.saveCurrentDraft()
    },
    conversation(next, previous) {
      if (next?.id !== previous?.id) this.resetSendOptions()
      // After a send switches the type, the switch follows it; the chosen From address stays.
      else if (next?.behaviour !== previous?.behaviour) this.sendAs = this.conversationType
    },
    addresses() {
      if (!this.sendableAddresses.some((option) => option.id === this.fromAddressId)) this.resetSendOptions()
    },
    conversationId() {
      this.conversationGeneration += 1
      this.abortUploads()
      this.restoreDraftForConversation()
      this.submitting = false
      this.attachments = []
      this.showCannedResponses = false
      this.lastCursor = 0
    },
    projectId() {
      this.cannedResponses = []
      this.showCannedResponses = false
      void this.loadCannedResponses()
    },
  },

  mounted() {
    this.resetSendOptions()
    this.restoreDraftForConversation()
    void this.loadCannedResponses()
  },

  beforeUnmount() {
    this.abortUploads()
  },

  methods: {
    tabClass(active, note) {
      const base = 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors'
      if (!active) return `${base} text-muted-foreground hover:bg-muted hover:text-foreground`
      return note ? `${base} bg-amber-500/25 text-amber-800 dark:text-amber-200` : `${base} bg-muted text-foreground`
    },

    segmentClass(active) {
      const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs transition-colors'
      return active
        ? `${base} bg-muted font-medium text-foreground`
        : `${base} text-muted-foreground hover:text-foreground`
    },

    /** Default to the conversation's own type and the address it arrived on, when that address can send. */
    resetSendOptions() {
      this.sendAs = this.conversationType
      const received = this.conversation?.mailAddressId
      const canSendFromReceived = this.sendableAddresses.some((option) => option.id && option.id === received)
      this.fromAddressId = canSendFromReceived ? received : null
    },

    setMode(mode) {
      if (this.submitting) return
      if (!DRAFT_MODES.includes(mode) || mode === this.mode) return
      if (mode === 'note' && this.attachments.length > 0) {
        toast.warning('Remove attachments before switching to an internal note.')
        return
      }
      this.restoreDraftMode(mode)
    },

    rememberCursor() {
      const input = this.$refs.input
      if (!input) return
      this.lastCursor = Number.isFinite(input.selectionStart) ? input.selectionStart : this.draft.length
    },

    currentShortcodeQuery() {
      const beforeCursor = this.draft.slice(0, this.lastCursor)
      const match = beforeCursor.match(/\/([a-z0-9_-]*)$/i)
      return match ? match[1].toLowerCase() : ''
    },

    async loadCannedResponses() {
      if (!this.projectId) return
      this.isLoadingCannedResponses = true
      this.cannedResponsesError = null
      try {
        const response = await $fetch('/api/support/canned-responses', { params: { projectId: this.projectId } })
        this.cannedResponses = response?.data?.cannedResponses || []
      } catch {
        this.cannedResponses = []
        this.cannedResponsesError = 'Could not load responses'
      } finally {
        this.isLoadingCannedResponses = false
      }
    },

    async toggleCannedResponses() {
      this.rememberCursor()
      if (this.cannedResponses.length === 0 && !this.isLoadingCannedResponses) await this.loadCannedResponses()
      this.showCannedResponses = !this.showCannedResponses
    },

    insertCannedResponse(response) {
      const input = this.$refs.input
      const cursor = input && Number.isFinite(input.selectionStart) ? input.selectionStart : this.lastCursor
      const body = substituteCannedResponse(response.body, {
        contact: { name: this.contact?.name || '' },
        agent: { name: this.currentUserName || '' },
      })
      const shortcodeMatch = this.draft.slice(0, cursor).match(/(?:^|\s)(\/[a-z0-9_-]*)$/i)
      const replaceStart = shortcodeMatch ? cursor - shortcodeMatch[1].length : cursor
      const next = insertTextAtCursor(this.draft, body, cursor, replaceStart)
      this.draft = next.value
      this.lastCursor = next.cursor
      this.showCannedResponses = false
      this.$nextTick(() => {
        const textarea = this.$refs.input
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(next.cursor, next.cursor)
      })
    },

    draftKey(conversationId, mode) {
      return `${DRAFT_STORAGE_PREFIX}:${conversationId}:${mode}`
    },

    draftModeKey(conversationId) {
      return `${DRAFT_STORAGE_PREFIX}:${conversationId}:mode`
    },

    storageGet(key) {
      if (!import.meta.client) return null
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },

    storageSet(key, value) {
      if (!import.meta.client) return
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Browser storage may be blocked; drafts are best-effort only.
      }
    },

    storageRemove(key) {
      if (!import.meta.client) return
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Browser storage may be blocked; drafts are best-effort only.
      }
    },

    readDraft(conversationId, mode) {
      return this.storageGet(this.draftKey(conversationId, mode)) || ''
    },

    hasAnyDraft(conversationId) {
      if (!conversationId) return false
      return DRAFT_MODES.some((mode) => this.readDraft(conversationId, mode).trim().length > 0)
    },

    preferredDraftMode(conversationId) {
      const storedMode = this.storageGet(this.draftModeKey(conversationId))
      if (DRAFT_MODES.includes(storedMode) && this.readDraft(conversationId, storedMode).trim().length > 0)
        return storedMode
      if (this.readDraft(conversationId, 'reply').trim().length > 0) return 'reply'
      if (this.readDraft(conversationId, 'note').trim().length > 0) return 'note'
      return 'reply'
    },

    emitDraftState(conversationId = this.conversationId) {
      if (!conversationId) return
      const detail = {
        conversationId,
        hasDraft: this.hasAnyDraft(conversationId),
      }
      this.$emit('draft-state-changed', detail)
      if (import.meta.client) {
        window.dispatchEvent(new CustomEvent(SUPPORT_DRAFT_STATE_CHANGED_EVENT, { detail }))
      }
    },

    saveCurrentDraft() {
      const conversationId = this.conversationId
      if (!conversationId) return

      const key = this.draftKey(conversationId, this.mode)
      if (this.draft.trim().length > 0) {
        this.storageSet(key, this.draft)
        this.storageSet(this.draftModeKey(conversationId), this.mode)
      } else {
        this.storageRemove(key)
        if (!this.hasAnyDraft(conversationId)) this.storageRemove(this.draftModeKey(conversationId))
      }
      this.emitDraftState(conversationId)
    },

    clearDraft(conversationId, mode) {
      this.storageRemove(this.draftKey(conversationId, mode))
      if (!this.hasAnyDraft(conversationId)) this.storageRemove(this.draftModeKey(conversationId))
      else if (this.storageGet(this.draftModeKey(conversationId)) === mode) {
        const nextMode = DRAFT_MODES.find((candidate) => this.readDraft(conversationId, candidate).trim().length > 0)
        if (nextMode) this.storageSet(this.draftModeKey(conversationId), nextMode)
      }
      this.emitDraftState(conversationId)
    },

    restoreDraftMode(mode) {
      this.isRestoringDraft = true
      this.mode = mode
      this.draft = this.readDraft(this.conversationId, mode)
      this.isRestoringDraft = false
      if (this.draft.trim().length > 0) this.storageSet(this.draftModeKey(this.conversationId), mode)
      this.emitDraftState()
    },

    restoreDraftForConversation() {
      const mode = this.preferredDraftMode(this.conversationId)
      this.isRestoringDraft = true
      this.mode = mode
      this.draft = this.readDraft(this.conversationId, mode)
      this.isRestoringDraft = false
      this.emitDraftState()
    },

    syncExpiredAttachments() {
      const now = Date.now()
      for (const attachment of this.attachments) {
        if (attachment.expiresAt && new Date(attachment.expiresAt).getTime() <= now) this.markExpired(attachment)
      }
    },

    async submit({ resolve = false } = {}) {
      this.syncExpiredAttachments()
      if (!this.canSubmit) return
      if (resolve && !this.canResolveOnSend) return
      const submitConversationId = this.conversationId
      const submitGeneration = this.conversationGeneration
      this.submitting = true
      const kind = this.isNote ? 'note' : 'outgoing'
      const submitMode = this.mode
      const body = this.draft.trim()
      const attachments = this.attachments.map((attachment) => ({ uploadId: attachment.uploadId }))
      const payload = { kind, body }
      if (attachments.length > 0) payload.attachments = attachments
      const changesType = !this.isNote && Boolean(this.conversation) && this.sendAs !== this.conversationType
      if (!this.isNote) {
        if (this.fromAddressId) payload.fromAddressId = this.fromAddressId
        if (changesType) payload.behaviour = this.sendAs
        if (resolve) payload.resolve = true
      }
      try {
        await $fetch(`/api/support/conversations/${submitConversationId}/messages`, {
          method: 'POST',
          body: payload,
        })
        this.clearDraft(submitConversationId, submitMode)
        if (submitGeneration !== this.conversationGeneration || submitConversationId !== this.conversationId) return
        this.clearAttachmentTimers()
        this.draft = ''
        this.attachments = []
        this.$emit('posted', { resolved: resolve, behaviour: changesType ? this.sendAs : null })
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
      this.attachments.push({
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
      })
      const entry = this.attachments[this.attachments.length - 1]
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
