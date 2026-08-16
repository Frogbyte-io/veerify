<template>
  <!-- The whole composer changes appearance in note mode, not just the toggle.
       An agent posting an internal note as a public reply is the worst failure
       mode in this product (stage-02 acceptance criterion 4), so mode is
       signalled by the container, the tabs, the placeholder, the caption, and
       the submit button - not by one highlighted tab. -->
  <div
    class="border-t p-3 transition-colors"
    :class="isNote ? 'bg-amber-500/10 dark:bg-amber-500/[0.08] border-t-amber-400/70' : 'bg-background'"
    :data-testid="`support-composer-${mode}`"
    :data-composer-mode="mode"
  >
    <div class="flex items-center gap-1 mb-2">
      <button
        type="button"
        data-testid="support-composer-mode-reply"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        :class="
          !isNote ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        "
        :aria-pressed="!isNote"
        @click="setMode('reply')"
      >
        <Icon name="lucide:reply" class="w-3.5 h-3.5" />
        Reply
      </button>
      <button
        type="button"
        data-testid="support-composer-mode-note"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        :class="
          isNote
            ? 'bg-amber-500 text-white dark:bg-amber-500 dark:text-amber-950'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        "
        :aria-pressed="isNote"
        @click="setMode('note')"
      >
        <Icon name="lucide:lock" class="w-3.5 h-3.5" />
        Internal note
      </button>

      <span
        v-if="isNote"
        data-testid="support-composer-note-caption"
        class="ml-auto text-xs font-medium text-amber-700 dark:text-amber-400"
      >
        Only your team will see this
      </span>
      <span v-else class="ml-auto text-xs text-muted-foreground"> Visible to the customer </span>
    </div>

    <textarea
      ref="input"
      v-model="draft"
      data-testid="support-composer-input"
      rows="3"
      :placeholder="placeholder"
      :disabled="submitting"
      class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      :class="isNote ? 'border-amber-400/70' : 'border-input'"
      @keydown.ctrl.enter.prevent="submit"
      @keydown.meta.enter.prevent="submit"
    />

    <div class="flex items-center justify-between mt-2">
      <p class="text-xs text-muted-foreground">
        <template v-if="isNote">Internal notes are stored on the ticket and never emailed.</template>
        <template v-else>Replies are stored on the ticket. Sending by email arrives in a later stage.</template>
      </p>

      <Button
        size="sm"
        data-testid="support-composer-submit"
        :disabled="!canSubmit"
        :class="isNote ? 'bg-amber-500 hover:bg-amber-600 text-white dark:text-amber-950' : ''"
        @click="submit"
      >
        <Icon v-if="submitting" name="lucide:loader-circle" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
        <Icon v-else :name="isNote ? 'lucide:lock' : 'lucide:send'" class="w-3.5 h-3.5 mr-1.5" />
        {{ isNote ? 'Add internal note' : 'Send reply' }}
      </Button>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'SupportComposer',

  props: {
    conversationId: {
      type: String,
      required: true,
    },
  },

  emits: ['posted'],

  data() {
    return {
      mode: 'reply',
      draft: '',
      submitting: false,
    }
  },

  computed: {
    isNote() {
      return this.mode === 'note'
    },
    placeholder() {
      return this.isNote ? 'Write an internal note for your team…' : 'Write a reply to the customer…'
    },
    canSubmit() {
      return !this.submitting && this.draft.trim().length > 0
    },
  },

  watch: {
    // A draft belongs to the conversation it was written in. Carrying it across
    // a selection change risks posting it to the wrong ticket. Mode resets too,
    // so a note draft can never silently become the next ticket's reply.
    conversationId() {
      this.draft = ''
      this.mode = 'reply'
      this.submitting = false
    },
  },

  methods: {
    setMode(mode) {
      if (this.submitting) return
      this.mode = mode
    },

    async submit() {
      if (!this.canSubmit) return

      this.submitting = true
      const kind = this.isNote ? 'note' : 'outgoing'
      const body = this.draft.trim()

      try {
        await $fetch(`/api/support/conversations/${this.conversationId}/messages`, {
          method: 'POST',
          body: { kind, body },
        })

        this.draft = ''
        // Mode deliberately persists after posting - an agent adding several
        // notes in a row should not have to reselect the mode each time, and
        // the composer stays visibly amber so the mode is never ambiguous.
        this.$emit('posted')
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to post message')
      } finally {
        this.submitting = false
      }
    },
  },
}
</script>
