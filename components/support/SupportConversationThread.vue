<template>
  <div class="flex h-full flex-col">
    <!-- No conversation selected -->
    <div v-if="!conversationId" class="flex-1 flex flex-col items-center justify-center text-center p-6">
      <Icon name="lucide:message-square" class="w-10 h-10 text-muted-foreground mb-3" />
      <p class="text-sm font-medium">Select a conversation</p>
      <p class="text-xs text-muted-foreground mt-1">Choose a conversation from the list to view its thread.</p>
    </div>

    <!-- Detail loading -->
    <div v-else-if="isLoadingDetail" class="flex h-full flex-col">
      <div class="border-b px-4 py-3 space-y-2">
        <Skeleton class="h-5 w-1/2" />
        <Skeleton class="h-4 w-1/3" />
      </div>
      <div class="flex-1 p-4 space-y-3">
        <Skeleton class="h-16 w-2/3" />
        <Skeleton class="h-16 w-2/3 ml-auto" />
      </div>
    </div>

    <!-- Detail error -->
    <div v-else-if="detailError" class="flex-1 flex flex-col items-center justify-center text-center p-6">
      <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mb-3" />
      <p class="text-sm text-muted-foreground mb-4">{{ detailError }}</p>
      <Button variant="outline" size="sm" @click="$emit('retry-detail')">
        <Icon name="lucide:refresh-cw" class="w-3.5 h-3.5 mr-1.5" />
        Try again
      </Button>
    </div>

    <template v-else-if="conversation">
      <!-- Header -->
      <div class="border-b px-4 py-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-[12rem] flex-1 basis-48">
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                data-testid="support-thread-back"
                class="-ml-2 h-7 w-7 shrink-0 @2xl/panes:hidden"
                aria-label="Back to conversations"
                @click="$emit('back')"
              >
                <Icon name="lucide:arrow-left" class="h-4 w-4" />
              </Button>
              <h2 class="text-sm font-semibold truncate">{{ conversation.subject || 'No subject' }}</h2>
              <span class="text-xs text-muted-foreground shrink-0">#{{ conversation.displayId }}</span>
              <span
                v-if="slaCountdown(conversation)"
                data-testid="support-thread-sla"
                class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                :class="slaClass(conversation)"
                :aria-label="`SLA ${slaCountdown(conversation)}`"
              >
                <Icon name="lucide:timer" class="h-3 w-3" />
                {{ slaCountdown(conversation) }}
              </span>
            </div>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground hover:underline mt-0.5 truncate"
              @click="$emit('toggle-contact-panel')"
            >
              {{ contact?.name || contact?.email || 'Unknown contact' }}
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" @click="$emit('toggle-contact-panel')">
              <Icon name="lucide:panel-right" class="w-3.5 h-3.5 sm:mr-1.5" />
              <span class="sr-only sm:not-sr-only">Contact info</span>
            </Button>
            <Button
              v-if="!conversation.linkedFeedbackId"
              variant="outline"
              size="sm"
              data-testid="support-thread-convert-feedback"
              @click="$emit('convert-to-feedback')"
            >
              <Icon name="lucide:message-square-plus" class="w-3.5 h-3.5 sm:mr-1.5" />
              <span class="sr-only sm:not-sr-only">Convert to feedback</span>
            </Button>
            <a
              v-else
              :href="`/feedback/${conversation.linkedFeedbackId}`"
              data-testid="support-thread-linked-feedback"
              class="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
            >
              <Icon name="lucide:external-link" class="w-3.5 h-3.5 mr-1.5" />
              <span class="max-w-48 truncate">{{ conversation.linkedFeedback?.title || 'View linked feedback' }}</span>
              <span v-if="conversation.linkedFeedback" class="ml-1.5 text-muted-foreground">
                {{ conversation.linkedFeedback.status }} · {{ conversation.linkedFeedback.voteCount }} votes
              </span>
            </a>
            <Button
              v-if="canMarkUnread"
              variant="ghost"
              size="sm"
              data-testid="support-thread-mark-unread"
              :disabled="isUpdating"
              @click="$emit('mark-unread')"
            >
              <Icon name="lucide:mail" class="w-3.5 h-3.5 sm:mr-1.5" />
              <span class="sr-only sm:not-sr-only">Mark unread</span>
            </Button>
            <p
              v-else-if="isHandledByAnotherAgent"
              data-testid="support-thread-mark-unread-unavailable"
              class="max-w-56 text-right text-xs text-muted-foreground"
            >
              This conversation is handled by another agent. Only its assignee can mark it unread.
            </p>
          </div>
        </div>

        <!-- Quick-edit: status / priority / assignee. Every change here goes
             through PATCH .../conversations/[id], which writes an `activity`
             message server-side - that's what makes it show up inline below. -->
        <div class="flex items-center gap-2 mt-3 flex-wrap">
          <Button
            v-if="!conversation.assigneeUserId && currentUserId"
            size="sm"
            data-testid="support-thread-claim"
            :disabled="isUpdating"
            @click="$emit('claim-conversation')"
          >
            <Icon name="lucide:hand" class="w-3.5 h-3.5 mr-1.5" />
            Claim
          </Button>

          <select
            data-testid="support-thread-status"
            class="h-8 px-2 text-xs bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            :value="conversation.status"
            :disabled="isUpdating"
            @change="onUpdate('status', $event.target.value)"
          >
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="snoozed">Snoozed</option>
            <option value="closed">Closed</option>
          </select>

          <select
            data-testid="support-thread-priority"
            class="h-8 px-2 text-xs bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            :value="conversation.priority || ''"
            :disabled="isUpdating"
            @change="onUpdate('priority', $event.target.value || null)"
          >
            <option value="">No priority</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>

          <select
            data-testid="support-thread-assignee"
            class="h-8 px-2 text-xs bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            :value="conversation.assigneeUserId || ''"
            :disabled="isUpdating"
            @change="onUpdate('assigneeUserId', $event.target.value || null)"
          >
            <option value="">Unassigned</option>
            <option v-if="showCurrentUserOption" :value="currentUserId">You</option>
            <option v-for="member in members" :key="member.userId" :value="member.userId">
              {{ member.userName || member.userEmail }}
            </option>
          </select>

          <Icon v-if="isUpdating" name="lucide:loader-2" class="w-3.5 h-3.5 animate-spin text-muted-foreground" />

          <!-- Folder actions. Archive is the `closed` status; Spam and Trash
               are folders that leave the status untouched. -->
          <div class="ml-auto flex items-center gap-1.5">
            <Button
              v-if="isInTrash"
              variant="outline"
              size="sm"
              data-testid="support-thread-restore"
              :disabled="isUpdating"
              @click="$emit('update-conversation', { deleted: false })"
            >
              <Icon name="lucide:undo-2" class="w-3.5 h-3.5 mr-1.5" />
              Restore
            </Button>
            <template v-else>
              <Button
                v-if="isInSpam"
                variant="outline"
                size="sm"
                data-testid="support-thread-not-spam"
                :disabled="isUpdating"
                @click="$emit('update-conversation', { spam: false })"
              >
                <Icon name="lucide:shield-check" class="w-3.5 h-3.5 mr-1.5" />
                Not spam
              </Button>
              <template v-else>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="support-thread-archive"
                  :disabled="isUpdating"
                  @click="$emit('update-conversation', { status: isArchived ? 'open' : 'closed' })"
                >
                  <Icon :name="isArchived ? 'lucide:archive-restore' : 'lucide:archive'" class="w-3.5 h-3.5 mr-1.5" />
                  {{ isArchived ? 'Unarchive' : 'Archive' }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="support-thread-spam"
                  :disabled="isUpdating"
                  @click="$emit('update-conversation', { spam: true })"
                >
                  <Icon name="lucide:shield-alert" class="w-3.5 h-3.5 mr-1.5" />
                  Spam
                </Button>
              </template>
              <Button
                variant="outline"
                size="sm"
                data-testid="support-thread-delete"
                :disabled="isUpdating"
                @click="$emit('update-conversation', { deleted: true })"
              >
                <Icon name="lucide:trash-2" class="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            </template>
          </div>
        </div>
        <p
          v-if="isInTrash"
          data-testid="support-thread-trash-note"
          class="mt-3 rounded-md border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground"
        >
          This conversation is in Trash and is deleted permanently 30 days after it was deleted.
        </p>
      </div>

      <!-- Messages -->
      <div ref="scrollArea" data-testid="support-conversation-thread-scroll" class="flex-1 overflow-y-auto px-4 py-3">
        <div v-if="isLoadingMessages" class="space-y-3">
          <Skeleton class="h-16 w-2/3" />
          <Skeleton class="h-16 w-2/3 ml-auto" />
          <Skeleton class="h-16 w-2/3" />
        </div>

        <div v-else-if="messagesError" class="flex flex-col items-center justify-center text-center py-10">
          <Icon name="lucide:alert-circle" class="w-6 h-6 text-destructive mb-2" />
          <p class="text-sm text-muted-foreground mb-3">{{ messagesError }}</p>
          <Button variant="outline" size="sm" @click="$emit('retry-messages')">
            <Icon name="lucide:refresh-cw" class="w-3.5 h-3.5 mr-1.5" />
            Try again
          </Button>
        </div>

        <div v-else-if="messages.length === 0" class="flex flex-col items-center justify-center text-center py-10">
          <Icon name="lucide:message-square-dashed" class="w-6 h-6 text-muted-foreground mb-2" />
          <p class="text-sm text-muted-foreground">No messages yet.</p>
        </div>

        <template v-else>
          <SupportMessageItem
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :contact="contact"
            :members="members"
            :conversation-id="conversationId"
          />
        </template>
      </div>

      <!-- The composer owns its own border and padding: in note mode it tints
           the full width of the strip, which a wrapper's padding would break. -->
      <slot name="composer">
        <div class="border-t p-3">
          <div class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            Select a conversation to reply.
          </div>
        </div>
      </slot>
    </template>
  </div>
</template>

<script>
export default {
  name: 'SupportConversationThread',

  props: {
    conversationId: { type: String, default: null },
    conversation: { type: Object, default: null },
    contact: { type: Object, default: null },
    currentUserId: { type: String, default: '' },
    members: { type: Array, default: () => [] },
    messages: { type: Array, default: () => [] },
    isLoadingDetail: { type: Boolean, default: false },
    detailError: { type: String, default: null },
    isLoadingMessages: { type: Boolean, default: false },
    messagesError: { type: String, default: null },
    isUpdating: { type: Boolean, default: false },
  },

  emits: [
    'retry-detail',
    'retry-messages',
    'update-conversation',
    'claim-conversation',
    'mark-unread',
    'convert-to-feedback',
    'toggle-contact-panel',
    'back',
  ],

  data() {
    return { nowMs: Date.now(), slaTicker: null }
  },

  mounted() {
    this.slaTicker = window.setInterval(() => {
      this.nowMs = Date.now()
    }, 30_000)
  },

  beforeUnmount() {
    if (this.slaTicker) window.clearInterval(this.slaTicker)
  },

  computed: {
    isInTrash() {
      return Boolean(this.conversation?.deletedAt)
    },

    isInSpam() {
      return Boolean(this.conversation?.spamAt)
    },

    isArchived() {
      return this.conversation?.status === 'closed'
    },

    isHandledByAnotherAgent() {
      return Boolean(this.conversation?.assigneeUserId && this.conversation.assigneeUserId !== this.currentUserId)
    },

    canMarkUnread() {
      return Boolean(!this.conversation?.isUnread && !this.isHandledByAnotherAgent)
    },

    showCurrentUserOption() {
      return Boolean(this.currentUserId && !this.members.some((member) => member.userId === this.currentUserId))
    },
  },

  methods: {
    onUpdate(field, value) {
      this.$emit('update-conversation', { [field]: value })
    },

    slaDueAt(item) {
      return item?.nextResponseDueAt || item?.firstResponseDueAt || item?.resolutionDueAt || null
    },

    slaCountdown(item) {
      const dueAt = this.slaDueAt(item)
      if (!dueAt) return ''
      if (item.slaPausedAt) return 'Paused'
      const diffMin = Math.ceil((new Date(dueAt).getTime() - this.nowMs) / 60000)
      if (diffMin <= 0) return 'Breached'
      if (diffMin < 60) return `${diffMin}m`
      const hours = Math.floor(diffMin / 60)
      const minutes = diffMin % 60
      return minutes ? `${hours}h ${minutes}m` : `${hours}h`
    },

    slaClass(item) {
      const dueAt = this.slaDueAt(item)
      if (item.slaPausedAt) return 'border-slate-300/70 bg-slate-500/10 text-slate-600 dark:text-slate-300'
      if (!dueAt || new Date(dueAt).getTime() <= this.nowMs) {
        return 'border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-300'
      }
      const minutes = (new Date(dueAt).getTime() - this.nowMs) / 60000
      return minutes <= 60
        ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    },
  },
}
</script>
