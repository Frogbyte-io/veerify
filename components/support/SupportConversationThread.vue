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
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold truncate">{{ conversation.subject || 'No subject' }}</h2>
              <span class="text-xs text-muted-foreground shrink-0">#{{ conversation.displayId }}</span>
            </div>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground hover:underline mt-0.5 truncate"
              @click="$emit('toggle-contact-panel')"
            >
              {{ contact?.name || contact?.email || 'Unknown contact' }}
            </button>
          </div>
          <Button variant="outline" size="sm" @click="$emit('toggle-contact-panel')">
            <Icon name="lucide:panel-right" class="w-3.5 h-3.5 mr-1.5" />
            Contact info
          </Button>
        </div>

        <!-- Quick-edit: status / priority / assignee. Every change here goes
             through PATCH .../conversations/[id], which writes an `activity`
             message server-side - that's what makes it show up inline below. -->
        <div class="flex items-center gap-2 mt-3 flex-wrap">
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
            <option v-for="member in members" :key="member.userId" :value="member.userId">
              {{ member.userName || member.userEmail }}
            </option>
          </select>

          <Icon v-if="isUpdating" name="lucide:loader-2" class="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        </div>
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
          />
        </template>
      </div>

      <!-- Composer slot - SUP-02-10 builds the reply/note toggle here. -->
      <div class="border-t p-3">
        <slot name="composer">
          <div class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            Composer coming soon.
          </div>
        </slot>
      </div>
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
    members: { type: Array, default: () => [] },
    messages: { type: Array, default: () => [] },
    isLoadingDetail: { type: Boolean, default: false },
    detailError: { type: String, default: null },
    isLoadingMessages: { type: Boolean, default: false },
    messagesError: { type: String, default: null },
    isUpdating: { type: Boolean, default: false },
  },

  emits: ['retry-detail', 'retry-messages', 'update-conversation', 'toggle-contact-panel'],

  methods: {
    onUpdate(field, value) {
      this.$emit('update-conversation', { [field]: value })
    },
  },
}
</script>
