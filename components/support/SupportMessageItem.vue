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
      <span class="text-xs text-amber-700/70 dark:text-amber-400/70">· only visible to your project</span>
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
          v-if="deliveryNotices.length > 0"
          class="mt-2 space-y-0.5 border-t border-current/15 pt-2 text-xs opacity-90"
          data-testid="support-message-notices"
        >
          <p v-for="notice in deliveryNotices" :key="notice" class="flex items-start gap-1.5">
            <Icon name="lucide:info" class="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{{ notice }}</span>
          </p>
        </div>
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
      <div class="flex flex-wrap items-center gap-1.5 mt-1 px-1" :class="isOutgoing ? 'justify-end' : ''">
        <span class="text-xs text-muted-foreground">{{ formattedTime }}</span>
        <template v-if="isOutgoing">
          <span
            v-if="message.deliveryStatus === 'pending'"
            class="flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="support-message-delivery-pending"
          >
            <Icon name="lucide:clock" class="w-3 h-3 shrink-0" aria-hidden="true" />
            {{ pendingLabel }}
          </span>
          <span
            v-else-if="message.deliveryStatus === 'sent' || message.deliveryStatus === 'delivered'"
            class="flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="support-message-delivery-sent"
            :data-status="message.deliveryStatus"
          >
            <Icon
              :name="message.deliveryStatus === 'delivered' ? 'lucide:check-check' : 'lucide:check'"
              class="w-3 h-3 shrink-0"
              aria-hidden="true"
            />
            {{ message.deliveryStatus === 'delivered' ? 'Delivered' : 'Sent' }}
          </span>
          <span
            v-else-if="message.deliveryStatus === 'delayed'"
            class="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
            data-testid="support-message-delivery-delayed"
          >
            <Icon name="lucide:hourglass" class="w-3 h-3 shrink-0" aria-hidden="true" />
            Delayed – retrying
          </span>
          <span
            v-else-if="message.deliveryStatus === 'failed' || message.deliveryStatus === 'bounced'"
            class="flex flex-wrap items-center gap-1"
            data-testid="support-message-delivery-failed"
          >
            <Icon name="lucide:alert-circle" class="w-3 h-3 text-destructive shrink-0" aria-hidden="true" />
            <span v-if="isSenderBlocked" class="text-xs text-destructive" data-testid="support-message-sender-blocked">
              Not sent: the From address isn't verified for your project.
              <NuxtLink
                to="/project/settings?tab=email"
                class="underline hover:no-underline"
                data-testid="support-message-sender-link"
                >Verify the domain in Project settings → Email.</NuxtLink
              >
            </span>
            <span v-else class="text-xs text-destructive" data-testid="support-message-failure-reason">
              {{ failureLabel }}
            </span>
            <button
              v-if="message.deliveryStatus === 'failed' && message.retryable !== false"
              type="button"
              class="text-xs text-destructive underline hover:no-underline disabled:opacity-50 disabled:no-underline"
              data-testid="support-message-retry"
              :disabled="retrying"
              @click="requestRetry"
            >
              {{ retrying ? 'Retrying…' : 'Retry' }}
            </button>
          </span>
        </template>
      </div>
      <details
        v-if="isOutgoing && deliveryDetail"
        class="mt-0.5 max-w-full px-1 text-xs text-muted-foreground"
        data-testid="support-message-delivery-details"
      >
        <summary class="cursor-pointer select-none underline-offset-2 hover:underline">Details</summary>
        <p class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">{{ deliveryDetail }}</p>
      </details>
    </div>

    <Dialog :open="isRetryDialogOpen" @update:open="isRetryDialogOpen = $event">
      <DialogContent class="sm:max-w-[440px]" data-testid="support-message-retry-dialog">
        <DialogHeader>
          <DialogTitle>Send this reply again?</DialogTitle>
          <DialogDescription>
            The last attempt failed, but the mail provider may have accepted it anyway. If it did, the customer gets
            this reply twice.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" data-testid="support-message-retry-cancel" @click="isRetryDialogOpen = false">
            Cancel
          </Button>
          <Button data-testid="support-message-retry-confirm" @click="confirmRetry">Send again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import {
  DELIVERY_FAILURE_MESSAGES,
  SENDER_DOMAIN_NOT_AUTHORIZED,
  classifyDeliveryError,
} from '~/lib/support-delivery-errors'

/** Outbox markers are shown as their sentence; only provider text goes behind "Details". */
const MARKERS = new Set([SENDER_DOMAIN_NOT_AUTHORIZED, 'DELIVERY_ABANDONED'])

