<template>
  <!-- Activity: centred, muted, inline system line. Never mistakable for a
       message from either party because it has no bubble, no avatar, and no
       alignment. -->
  <div v-if="message.kind === 'activity'" class="flex items-center justify-center py-1">
    <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground text-center px-3 py-1">
      <Icon name="lucide:dot" class="w-3 h-3 shrink-0" />
      {{ message.body }}
      <span class="text-muted-foreground/70">· {{ formattedTime }}</span>
    </span>
  </div>

  <!-- Internal note: deliberately NOT a left/right chat bubble. Full-width
       card, amber/dashed styling (matches the "unconfirmed" visual language
       already used for probable-feedback matches on the contact page), an
       explicit "Internal note" label, and a lock icon. Several independent
       signals so it can never be mistaken for a customer-visible reply. -->
  <div
    v-else-if="message.kind === 'note'"
    data-testid="support-message-note"
    class="my-2 rounded-lg border-2 border-dashed border-amber-400/70 bg-amber-500/10 dark:bg-amber-500/[0.08] p-3"
  >
    <div class="flex items-center gap-2 mb-1.5">
      <div class="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 shrink-0">
        <Icon name="lucide:lock" class="w-3 h-3 text-amber-700 dark:text-amber-400" />
      </div>
      <span class="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
        >Internal note</span
      >
      <span class="text-xs text-amber-700/70 dark:text-amber-400/70">· only visible to your team</span>
      <span class="ml-auto text-xs text-muted-foreground">{{ formattedTime }}</span>
    </div>
    <p class="text-sm text-foreground whitespace-pre-wrap break-words">{{ messageBody }}</p>
    <p class="text-xs text-muted-foreground mt-1.5">— {{ senderDisplayName }}</p>
  </div>

  <!-- Incoming (customer, left) / outgoing (agent, right) reply bubbles. -->
  <div
    v-else
    class="flex items-end gap-2 my-2"
    :class="isOutgoing ? 'flex-row-reverse' : 'flex-row'"
    :data-testid="`support-message-${message.kind}`"
  >
    <Avatar class="h-7 w-7 shrink-0 mb-4">
      <AvatarFallback class="text-xs">{{ initials(senderDisplayName) }}</AvatarFallback>
    </Avatar>
    <div class="flex flex-col max-w-[75%]" :class="isOutgoing ? 'items-end' : 'items-start'">
      <span class="text-xs text-muted-foreground mb-1 px-1">{{ senderDisplayName }}</span>
      <div
        class="rounded-2xl px-3.5 py-2.5"
        :class="
          isOutgoing ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'
        "
      >
        <p class="text-sm whitespace-pre-wrap break-words">{{ messageBody }}</p>
      </div>
      <div class="flex items-center gap-1.5 mt-1 px-1">
        <span class="text-xs text-muted-foreground">{{ formattedTime }}</span>
        <Icon
          v-if="isOutgoing && message.deliveryStatus === 'failed'"
          name="lucide:alert-circle"
          class="w-3 h-3 text-destructive"
        />
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SupportMessageItem',

  props: {
    message: {
      type: Object,
      required: true,
    },
    // The conversation's contact - resolves the display name/avatar for `incoming` messages.
    contact: {
      type: Object,
      default: null,
    },
    // Inbox members - resolves the display name for `outgoing`/`note` messages (senderUserId).
    members: {
      type: Array,
      default: () => [],
    },
  },

  computed: {
    isOutgoing() {
      return this.message.kind === 'outgoing'
    },

    messageBody() {
      // `bodyHtml` is sanitized on ingest per design.md, but Stage 02 has no
      // mail pipeline yet - messages here are agent/API-created. Never
      // `v-html` provider content (see design.md Risks); fall back to the
      // plain-text `body` and only use `bodyHtml` as a last resort, stripped
      // of markup rather than rendered.
      if (this.message.body) return this.message.body
      if (this.message.bodyHtml) return this.stripHtml(this.message.bodyHtml)
      return ''
    },

    senderDisplayName() {
      if (this.message.senderKind === 'contact') {
        return this.contact?.name || this.contact?.email || 'Customer'
      }
      if (this.message.senderKind === 'agent') {
        const member = this.members.find((m) => m.userId === this.message.senderUserId)
        return member?.userName || member?.userEmail || 'Agent'
      }
      return 'System'
    },

    formattedTime() {
      if (!this.message.createdAt) return ''
      const date = new Date(this.message.createdAt)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMin = Math.floor(diffMs / 60000)

      if (diffMin < 1) return 'just now'
      if (diffMin < 60) return `${diffMin}m ago`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return `${diffHr}h ago`
      const diffDays = Math.floor(diffHr / 24)
      if (diffDays < 7) return `${diffDays}d ago`
      return date.toLocaleDateString()
    },
  },

  methods: {
    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },

    stripHtml(html) {
      if (!import.meta.client) return html.replace(/<[^>]*>/g, '')
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return doc.body.textContent || ''
    },
  },
}
</script>
