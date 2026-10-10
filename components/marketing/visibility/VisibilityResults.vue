<template>
  <div class="space-y-6" data-testid="visibility-results">
    <Card v-if="!data.run">
      <CardContent class="py-8 text-center text-sm text-muted-foreground">
        No finished run yet. Results appear here once the first run completes.
      </CardContent>
    </Card>

    <template v-else>
      <p class="text-xs text-muted-foreground" data-testid="visibility-approximation-note">
        Results come from the providers' APIs with web search enabled. They approximate, but do not replicate, what the
        consumer apps (ChatGPT, Claude, Gemini, Perplexity) show, and each prompt is sampled several times because
        answers vary. Run finished {{ formatDateTime(data.run.finishedAt || data.run.createdAt)
        }}<span v-if="data.run.status === 'partial'"> (partial: some answers failed)</span>.
      </p>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader class="pb-2"><CardDescription>Mention rate</CardDescription></CardHeader>
          <CardContent>
            <p class="text-3xl font-bold" data-testid="visibility-overall-rate">{{ percent(summary.overall.rate) }}</p>
            <p class="text-xs text-muted-foreground">
              {{ summary.overall.mentioned }} of {{ summary.overall.total }} answers
            </p>
          </CardContent>
        </Card>
        <Card v-for="provider in data.run.providers" :key="provider">
          <CardHeader class="pb-2"
            ><CardDescription>{{ providerLabel(provider) }}</CardDescription></CardHeader
          >
          <CardContent>
            <template v-if="summary.byProvider[provider]">
              <p class="text-3xl font-bold">{{ percent(summary.byProvider[provider].rate) }}</p>
              <p class="text-xs text-muted-foreground">
                {{ summary.byProvider[provider].mentioned }} of {{ summary.byProvider[provider].total }} answers
              </p>
            </template>
            <p v-else class="text-sm text-muted-foreground">No answers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader class="pb-2"><CardDescription>Average rank</CardDescription></CardHeader>
          <CardContent>
            <p class="text-3xl font-bold">
              {{ summary.averageRank == null ? '-' : `#${summary.averageRank.toFixed(1)}` }}
            </p>
            <p class="text-xs text-muted-foreground">Position among recommended products</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By prompt</CardTitle>
          <CardDescription
            >Share of sampled answers that mention your brand. Select a prompt to read the answers.</CardDescription
          >
        </CardHeader>
        <CardContent class="space-y-1">
          <div
            class="hidden grid-cols-[1fr_repeat(var(--cols),5rem)] gap-2 px-2 text-xs text-muted-foreground sm:grid"
            :style="{ '--cols': data.run.providers.length }"
          >
            <span>Prompt</span>
            <span v-for="provider in data.run.providers" :key="provider">{{ providerLabel(provider) }}</span>
          </div>
          <button
            v-for="row in summary.prompts"
            :key="row.promptId"
            type="button"
            class="grid w-full grid-cols-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/50 sm:grid-cols-[1fr_repeat(var(--cols),5rem)]"
            :style="{ '--cols': data.run.providers.length }"
            data-testid="visibility-prompt-result"
            @click="$emit('select-prompt', { id: row.promptId, text: row.text })"
          >
            <span>{{ row.text }}</span>
            <span v-for="provider in data.run.providers" :key="provider" class="tabular-nums">
              <span class="sm:hidden text-xs text-muted-foreground">{{ providerLabel(provider) }}: </span>
              {{ row.byProvider[provider] ? percent(row.byProvider[provider].rate) : '-' }}
            </span>
          </button>
          <p v-if="summary.prompts.length === 0" class="px-2 text-sm text-muted-foreground">
            No answered prompts in this run.
          </p>
        </CardContent>
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Share of voice</CardTitle>
            <CardDescription>Mentions of your brand compared with competitors.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <p v-if="summary.shareOfVoice.length <= 1" class="text-xs text-muted-foreground">
              Add competitors in Marketing settings to compare against them.
            </p>
            <div
              v-for="entry in summary.shareOfVoice"
              :key="entry.label"
              class="space-y-1"
              data-testid="visibility-sov-row"
            >
              <div class="flex justify-between text-sm">
                <span class="truncate">{{ entry.label }}</span>
                <span class="tabular-nums text-muted-foreground"
                  >{{ percent(entry.share) }} ({{ entry.mentions }})</span
                >
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.round(entry.share * 100)}%` }" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top cited domains</CardTitle>
            <CardDescription>Sources the assistants cite most for your prompts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p v-if="summary.topCitedDomains.length === 0" class="text-sm text-muted-foreground">
              No citations in this run.
            </p>
            <ul v-else class="space-y-1 text-sm">
              <li v-for="entry in summary.topCitedDomains" :key="entry.domain" class="flex justify-between">
                <span class="truncate">{{ entry.domain }}</span>
                <span class="tabular-nums text-muted-foreground">{{ entry.count }}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trend</CardTitle>
          <CardDescription>Mention rate across your last 12 finished runs.</CardDescription>
        </CardHeader>
        <CardContent>
          <VisibilitySparkline :points="data.trend" />
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<script>
const PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Google Gemini', perplexity: 'Perplexity' }

export default {
  name: 'VisibilityResults',

  props: {
    /** Response data of GET .../visibility/summary */
    data: { type: Object, required: true },
  },

  emits: ['select-prompt'],

  computed: {
    summary() {
      return this.data.summary
    },
  },

  methods: {
    providerLabel(id) {
      return PROVIDER_LABELS[id] || id
    },
    percent(rate) {
      return `${Math.round(rate * 100)}%`
    },
    formatDateTime(value) {
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    },
  },
}
</script>
