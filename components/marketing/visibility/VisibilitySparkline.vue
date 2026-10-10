<template>
  <div data-testid="visibility-trend">
    <p v-if="points.length < 2" class="text-sm text-muted-foreground">
      The trend appears after at least two finished runs.
    </p>
    <template v-else>
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        class="h-16 w-full text-primary"
        role="img"
        :aria-label="`Mention rate over the last ${points.length} runs, latest ${latestLabel}`"
        preserveAspectRatio="none"
      >
        <line :x1="0" :x2="width" :y1="height - 1" :y2="height - 1" class="stroke-border" stroke-width="1" />
        <polyline
          :points="polyline"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
        <!-- Zero-length round-capped lines stay round under preserveAspectRatio="none" -->
        <line
          v-for="(point, index) in coords"
          :key="index"
          :x1="point.x"
          :x2="point.x"
          :y1="point.y"
          :y2="point.y"
          stroke="currentColor"
          stroke-width="6"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        >
          <title>{{ point.title }}</title>
        </line>
      </svg>
      <div class="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{{ firstDate }}</span>
        <span>Latest {{ latestLabel }}</span>
      </div>
    </template>
  </div>
</template>

<script>
export default {
  name: 'VisibilitySparkline',

  props: {
    /** [{ at, rate (0..1), mentioned, total }] in chronological order */
    points: { type: Array, default: () => [] },
  },

  data() {
    return { width: 240, height: 48 }
  },

  computed: {
    coords() {
      const count = this.points.length
      const pad = 4
      return this.points.map((point, index) => ({
        x: count === 1 ? this.width / 2 : pad + (index * (this.width - pad * 2)) / (count - 1),
        y: pad + (1 - Math.min(1, Math.max(0, point.rate))) * (this.height - pad * 2),
        title: `${this.formatDate(point.at)}: ${Math.round(point.rate * 100)}% (${point.mentioned}/${point.total})`,
      }))
    },
    polyline() {
      return this.coords.map((c) => `${c.x},${c.y}`).join(' ')
    },
    latestLabel() {
      const last = this.points[this.points.length - 1]
      return last ? `${Math.round(last.rate * 100)}%` : ''
    },
    firstDate() {
      return this.points.length ? this.formatDate(this.points[0].at) : ''
    },
  },

  methods: {
    formatDate(value) {
      return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    },
  },
}
</script>
