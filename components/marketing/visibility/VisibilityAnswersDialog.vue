<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[760px]" data-testid="visibility-answers-dialog">
      <DialogHeader>
        <DialogTitle>Sampled answers</DialogTitle>
        <DialogDescription>{{ promptText }}</DialogDescription>
      </DialogHeader>

      <div v-if="isLoading" class="space-y-3">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-24 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <p v-else-if="answers.length === 0" class="text-sm text-muted-foreground">No answers stored for this prompt.</p>

      <div v-else class="space-y-4">
        <article
          v-for="answer in answers"
          :key="answer.id"
          class="rounded-md border p-3"
          data-testid="visibility-answer"
        >
          <header class="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{{ providerLabel(answer.provider) }}</Badge>
            <span class="text-muted-foreground">Sample {{ answer.sample }}</span>
            <Badge v-if="answer.status === 'failed'" variant="destructive">Failed</Badge>
            <Badge v-else-if="answer.status === 'pending'" variant="outline">Pending</Badge>
            <template v-else>
              <Badge :variant="answer.brandMentioned ? 'default' : 'outline'">
                {{ answer.brandMentioned ? 'Brand mentioned' : 'Brand not mentioned' }}
              </Badge>
              <span v-if="answer.brandRank" class="text-muted-foreground">Rank #{{ answer.brandRank }}</span>
              <span v-if="answer.brandSentiment" class="text-muted-foreground"
                >Sentiment: {{ answer.brandSentiment }}</span
              >
            </template>
          </header>

          <p v-if="answer.status === 'failed'" class="text-sm text-destructive">{{ answer.error }}</p>
          <!-- Plain text only: provider output is untrusted, never rendered as HTML -->
          <p v-else-if="answer.answer" class="whitespace-pre-wrap break-words text-sm">{{ answer.answer }}</p>

          <p
            v-if="answer.competitorsMentioned && answer.competitorsMentioned.length"
            class="mt-2 text-xs text-muted-foreground"
          >
            Competitors named: {{ answer.competitorsMentioned.map((c) => c.label).join(', ') }}
          </p>

          <ul v-if="answer.citations && answer.citations.length" class="mt-2 space-y-1 text-xs">
            <li v-for="citation in answer.citations" :key="citation.url">
              <a
                v-if="isHttpUrl(citation.url)"
                :href="citation.url"
                target="_blank"
                rel="noopener noreferrer"
                class="break-all text-primary hover:underline"
              >
                {{ citation.title || citation.url }}
              </a>
              <span v-else class="break-all text-muted-foreground">{{ citation.title || citation.url }}</span>
            </li>
          </ul>
        </article>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'

const PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI' }

export default {
  name: 'VisibilityAnswersDialog',

  props: {
    open: { type: Boolean, default: false },
    projectId: { type: String, required: true },
    runId: { type: String, default: null },
    promptId: { type: String, default: null },
    promptText: { type: String, default: '' },
  },

  emits: ['update:open'],

  data() {
    return { answers: [], isLoading: false, error: null }
  },

  watch: {
    open(value) {
      if (value) this.load()
    },
  },

  methods: {
    providerLabel(id) {
      return PROVIDER_LABELS[id] || id
    },

    // Only http(s) links are clickable; anything else renders as text
    isHttpUrl(value) {
      try {
        const protocol = new URL(value).protocol
        return protocol === 'https:' || protocol === 'http:'
      } catch {
        return false
      }
    },

    async load() {
      if (!this.runId || !this.promptId) return
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(
          `/api/marketing/projects/${this.projectId}/visibility/runs/${this.runId}/answers`,
          { query: { promptId: this.promptId } }
        )
        this.answers = response.data.answers
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load answers')
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
