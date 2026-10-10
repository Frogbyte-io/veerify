<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[520px]" data-testid="reviews-send-dialog">
      <DialogHeader>
        <DialogTitle>Send review requests</DialogTitle>
        <DialogDescription>
          Up to {{ maxEmails }} addresses, one per line or separated by commas. The same rules as automatic requests
          apply: unsubscribed addresses and addresses asked within the cooldown are skipped.
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-3" @submit.prevent="send">
        <Textarea
          v-model="text"
          rows="5"
          placeholder="jane@example.com"
          aria-label="Email addresses"
          :disabled="sending"
          data-testid="reviews-send-emails"
        />
        <p class="text-xs text-muted-foreground">{{ parsed.length }} of {{ maxEmails }} addresses</p>

        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

        <ul v-if="results" class="space-y-1 text-sm" data-testid="reviews-send-results">
          <li v-for="result in results" :key="result.email" class="flex items-center justify-between gap-2">
            <span class="truncate">{{ result.email }}</span>
            <Badge :variant="result.queued ? 'default' : 'outline'">
              {{ result.queued ? 'Queued' : reasonLabel(result.reason) }}
            </Badge>
          </li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="ghost" :disabled="sending" @click="onOpenChange(false)">Close</Button>
          <Button type="submit" :disabled="sending || parsed.length === 0 || parsed.length > maxEmails">
            <Icon v-if="sending" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
            Send
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script>
import { apiErrorDetails, apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const MAX_EMAILS = 20

const REASONS = {
  invalid_email: 'Invalid address',
  no_settings: 'Not set up',
  disabled: 'Requests are off',
  trigger_off: 'Trigger off',
  marketing_off: 'Marketing is off',
  suppressed: 'Unsubscribed',
  cooldown: 'Asked recently',
  duplicate: 'Already queued',
  unknown_project: 'Unknown product',
}

export default {
  name: 'MarketingReviewsSendDialog',

  props: {
    open: { type: Boolean, default: false },
    projectId: { type: String, required: true },
  },

  emits: ['update:open', 'forbidden', 'sent'],

  data() {
    return { text: '', sending: false, error: null, results: null, maxEmails: MAX_EMAILS }
  },

  computed: {
    parsed() {
      const seen = new Set()
      for (const part of this.text.split(/[\s,;]+/)) {
        const email = part.trim().toLowerCase()
        if (email) seen.add(email)
      }
      return [...seen]
    },
  },

  methods: {
    reasonLabel(reason) {
      return REASONS[reason] || 'Skipped'
    },

    onOpenChange(value) {
      if (!value) {
        this.text = ''
        this.error = null
        this.results = null
      }
      this.$emit('update:open', value)
    },

    async send() {
      const projectId = this.projectId
      this.sending = true
      this.error = null
      this.results = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/reviews/requests`, {
          method: 'POST',
          body: { emails: this.parsed },
        })
        if (projectId !== this.projectId) return
        this.results = response.data.results
        this.$emit('sent')
      } catch (err) {
        if (projectId !== this.projectId) return
        if (apiErrorStatus(err) === 403) {
          // Either marketing is off or the user is not an admin; the message says which.
          this.error = apiErrorMessage(err, 'You do not have permission to send requests')
        } else {
          const details = apiErrorDetails(err)
          const detail = Array.isArray(details) ? details.find((issue) => issue?.message)?.message : null
          this.error = detail || apiErrorMessage(err, 'Could not send the requests')
        }
      } finally {
        if (projectId === this.projectId) this.sending = false
      }
    },
  },
}
</script>
