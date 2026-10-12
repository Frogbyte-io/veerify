<template>
  <Card data-testid="audit-history">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="text-base">Audit history</CardTitle>
    </CardHeader>
    <CardContent>
      <ul class="space-y-1">
        <li v-for="item in audits" :key="item.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50"
            :class="item.id === selectedId ? 'bg-muted' : ''"
            :data-testid="`audit-history-${item.id}`"
            @click="$emit('select', item.id)"
          >
            <span class="w-10 text-lg font-semibold tabular-nums">{{ item.score === null ? '-' : item.score }}</span>
            <span class="flex-1">
              <span class="block">{{ formatDate(item.finishedAt || item.startedAt) }}</span>
              <span class="block text-xs text-muted-foreground">
                {{ triggerLabel(item.trigger) }}, {{ item.mode === 'full' ? 'full crawl' : 'basic' }}
              </span>
            </span>
            <Badge v-if="item.status !== 'done'" :variant="item.status === 'failed' ? 'destructive' : 'outline'">
              {{ item.status }}
            </Badge>
          </button>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>

<script>
const TRIGGERS = { auto: 'First audit', schedule: 'Weekly', manual: 'Manual' }

export default {
  name: 'MarketingAuditHistory',

  props: {
    audits: { type: Array, default: () => [] },
    selectedId: { type: String, default: null },
  },

  emits: ['select'],

  methods: {
    triggerLabel(trigger) {
      return TRIGGERS[trigger] || trigger
    },
    formatDate(value) {
      if (!value) return 'Pending'
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    },
  },
}
</script>
