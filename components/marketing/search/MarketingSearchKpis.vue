<template>
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="search-kpis">
    <Card v-for="kpi in kpis" :key="kpi.key" :data-testid="`search-kpi-${kpi.key}`">
      <CardContent class="p-4">
        <p class="text-sm text-muted-foreground">{{ kpi.label }}</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ kpi.value }}</p>
        <p
          v-if="kpi.delta"
          class="mt-1 text-xs tabular-nums"
          :class="kpi.delta.good ? 'text-emerald-600' : 'text-destructive'"
        >
          {{ kpi.delta.text }}
          <span class="text-muted-foreground">vs previous {{ days }} days</span>
        </p>
        <p v-else class="mt-1 text-xs text-muted-foreground">No previous period yet</p>
      </CardContent>
    </Card>
  </div>
</template>

<script>
export default {
  name: 'MarketingSearchKpis',

  props: {
    /** { current: {clicks, impressions, ctr, position}, previous: {...} | null } */
    totals: { type: Object, required: true },
    days: { type: Number, default: 28 },
  },

  computed: {
    kpis() {
      const { current, previous } = this.totals
      return [
        {
          key: 'clicks',
          label: 'Clicks',
          value: this.formatNumber(current.clicks),
          delta: previous ? this.relative(current.clicks, previous.clicks, true) : null,
        },
        {
          key: 'impressions',
          label: 'Impressions',
          value: this.formatNumber(current.impressions),
          delta: previous ? this.relative(current.impressions, previous.impressions, true) : null,
        },
        {
          key: 'ctr',
          label: 'Average CTR',
          value: `${(current.ctr * 100).toFixed(1)}%`,
          delta: previous ? this.absolute((current.ctr - previous.ctr) * 100, ' pp', true) : null,
        },
        {
          key: 'position',
          label: 'Average position',
          value: current.position ? current.position.toFixed(1) : '-',
          // A lower position number is better
          delta:
            previous && current.position && previous.position
              ? this.absolute(current.position - previous.position, '', false)
              : null,
        },
      ]
    },
  },

  methods: {
    formatNumber(value) {
      return new Intl.NumberFormat().format(value)
    },

    relative(now, before, higherIsBetter) {
      if (!before) return now ? { text: 'New', good: higherIsBetter } : null
      const pct = ((now - before) / before) * 100
      return {
        text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
        good: higherIsBetter ? pct >= 0 : pct <= 0,
      }
    },

    absolute(diff, unit, higherIsBetter) {
      const rounded = Math.round(diff * 10) / 10
      return {
        text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}${unit}`,
        good: higherIsBetter ? rounded >= 0 : rounded <= 0,
      }
    },
  },
}
</script>