// Frogmail `skip_reason` values (Frogmail design §6.2).
const FORWARD_REASONS = {
  no_verdicts: 'the message did not arrive through Frogmail receiving',
  virus: 'flagged as a virus',
  spam: 'flagged as spam',
  dmarc: 'the sender failed DMARC',
  paused: 'the monthly forward limit was reached',
  unverified: 'the recipient has not confirmed yet',
  revoked: 'forwarding to it was stopped',
  suspended: 'the address bounced',
  loop: 'it would loop back',
  too_large: 'the message is too large',
  cap_address: 'the daily forward limit for this address was reached',
  cap_domain: 'the daily forward limit for this domain was reached',
}

function forwardReason(reason) {
  if (typeof reason !== 'string' || !reason) return ''
  return FORWARD_REASONS[reason] || reason.replace(/_/g, ' ')
}

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
      senderRetryBlocked: false,
      isRetryDialogOpen: false,
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

    /** The outbox refused to send because the From address is not authorized for the project. */
    isSenderBlocked() {
      return (
        this.senderRetryBlocked ||
        this.message.senderBlocked === true ||
        this.message.deliveryError === SENDER_DOMAIN_NOT_AUTHORIZED
      )
    },

    /** "Sending…", or "Sending… (attempt n of 5)" while the outbox retries. */
    pendingLabel() {
      const attempt = this.message.deliveryAttempt
      if (attempt && attempt.current > 1) return `Sending… (attempt ${attempt.current} of ${attempt.max})`
      return 'Sending…'
    },

    failureReason() {
      return this.message.failureReason || classifyDeliveryError(this.message.deliveryError)
    },

    /** Plain-language reason; the provider's own text stays behind "Details". */
    failureLabel() {
      const reason = this.failureReason
      if (this.message.deliveryStatus === 'bounced') {
        if (reason === 'unknown' && this.message.deliveryError) return `Bounced: ${this.message.deliveryError}`
        return reason === 'unknown' ? 'Bounced' : `Bounced: ${DELIVERY_FAILURE_MESSAGES[reason]}`
      }
      return `Not sent: ${DELIVERY_FAILURE_MESSAGES[reason] || DELIVERY_FAILURE_MESSAGES.unknown}`
    },

    /** Raw provider text for failed, bounced, delayed and retrying replies. */
    deliveryDetail() {
      const status = this.message.deliveryStatus
      const error = this.message.deliveryError
      if (!error || MARKERS.has(error)) return ''
      if (status === 'pending') return this.message.deliveryAttempt ? `Last attempt: ${error}` : ''
      if (status === 'bounced' && this.failureReason === 'unknown') return ''
      return ['failed', 'bounced', 'delayed'].includes(status) ? error : ''
    },

    /** Notes from Frogmail about forwarding and attachment removal on inbound mail. */
    deliveryNotices() {
      const metadata = this.message.mailNotes
      if (!metadata || typeof metadata !== 'object') return []
      const notices = []
      const forwards = Array.isArray(metadata.frogmailForwards) ? metadata.frogmailForwards : []
      for (const forward of forwards) {
        if (forward?.status !== 'skipped' && forward?.status !== 'failed') continue
        const reason = forwardReason(forward.reason)
        notices.push(`Not forwarded to ${forward.destination}${reason ? `: ${reason}` : ''}`)
      }
      if (metadata.attachmentsRemoved === true) notices.push('Attachments removed: flagged as a virus')
      return notices
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

    /** A blocked sender never reached the provider, so there is no duplicate risk to confirm. */
    requestRetry() {
      if (this.retrying || !this.conversationId) return
      if (this.isSenderBlocked) {
        this.retryDelivery()
        return
      }
      this.isRetryDialogOpen = true
    },

    confirmRetry() {
      this.isRetryDialogOpen = false
      this.retryDelivery()
    },

    async retryDelivery() {
      if (this.retrying || !this.conversationId) return
      this.retrying = true

      try {
        await $fetch(`/api/support/conversations/${this.conversationId}/messages/${this.message.id}/retry`, {
          method: 'POST',
        })
        this.senderRetryBlocked = false
        // Not set locally: the worker pass this triggers publishes a realtime
        // event once it actually resolves (server/utils/outbound-delivery.ts),
        // which is what refreshes `message.deliveryStatus` for real. Setting
        // 'pending' here too would just be a second, possibly-wrong copy of
        // the same fact.
      } catch (err) {
        const payload = err?.data?.data?.error || err?.data?.error || {}
        if (err?.statusCode === 409 && payload.code === 'SENDER_NOT_VERIFIED') {
          this.senderRetryBlocked = true
        } else {
          toast.error(payload.message || 'Failed to retry')
        }
      } finally {
        this.retrying = false
      }
    },
  },
}
</script>
