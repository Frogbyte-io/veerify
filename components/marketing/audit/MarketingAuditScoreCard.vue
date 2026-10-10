<template>
  <Card data-testid="audit-score-card">
    <CardHeader>
      <CardTitle class="text-base">Site score</CardTitle>
    </CardHeader>
    <CardContent>
      <div v-if="audit.score === null" class="text-sm text-muted-foreground">
        No score yet. It appears when the audit finishes.
      </div>
      <div v-else class="flex flex-wrap items-end gap-6">
        <div>
          <div class="flex items-baseline gap-1">
            <span class="text-6xl font-bold tabular-nums" :class="bandClass" data-testid="audit-score">
              {{ audit.score }}
            </span>
            <span class="text-lg text-muted-foreground">/ 100</span>
          </div>
          <div v-if="delta !== null" class="mt-1 flex items-center gap-1 text-sm" :class="deltaClass">
            <Icon :name="delta >= 0 ? 'lucide:trending-up' : 'lucide:trending-down'" class="h-4 w-4" />
            <span>{{ delta > 0 ? '+' : '' }}{{ delta }} since the previous audit</span>
          </div>
          <p v-else class="mt-1 text-sm text-muted-foreground">First scored audit</p>
        </div>

        <svg
          v-if="trend.length > 1"
          :viewBox="`0 0 ${width} ${height}`"
          class="h-16 w-48 text-muted-foreground"
          role="img"
          aria-label="Score trend across recent audits"
        >
          <polyline :points="points" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          <circle
            v-for="(point, index) in coordinates"
            :key="index"
            :cx="point.x"
            :cy="point.y"
            r="3"
            :class="index === coordinates.length - 1 ? 'fill-foreground' : 'fill-muted-foreground'"
          />
        </svg>
      </div>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingAuditScoreCard',

  props: {
    audit: { type: Object, required: true },
    history: { type: Array, default: () => [] },
  },

  data() {
    return { width: 192, height: 64 }
  },

  computed: {
    bandClass() {
      const score = this.audit.score
      if (score >= 90) return 'text-emerald-600 dark:text-emerald-400'
      if (score >= 70) return 'text-amber-600 dark:text-amber-400'
      return 'text-destructive'
    },
    delta() {
      if (this.audit.score === null || this.audit.previousScore === null || this.audit.previousScore === undefined) {
        return null
      }
      return this.audit.score - this.audit.previousScore
    },
    deltaClass() {
      if (this.delta > 0) return 'text-emerald-600 dark:text-emerald-400'
      if (this.delta < 0) return 'text-destructive'
      return 'text-muted-foreground'
    },
    /** Scores of finished audits, oldest first */
    trend() {
      return this.history
        .filter((item) => item.status === 'done' && typeof item.score === 'number')
        .map((item) => item.score)
        .reverse()
    },
    coordinates() {
      const pad = 6
      const step = this.trend.length > 1 ? (this.width - pad * 2) / (this.trend.length - 1) : 0
      return this.trend.map((score, index) => ({
        x: pad + index * step,
        y: pad + (this.height - pad * 2) * (1 - score / 100),
      }))
    },
    points() {
      return this.coordinates.map((point) => `${point.x},${point.y}`).join(' ')
    },
  },
}
</script>
