<template>
  <div class="flex h-full flex-col">
    <div class="px-3 py-3 border-b">
      <h2 class="text-sm font-semibold text-foreground">Conversations</h2>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="isLoading" class="space-y-2 p-3">
        <Skeleton v-for="n in 6" :key="n" class="h-20 w-full" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="p-4 text-center">
        <Icon name="lucide:alert-circle" class="w-6 h-6 text-destructive mx-auto mb-2" />
        <p class="text-sm text-muted-foreground mb-3">{{ error }}</p>
        <Button variant="outline" size="sm" @click="$emit('retry')">
          <Icon name="lucide:refresh-cw" class="w-3.5 h-3.5 mr-1.5" />
          Try again
        </Button>
      </div>

      <!-- Empty -->
      <div v-else-if="conversations.length === 0" class="p-6 text-center">
        <Icon name="lucide:inbox" class="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p class="text-sm font-medium mb-1">No conversations</p>
        <p class="text-xs text-muted-foreground">Conversations matching these filters will appear here.</p>
      </div>

      <!-- List -->
      <template v-else>
        <button
          v-for="item in conversations"
          :key="item.id"
          type="button"
          :data-testid="`support-conversation-${item.id}`"
          class="w-full text-left px-3 py-3 border-b transition-colors"
          :class="item.id === selectedConversationId ? 'bg-accent' : 'bg-transparent hover:bg-accent/50'"
          @click="$emit('select', item.id)"
        >
          <div class="flex items-start gap-2.5">
            <Avatar class="h-8 w-8 shrink-0">
              <AvatarFallback class="text-xs">{{ initials(contactLabel(item)) }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium truncate">{{ contactLabel(item) }}</span>
                <span class="text-xs text-muted-foreground shrink-0">{{
                  formatRelativeTime(item.lastActivityAt || item.createdAt)
                }}</span>
              </div>
              <p class="text-sm text-foreground/90 truncate mt-0.5">
                {{ item.subject || 'No subject' }}
              </p>
              <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <Badge :variant="statusBadgeVariant(item.status)" class="text-[10px] px-1.5 py-0 font-normal">
                  {{ formatStatus(item.status) }}
                </Badge>
                <Badge v-if="item.priority" variant="outline" class="text-[10px] px-1.5 py-0 font-normal">
                  {{ item.priority }}
                </Badge>
                <span class="text-[11px] text-muted-foreground ml-auto">#{{ item.displayId }}</span>
              </div>
            </div>
          </div>
        </button>

        <div v-if="hasMore" class="flex justify-center p-3">
          <Button variant="outline" size="sm" :disabled="isLoadingMore" @click="$emit('load-more')">
            <Icon v-if="isLoadingMore" name="lucide:loader-2" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
            {{ isLoadingMore ? 'Loading…' : 'Load more' }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SupportConversationList',

  props: {
    conversations: { type: Array, default: () => [] },
    selectedConversationId: { type: String, default: null },
    isLoading: { type: Boolean, default: false },
    isLoadingMore: { type: Boolean, default: false },
    error: { type: String, default: null },
    hasMore: { type: Boolean, default: false },
  },

  emits: ['select', 'retry', 'load-more'],

  methods: {
    contactLabel(item) {
      if (item.contactLoading) return 'Loading…'
      return item.contact?.name || item.contact?.email || 'Unknown contact'
    },

    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },

    formatRelativeTime(dateStr) {
      if (!dateStr) return ''
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMin = Math.floor(diffMs / 60000)

      if (diffMin < 1) return 'now'
      if (diffMin < 60) return `${diffMin}m`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return `${diffHr}h`
      const diffDays = Math.floor(diffHr / 24)
      if (diffDays < 7) return `${diffDays}d`
      return date.toLocaleDateString()
    },

    formatStatus(status) {
      const labels = { open: 'Open', pending: 'Pending', resolved: 'Resolved', snoozed: 'Snoozed', closed: 'Closed' }
      return labels[status] || status
    },

    statusBadgeVariant(status) {
      const variants = {
        open: 'default',
        pending: 'secondary',
        resolved: 'outline',
        snoozed: 'outline',
        closed: 'secondary',
      }
      return variants[status] || 'outline'
    },
  },
}
</script>
