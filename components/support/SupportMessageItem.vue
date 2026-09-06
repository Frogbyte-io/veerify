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
    <SupportMessageHtml v-if="renderableHtml" :html="renderableHtml" />
    <p v-else class="text-sm text-foreground whitespace-pre-wrap break-words">{{ messageBody }}</p>
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
        <SupportMessageHtml v-if="renderableHtml" :html="renderableHtml" />
        <p v-else class="text-sm whitespace-pre-wrap break-words">{{ messageBody }}</p>
        <div
          v-if="message.attachments && message.attachments.length > 0"
          class="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-current/15"
          data-testid="support-message-attachments"
        >
          <a
            v-for="attachment in message.attachments"
            :key="attachment.id"
            :href="attachment.downloadUrl"
            :download="attachment.fileName"
            class="inline-flex items-center gap-1.5 rounded-md border border-current/20 bg-black/5 px-2 py-1 text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`Download ${attachment.fileName}${attachment.sizeBytes ? ` (${formatBytes(attachment.sizeBytes)})` : ''}`"
            :data-testid="`support-message-attachment-${attachment.id}`"
          >
            <Icon name="lucide:paperclip" class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span class="max-w-[14rem] truncate">{{ attachment.fileName }}</span>
            <span v-if="attachment.sizeBytes" class="opacity-75">{{ formatBytes(attachment.sizeBytes) }}</span>
          </a>
        </div>
      </div>
      <div class="flex items-center gap-1.5 mt-1 px-1">
        <span class="text-xs text-muted-foreground">{{ formattedTime }}</span>
        <template v-if="isOutgoing">
          <Icon
            v-if="message.deliveryStatus === 'pending'"
            name="lucide:clock"
            class="w-3 h-3 text-muted-foreground"
            title="Sending…"
            data-testid="support-message-delivery-pending"
          />
          <Icon
            v-else-if="message.deliveryStatus === 'sent' || message.deliveryStatus === 'delivered'"
            name="lucide:check"
            class="w-3 h-3 text-muted-foreground"
            :title="message.deliveryStatus === 'delivered' ? 'Delivered' : 'Sent'"
            data-testid="support-message-delivery-sent"
          />
          <span
            v-else-if="message.deliveryStatus === 'failed' || message.deliveryStatus === 'bounced'"
            class="flex items-center gap-1"
            data-testid="support-message-delivery-failed"
          >
            <Icon name="lucide:alert-circle" class="w-3 h-3 text-destructive shrink-0" />
            <span class="text-xs text-destructive">{{
              message.deliveryStatus === 'bounced' ? 'Bounced' : 'Failed to send'
            }}</span>
            <button
              v-if="message.deliveryStatus === 'failed'"
              type="button"
              class="text-xs text-destructive underline hover:no-underline disabled:opacity-50 disabled:no-underline"
              data-testid="support-message-retry"
              :disabled="retrying"
              @click="retryDelivery"
            >
              {{ retrying ? 'Retrying…' : 'Retry' }}
            </button>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

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
    // Needed for the retry action's endpoint path - not required, since
    // `activity`/`note`/`incoming` items never render one.
    conversationId: {
      type: String,
      default: null,
    },
  },

  data() {
    return {
      retrying: false,
    }
  },

  computed: {
    isOutgoing() {
      return this.message.kind === 'outgoing'
    },

    /**
     * HTML is rendered only inside `SupportMessageHtml`'s sandboxed iframe,
     * never via `v-html`. `bodyHtml` is already sanitized on ingest
     * (`server/utils/inbound-sanitize.ts`); the iframe is the second of the two
     * layers `design.md` requires, not a substitute for the first.
     *
     * Only inbound mail carries HTML. Agent replies and notes are composed as
     * plain text, so they keep the simpler text rendering.
     */
    renderableHtml() {
      if (this.message.kind === 'activity') return null
      return this.message.bodyHtml || null
    },

    messageBody() {
      if (this.message.body) return this.message.body
      // Last resort: HTML with no plain-text alternative, shown as text rather
      // than rendered. `renderableHtml` handles the normal case above.
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

    formatBytes(value) {
      if (!Number.isFinite(value) || value < 0) return ''
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
      return `${(value / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
    },

    async retryDelivery() {
      if (this.retrying || !this.conversationId) return
      if (!window.confirm('The previous attempt may already have been accepted. Retrying could send a duplicate.')) {
        return
      }
      this.retrying = true

      try {
        await $fetch(`/api/support/conversations/${this.conversationId}/messages/${this.message.id}/retry`, {
          method: 'POST',
        })
        // Not set locally: the worker pass this triggers publishes a realtime
        // event once it actually resolves (server/utils/outbound-delivery.ts),
        // which is what refreshes `message.deliveryStatus` for real. Setting
        // 'pending' here too would just be a second, possibly-wrong copy of
        // the same fact.
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to retry')
      } finally {
        this.retrying = false
      }
    },
  },
}
</script>
