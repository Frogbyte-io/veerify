<template>
  <div class="space-y-6" data-testid="language-results">
    <p class="text-sm text-muted-foreground" data-testid="language-meta">
      Last analysis {{ new Date(insight.createdAt).toLocaleString() }} from {{ insight.itemCount }} items ({{
        sourceLabel
      }}).
    </p>

    <Card>
      <CardHeader>
        <CardTitle>How customers describe things</CardTitle>
        <CardDescription>Recurring phrases in their own words, with approximate mention counts.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <p v-if="insight.phrases.length === 0" class="text-sm text-muted-foreground">No recurring phrases found.</p>
        <section v-for="group in groups" :key="group.kind" :data-testid="`language-group-${group.kind}`">
          <h3 class="mb-2 text-sm font-medium">{{ group.label }}</h3>
          <ul class="divide-y rounded-md border">
            <li
              v-for="p in group.phrases"
              :key="p.phrase"
              class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span>{{ p.phrase }}</span>
              <Badge variant="secondary">{{ p.mentions }} {{ p.mentions === 1 ? 'mention' : 'mentions' }}</Badge>
            </li>
          </ul>
        </section>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Suggestions</CardTitle>
        <CardDescription>Tick what you want to track, then add it to your Marketing setup.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-5">
        <p v-if="!hasSuggestions" class="text-sm text-muted-foreground">
          Nothing new to suggest. Everything found is already tracked.
        </p>

        <section v-if="insight.suggestedTerms.length" data-testid="language-terms">
          <h3 class="mb-2 text-sm font-medium">Terms to monitor</h3>
          <ul class="space-y-2">
            <li v-for="t in insight.suggestedTerms" :key="termKey(t)" class="flex items-center gap-2 text-sm">
              <input
                :id="`term-${termKey(t)}`"
                v-model="selectedTerms"
                type="checkbox"
                class="h-4 w-4"
                :value="termKey(t)"
                :data-testid="`language-term-${termKey(t)}`"
              />
              <label :for="`term-${termKey(t)}`" class="flex flex-1 items-center gap-2">
                <span>{{ t.label }}</span>
                <Badge variant="outline">{{ t.kind }}</Badge>
              </label>
            </li>
          </ul>
        </section>

        <section v-if="insight.suggestedPrompts.length" data-testid="language-prompts">
          <h3 class="mb-2 text-sm font-medium">AI visibility prompts</h3>
          <ul class="space-y-2">
            <li v-for="(prompt, i) in insight.suggestedPrompts" :key="prompt" class="flex items-start gap-2 text-sm">
              <input
                :id="`prompt-${i}`"
                v-model="selectedPrompts"
                type="checkbox"
                class="mt-0.5 h-4 w-4"
                :value="prompt"
                :data-testid="`language-prompt-${i}`"
              />
              <label :for="`prompt-${i}`">{{ prompt }}</label>
            </li>
          </ul>
        </section>

        <div v-if="hasSuggestions" class="flex items-center gap-3">
          <Button
            :disabled="applying || selectedCount === 0"
            data-testid="language-apply"
            @click="$emit('apply', { terms: pickedTerms, prompts: selectedPrompts })"
          >
            {{ applying ? 'Adding...' : `Add selected (${selectedCount})` }}
          </Button>
          <p v-if="applyError" class="text-sm text-destructive">{{ applyError }}</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script>
const GROUPS = [
  { kind: 'pain', label: 'Pain points' },
  { kind: 'feature', label: 'Requested features' },
  { kind: 'praise', label: 'Praise' },
  { kind: 'comparison', label: 'Alternatives and comparisons' },
]

export default {
  name: 'MarketingLanguageResults',

  props: {
    insight: { type: Object, required: true },
    applying: { type: Boolean, default: false },
    applyError: { type: String, default: null },
  },

  emits: ['apply'],

  data() {
    return { selectedTerms: [], selectedPrompts: [] }
  },

  computed: {
    groups() {
      return GROUPS.map((g) => ({
        ...g,
        phrases: this.insight.phrases.filter((p) => p.kind === g.kind).sort((a, b) => b.mentions - a.mentions),
      })).filter((g) => g.phrases.length > 0)
    },
    sourceLabel() {
      return this.insight.sources.map((s) => (s === 'support' ? 'support messages' : 'feedback')).join(' and ')
    },
    hasSuggestions() {
      return this.insight.suggestedTerms.length > 0 || this.insight.suggestedPrompts.length > 0
    },
    pickedTerms() {
      return this.insight.suggestedTerms.filter((t) => this.selectedTerms.includes(this.termKey(t)))
    },
    selectedCount() {
      return this.selectedTerms.length + this.selectedPrompts.length
    },
  },

  watch: {
    'insight.id'() {
      this.clearSelection()
    },
  },

  methods: {
    termKey(t) {
      return `${t.kind}:${t.label}`
    },
    clearSelection() {
      this.selectedTerms = []
      this.selectedPrompts = []
    },
  },
}
</script>
