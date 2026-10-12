<template>
  <Card data-testid="search-chart">
    <CardHeader>
      <CardTitle class="text-base">Clicks and impressions</CardTitle>
      <CardDescription>Daily totals. Each line uses its own scale.</CardDescription>
    </CardHeader>
    <CardContent>
      <p v-if="daily.length < 2" class="text-sm text-muted-foreground">
        The chart appears once at least two days of data have synced.
      </p>
      <template v-else>
        <div class="mb-2 flex gap-4 text-xs text-muted-foreground">
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-0.5 w-4 bg-blue-500" />
            Clicks (max {{ formatNumber(maxClicks) }})
          </span>
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-0.5 w-4 bg-amber-500" />
            Impressions (max {{ formatNumber(maxImpressions) }})
          </span>
        </div>
        <svg
          :viewBox="`0 0 ${width} ${height}`"
          class="h-48 w-full"
          preserveAspectRatio="none"
          role="img"
          :aria-label="`Daily clicks and impressions from ${firstDate} to ${lastDate}`"
        >
          <line
            v-for="y in gridLines"
            :key="y"
            :x1="0"
            :x2="width"
            :y1="y"
            :y2="y"
            class="stroke-border"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
          <polyline
            :points="impressionsLine"
            fill="none"
            class="stroke-amber-500"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
          <polyline
            :points="clicksLine"
            fill="none"
            class="stroke-blue-500"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
          <!-- Wide transparent bars give each day a hover tooltip -->
          <rect
            v-for="(point, index) in points"
            :key="point.date"
            :x="point.x - step / 2"
            :y="0"
            :width="step"
            :height="height"
            fill="transparent"
          >
            <title>{{ tooltip(daily[index]) }}</title>
          </rect>
        </svg>
        <div class="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{{ firstDate }}</span>
          <span>{{ lastDate }}</span>
        </div>
      </template>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingSearchChart',

  props: {
    /** [{ date: 'YYYY-MM-DD', clicks, impressions }] in chronological order */
    daily: { type: Array, default: () => [] },
  },

  data() {
    return { width: 600, height: 160, pad: 6 }
  },

  computed: {
    maxClicks() {
      return Math.max(1, ...this.daily.map((d) => d.clicks))
    },
    maxImpressions() {
      return Math.max(1, ...this.daily.map((d) => d.impressions))
    },
    step() {
      return this.daily.length > 1 ? this.width / (this.daily.length - 1) : this.width
    },
    points() {
      return this.daily.map((d, index) => ({
        date: d.date,
        x: this.daily.length > 1 ? (index * this.width) / (this.daily.length - 1) : this.width / 2,
        yClicks: this.scaleY(d.clicks, this.maxClicks),
        yImpressions: this.scaleY(d.impressions, this.maxImpressions),
      }))
    },
    clicksLine() {
      return this.points.map((p) => `${p.x},${p.yClicks}`).join(' ')
    },
    impressionsLine() {
      return this.points.map((p) => `${p.x},${p.yImpressions}`).join(' ')
    },
    gridLines() {
      return [this.pad, this.height / 2, this.height - this.pad]
    },
    firstDate() {
      return this.daily.length ? this.formatDate(this.daily[0].date) : ''
    },
    lastDate() {
      return this.daily.length ? this.formatDate(this.daily[this.daily.length - 1].date) : ''
    },
  },

  methods: {
    scaleY(value, max) {
      return this.pad + (1 - value / max) * (this.height - this.pad * 2)
    },
    formatNumber(value) {
      return new Intl.NumberFormat().format(value)
    },
    formatDate(value) {
      return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    },
    tooltip(day) {
      return `${this.formatDate(day.date)}: ${this.formatNumber(day.clicks)} clicks, ${this.formatNumber(day.impressions)} impressions`
    },
  },
}
</script>
