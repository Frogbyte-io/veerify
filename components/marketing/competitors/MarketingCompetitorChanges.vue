<template>
  <section class="space-y-3" data-testid="competitor-changes">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">
        Recent changes
        <Badge v-if="unseenCount" class="ml-2 shadow-none" data-testid="competitor-unseen-count">
          {{ unseenCount }} new
        </Badge>
      </h2>
      <Button
        v-if="unseenCount"
        variant="outline"
        size="sm"
        :disabled="marking"
        data-testid="competitor-mark-all-seen"
        @click="$emit('mark-seen')"
      >
        <Icon name="lucide:check-check" class="mr-1.5 h-4 w-4" />
        Mark all seen
      </Button>
    </div>

    <p v-if="!changes.length" class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      No changes detected yet. The first check of a page saves a baseline; changes show up after the next daily check.
    </p>

    <ul v-else class="space-y-2">
      <li
        v-for="change in changes"
        :key="change.id"
        class="rounded-lg border p-3"
        :class="change.seen ? 'border-border bg-card' : 'border-primary/40 bg-primary/5'"
        :data-testid="`competitor-change-${change.id}`"
      >
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{{ new Date(change.detectedAt).toLocaleString() }}</span>
          <span class="font-medium text-foreground">{{ change.competitor }}</span>
          <Badge variant="outline" class="shadow-none">{{ change.kind }}</Badge>
          <a
            :href="change.url"
            target="_blank"
            rel="noopener noreferrer"
            class="truncate underline-offset-2 hover:underline"
            >{{ change.url }}</a
          >
          <span v-if="!change.seen" class="font-medium text-primary">New</span>
        </div>

        <p v-if="change.summary" class="mt-2 text-sm" data-testid="competitor-change-summary">
          {{ change.summary }}
        </p>
        <p v-else class="mt-2 text-sm text-muted-foreground">
          {{ change.added.length }} line{{ change.added.length === 1 ? '' : 's' }} added,
          {{ change.removed.length }} removed
        </p>

        <Button variant="ghost" size="sm" class="mt-1 -ml-2" @click="toggle(change.id)">
          <Icon :name="isOpen(change.id) ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="mr-1 h-4 w-4" />
          {{ isOpen(change.id) ? 'Hide details' : 'Show details' }}
        </Button>

        <div v-if="isOpen(change.id)" class="mt-2 space-y-2 text-sm">
          <div v-if="change.removed.length">
            <p class="text-xs font-medium text-muted-foreground">Removed</p>
            <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/10 p-2 text-xs">{{
              change.removed.join('\n')
            }}</pre>
          </div>
          <div v-if="change.added.length">
            <p class="text-xs font-medium text-muted-foreground">Added</p>
            <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-primary/10 p-2 text-xs">{{
              change.added.join('\n')
            }}</pre>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<script>
export default {
  name: 'MarketingCompetitorChanges',

  props: {
    changes: { type: Array, required: true },
    unseenCount: { type: Number, default: 0 },
    marking: { type: Boolean, default: false },
  },

  emits: ['mark-seen'],

  data() {
    return { open: {} }
  },

  methods: {
    isOpen(id) {
      return Boolean(this.open[id])
    },
    toggle(id) {
      this.open = { ...this.open, [id]: !this.open[id] }
    },
  },
}
</script>
