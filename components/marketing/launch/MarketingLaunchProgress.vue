<template>
  <div class="rounded-lg border border-border bg-card p-4" data-testid="launch-progress">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-sm font-medium">Progress</h2>
      <p class="text-sm text-muted-foreground" data-testid="launch-progress-summary">
        {{ done }} of {{ progress.total }} done ({{ percent }}%)
      </p>
    </div>
    <div
      class="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label="Launch kit progress"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
    >
      <div class="bg-emerald-500 transition-all" :style="{ width: `${share('live')}%` }" />
      <div class="bg-sky-500 transition-all" :style="{ width: `${share('submitted')}%` }" />
      <div class="bg-amber-500 transition-all" :style="{ width: `${share('in_progress')}%` }" />
    </div>
    <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li v-for="status in statuses" :key="status.value" :data-testid="`launch-count-${status.value}`">
        <span class="font-medium text-foreground">{{ progress.counts[status.value] || 0 }}</span>
        {{ status.label }}
      </li>
    </ul>
  </div>
</template>

<script>
import { LAUNCH_STATUSES } from '~/lib/marketing-launch'

export default {
  name: 'MarketingLaunchProgress',

  props: {
    progress: { type: Object, required: true },
  },

  data() {
    return { statuses: LAUNCH_STATUSES }
  },

  computed: {
    // Live, submitted and skipped count as handled; rejected stays visible as work left.
    done() {
      const c = this.progress.counts
      return (c.live || 0) + (c.submitted || 0) + (c.skipped || 0)
    },
    percent() {
      return this.progress.total ? Math.round((this.done / this.progress.total) * 100) : 0
    },
  },

  methods: {
    share(status) {
      return this.progress.total ? ((this.progress.counts[status] || 0) / this.progress.total) * 100 : 0
    },
  },
}
</script>
