<template>
  <Card data-testid="language-consent">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="flex items-center gap-2">
        <Icon name="lucide:shield-check" class="h-5 w-5" />
        Data sent to your AI provider
      </CardTitle>
      <CardDescription>
        Nothing is sent unless you switch a source on. Both sources are off by default and apply to your whole team.
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-5">
      <ul class="space-y-1 text-sm text-muted-foreground" data-testid="language-consent-details">
        <li>
          <span class="font-medium text-foreground">What:</span>
          feedback titles, descriptions and public comments, and the text of incoming customer support messages for this
          product. Hidden feedback, internal notes and agent replies are never used. Feedback created from a support
          conversation counts as support text. Titles of feedback linked to changelog entries are also included in
          announcement drafts when feedback text is on.
        </li>
        <li>
          <span class="font-medium text-foreground">When:</span>
          only items from the last 90 days, newest first, at most 300 items per analysis.
        </li>
        <li>
          <span class="font-medium text-foreground">Privacy:</span>
          email addresses, links and phone numbers are removed before anything leaves Veerify. Names are not sent.
        </li>
        <li>
          <span class="font-medium text-foreground">Who receives it:</span>
          your own Anthropic key (or another provider key you added, if there is no valid Anthropic key), so the text
          goes to that provider under your account and terms. Veerify does not use any other AI service for this.
        </li>
      </ul>

      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label for="language-consent-feedback" class="font-medium">Feedback text</Label>
            <p class="text-xs text-muted-foreground">Visible feedback posts and public comments</p>
          </div>
          <Switch
            id="language-consent-feedback"
            :model-value="consent.allowFeedbackText"
            :disabled="!canManage || saving"
            data-testid="language-consent-feedback"
            @update:model-value="toggle('allowFeedbackText', $event)"
          />
        </div>
        <div class="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label for="language-consent-support" class="font-medium">Support text</Label>
            <p class="text-xs text-muted-foreground">Incoming customer messages in your support inbox</p>
          </div>
          <Switch
            id="language-consent-support"
            :model-value="consent.allowSupportText"
            :disabled="!canManage || saving"
            data-testid="language-consent-support"
            @update:model-value="toggle('allowSupportText', $event)"
          />
        </div>
      </div>

      <p v-if="!canManage" class="text-sm text-muted-foreground" data-testid="language-consent-readonly">
        Only team admins can change these settings.
      </p>
      <p v-if="consent.consentedAt" class="text-xs text-muted-foreground">
        Last changed by {{ consent.consentedBy || 'a former member' }} on {{ formatDate(consent.consentedAt) }}.
      </p>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    </CardContent>

    <Dialog :open="pending !== null" @update:open="onDialogOpen">
      <DialogContent class="sm:max-w-[520px]" data-testid="language-consent-dialog">
        <DialogHeader>
          <DialogTitle>Send {{ pendingLabel }} to your AI provider?</DialogTitle>
          <DialogDescription>
            When you run an analysis, {{ pendingLabel }} from the last 90 days (up to 300 items, with emails, links and
            phone numbers removed) is sent to your own Anthropic, OpenAI, Gemini or Perplexity account. You can switch
            this off at any time and it takes effect immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="saving" @click="pending = null">Cancel</Button>
          <Button :disabled="saving" data-testid="language-consent-confirm" @click="confirm">
            {{ saving ? 'Saving...' : 'Allow' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>

<script>
import { toast } from 'vue-sonner'
import { apiErrorMessage } from '~/lib/api-error'

const LABELS = {
  allowFeedbackText: 'feedback text',
  allowSupportText: 'support message text',
}

export default {
  name: 'MarketingLanguageConsent',

  props: {
    teamId: { type: String, required: true },
    consent: { type: Object, required: true },
    canManage: { type: Boolean, default: false },
  },

  emits: ['changed'],

  data() {
    return { pending: null, saving: false, error: null }
  },

  computed: {
    pendingLabel() {
      return this.pending ? LABELS[this.pending] : ''
    },
  },

  methods: {
    formatDate(value) {
      return new Date(value).toLocaleString()
    },

    toggle(key, value) {
      if (!this.canManage) return
      this.error = null
      // Turning a source on needs an explicit confirmation; turning off is immediate
      if (value) this.pending = key
      else this.save(key, false)
    },

    onDialogOpen(open) {
      if (!open) this.pending = null
    },

    async confirm() {
      if (this.pending) await this.save(this.pending, true)
    },

    async save(key, value) {
      this.saving = true
      this.error = null
      try {
        await $fetch(`/api/marketing/teams/${this.teamId}/data-consent`, {
          method: 'PUT',
          body: {
            allowFeedbackText: this.consent.allowFeedbackText,
            allowSupportText: this.consent.allowSupportText,
            [key]: value,
          },
        })
        this.pending = null
        toast.success(value ? 'Source allowed' : 'Source switched off')
        this.$emit('changed')
      } catch (err) {
        this.error = apiErrorMessage(err, 'Could not save the setting')
        this.pending = null
      } finally {
        this.saving = false
      }
    },
  },
}
</script>
