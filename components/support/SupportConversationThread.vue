<template>
  <div class="flex h-full flex-col">
    <!-- No conversation selected -->
    <div v-if="!conversationId" class="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon name="lucide:mails" class="h-5 w-5" />
      </div>
      <p class="text-sm font-medium">No conversation selected</p>
      <p class="mt-1 max-w-64 text-xs text-muted-foreground">
        Pick one from the list, or work through the queue with the keyboard.
      </p>
      <dl
        class="mt-4 hidden grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-left text-xs text-muted-foreground [@media(hover:hover)]:grid"
      >
        <dt><kbd :class="kbdClass">j</kbd> <kbd :class="kbdClass">k</kbd></dt>
        <dd>Next / previous</dd>
        <dt><kbd :class="kbdClass">e</kbd></dt>
        <dd>Resolve</dd>
        <dt><kbd :class="kbdClass">c</kbd></dt>
        <dd>Assign to me</dd>
        <dt><kbd :class="kbdClass">r</kbd> / <kbd :class="kbdClass">n</kbd></dt>
        <dd>Reply / internal note</dd>
        <dt><kbd :class="kbdClass">/</kbd></dt>
        <dd>Search</dd>
        <dt><kbd :class="kbdClass">?</kbd></dt>
        <dd>All shortcuts</dd>
      </dl>
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
      <div class="border-b px-3 py-2.5 sm:px-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div class="flex min-w-[12rem] flex-1 basis-64 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              data-testid="support-thread-back"
              class="-ml-1.5 h-9 w-9 shrink-0 @2xl/panes:hidden"
              aria-label="Back to conversations"
              @click="$emit('back')"
            >
              <Icon name="lucide:arrow-left" class="h-4 w-4" />
            </Button>
            <div class="min-w-0 flex-1">
              <h2 class="flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-snug">
                <span class="min-w-0 truncate">{{ conversation.subject || 'No subject' }}</span>
                <span
                  v-if="isMail"
                  data-testid="support-thread-kind-mail"
                  class="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground"
                >
                  <Icon name="lucide:mail" class="h-3.5 w-3.5" />
                  Mail
                </span>
                <span class="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                  #{{ conversation.displayId }}
                </span>
                <span
                  v-if="slaCountdown(conversation)"
                  data-testid="support-thread-sla"
                  class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium"
                  :class="slaClass(conversation)"
                  :aria-label="`SLA ${slaCountdown(conversation)}`"
                >
                  <Icon name="lucide:timer" class="h-3 w-3" />
                  {{ slaCountdown(conversation) }}
                </span>
              </h2>
              <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  data-testid="support-thread-contact"
                  class="min-w-0 truncate hover:text-foreground hover:underline"
                  @click="$emit('toggle-details')"
                >
                  {{ contact?.name || contact?.email || 'Unknown contact' }}
                </button>
                <template v-if="receivingAddress">
                  <span aria-hidden="true">·</span>
                  <span class="truncate">to {{ receivingAddress }}</span>
                </template>
              </p>
            </div>
          </div>

          <div class="flex w-full items-center gap-1 @2xl/panes:w-auto">
            <Button
              v-if="!conversation.assigneeUserId && currentUserId && isWorkable"
              variant="outline"
              size="sm"
              data-testid="support-thread-claim"
              class="h-8"
              :disabled="isUpdating"
              title="Assign to me (c)"
              @click="$emit('claim-conversation')"
            >
              <Icon name="lucide:user-plus" class="h-3.5 w-3.5" />
              <span class="hidden @lg/panes:inline">Assign to me</span>
            </Button>
            <button
              v-else-if="conversation.assigneeUserId"
              type="button"
              data-testid="support-thread-assignee-chip"
              class="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium hover:bg-accent"
              :title="`Assigned to ${assigneeName}`"
              @click="$emit('toggle-details')"
            >
              <Avatar class="h-5 w-5">
                <AvatarFallback class="bg-primary/15 text-[9px] font-semibold text-primary">
                  {{ initials(assigneeName) }}
                </AvatarFallback>
              </Avatar>
              <span class="hidden max-w-28 truncate @lg/panes:inline">{{ assigneeName }}</span>
            </button>

            <Button
              v-if="canMarkUnread"
              variant="ghost"
              size="icon"
              data-testid="support-thread-mark-unread"
              class="h-8 w-8"
              :disabled="isUpdating"
              title="Mark unread"
              aria-label="Mark unread"
              @click="$emit('mark-unread')"
            >
              <Icon name="lucide:mail-open" class="h-4 w-4" />
            </Button>
            <span
              v-else-if="isHandledByAnotherAgent"
              data-testid="support-thread-mark-unread-unavailable"
              class="sr-only"
              >This conversation is handled by another agent. Only its assignee can mark it unread.</span
            >

            <Icon
              v-if="isUpdating"
              name="lucide:loader-2"
              class="mx-1 h-3.5 w-3.5 animate-spin text-muted-foreground"
            />

            <span class="flex-1" />

            <!-- One primary action; the folder moves live in its menu -->
            <div class="inline-flex">
              <Button
                v-if="isInTrash"
                size="sm"
                data-testid="support-thread-restore"
                class="h-8 rounded-r-none"
                :disabled="isUpdating"
                @click="$emit('update-conversation', { deleted: false })"
              >
                <Icon name="lucide:undo-2" class="h-3.5 w-3.5" />
                Restore
              </Button>
              <Button
                v-else-if="isInSpam"
                size="sm"
                data-testid="support-thread-not-spam"
                class="h-8 rounded-r-none"
                :disabled="isUpdating"
                @click="$emit('update-conversation', { spam: false })"
              >
                <Icon name="lucide:shield-check" class="h-3.5 w-3.5" />
                Not spam
              </Button>
              <Button
                v-else-if="isWorkable"
                size="sm"
                data-testid="support-thread-resolve"
                class="h-8 rounded-r-none"
                :disabled="isUpdating"
                title="Resolve (e)"
                @click="$emit('update-conversation', { status: 'resolved' })"
              >
                <Icon name="lucide:check" class="h-3.5 w-3.5" />
                {{ isMail ? 'Done' : 'Resolve' }}
              </Button>
              <Button
                v-else
                size="sm"
                variant="outline"
                data-testid="support-thread-reopen"
                class="h-8 rounded-r-none"
                :disabled="isUpdating"
                @click="$emit('update-conversation', { status: 'open' })"
              >
                <Icon name="lucide:rotate-ccw" class="h-3.5 w-3.5" />
                Reopen
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    size="sm"
                    :variant="isWorkable || isInTrash || isInSpam ? 'default' : 'outline'"
                    data-testid="support-thread-more"
                    class="h-8 w-8 rounded-l-none border-l border-l-primary-foreground/25 px-0"
                    :disabled="isUpdating"
                    aria-label="More actions"
                  >
                    <Icon name="lucide:chevron-down" class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-52">
                  <template v-if="!isInTrash">
                    <DropdownMenuItem
                      v-if="!isInSpam"
                      data-testid="support-thread-archive"
                      @select="$emit('update-conversation', { status: isArchived ? 'open' : 'closed' })"
                    >
                      <Icon :name="isArchived ? 'lucide:archive-restore' : 'lucide:archive'" class="h-4 w-4" />
                      {{ isArchived ? 'Unarchive' : 'Archive' }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="!isInSpam"
                      data-testid="support-thread-spam"
                      @select="$emit('update-conversation', { spam: true })"
                    >
                      <Icon name="lucide:shield-alert" class="h-4 w-4" />
                      Mark as spam
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="support-thread-delete"
                      @select="$emit('update-conversation', { deleted: true })"
                    >
                      <Icon name="lucide:trash-2" class="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </template>
                  <DropdownMenuItem
                    data-testid="support-thread-type-toggle"
                    @select="$emit('update-conversation', { behaviour: isMail ? 'helpdesk' : 'mail' })"
                  >
                    <Icon :name="isMail ? 'lucide:life-buoy' : 'lucide:mail'" class="h-4 w-4" />
                    {{ isMail ? 'Make support case' : 'Make plain mail' }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Button
              variant="ghost"
              size="icon"
              data-testid="support-thread-details-toggle"
              class="h-8 w-8"
              :class="detailsOpen ? 'bg-accent text-foreground' : ''"
              :aria-pressed="String(detailsOpen)"
              title="Details (i)"
              aria-label="Conversation details"
              @click="$emit('toggle-details')"
            >
              <Icon name="lucide:panel-right" class="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p
          v-if="isInTrash"
          data-testid="support-thread-trash-note"
          class="mt-2.5 rounded-md border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground"
        >
          This conversation is in Trash and is deleted permanently 30 days after it was deleted.
        </p>
      </div>

      <!-- Messages -->
      <div
        ref="scrollArea"
        data-testid="support-conversation-thread-scroll"
        class="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
      >
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

        <div v-else class="mx-auto w-full max-w-3xl">
          <SupportMessageItem
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :contact="contact"
            :members="members"
            :conversation-id="conversationId"
          />
        </div>
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
import { supportSlaClass, supportSlaCountdown } from '~/lib/support-sla'

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
    detailsOpen: { type: Boolean, default: false },
    receivingAddress: { type: String, default: '' },
  },

  emits: [
    'retry-detail',
    'retry-messages',
    'update-conversation',
    'claim-conversation',
    'mark-unread',
    'toggle-details',
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

    isMail() {
      return this.conversation?.behaviour === 'mail'
    },

    /** Open, pending or snoozed, and in neither Spam nor Trash: the conversation can be resolved. */
    isWorkable() {
      return !this.isInTrash && !this.isInSpam && ['open', 'pending', 'snoozed'].includes(this.conversation?.status)
    },

    assigneeName() {
      const id = this.conversation?.assigneeUserId
      if (!id) return ''
      if (id === this.currentUserId) return 'You'
      const member = this.members.find((candidate) => candidate.userId === id)
      return member?.userName || member?.userEmail || 'Teammate'
    },

    kbdClass() {
      return 'rounded border border-b-2 bg-background px-1 font-mono text-[10.5px]'
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
  },

  methods: {
    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },

    slaCountdown(item) {
      return supportSlaCountdown(item, this.nowMs)
    },

    slaClass(item) {
      return supportSlaClass(item, this.nowMs)
    },
  },
}
</script>
