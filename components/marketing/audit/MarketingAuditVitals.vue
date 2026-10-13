<template>
  <Card data-testid="audit-vitals">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="text-base">Core Web Vitals</CardTitle>
      <CardDescription>Home page, mobile, from Google PageSpeed Insights.</CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="status === 'ok'" class="space-y-4">
        <div v-if="pagespeed.performanceScore !== null" class="text-sm">
          Performance score <span class="text-xl font-semibold tabular-nums">{{ pagespeed.performanceScore }}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div v-for="metric in labMetrics" :key="metric.label" class="rounded-lg border border-border p-3">
            <p class="text-xs text-muted-foreground">{{ metric.label }} (lab)</p>
            <p class="text-lg font-semibold tabular-nums">{{ metric.value }}</p>
          </div>
        </div>
        <div v-if="pagespeed.field">
          <p class="mb-2 text-sm font-medium">
            Real-user data
            <Badge v-if="pagespeed.field.category" variant="outline" class="ml-1">{{ pagespeed.field.category }}</Badge>
          </p>
          <div class="grid grid-cols-3 gap-3">
            <div v-for="metric in fieldMetrics" :key="metric.label" class="rounded-lg border border-border p-3">
              <p class="text-xs text-muted-foreground">{{ metric.label }}</p>
              <p class="text-lg font-semibold tabular-nums">{{ metric.value }}</p>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground">Not enough real-user data for this site yet.</p>
      </div>

      <div
        v-else-if="status === 'not_configured'"
        class="text-sm text-muted-foreground"
        data-testid="vitals-not-configured"
      >
        <p>Core Web Vitals are not configured.</p>
        <p class="mt-1">
          Add a PageSpeed Insights API key in
          <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
          , or set <code class="rounded bg-muted px-1">PAGESPEED_API_KEY</code> on a self-hosted install. The key is
          free from Google Cloud.
        </p>
      </div>

      <div v-else class="text-sm text-muted-foreground" data-testid="vitals-error">
        PageSpeed could not be read for this audit: {{ pagespeed?.message || 'unknown error' }}. Run another audit to
        try again.
      </div>
    </CardContent>
  </Card>
</template>

<script>
function ms(value) {
  if (value === null || value === undefined) return 'n/a'
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
}

function cls(value) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(2)
}

export default {
  name: 'MarketingAuditVitals',

  props: {
    siteFacts: { type: Object, default: null },
  },

  computed: {
    pagespeed() {
      return this.siteFacts?.pagespeed || null
    },
    status() {
      return this.pagespeed?.status || 'not_configured'
    },
    labMetrics() {
      const lab = this.pagespeed?.lab || {}
      return [
        { label: 'LCP', value: ms(lab.lcpMs) },
        { label: 'CLS', value: cls(lab.cls) },
        { label: 'TBT', value: ms(lab.tbtMs) },
        { label: 'FCP', value: ms(lab.fcpMs) },
      ]
    },
    fieldMetrics() {
      const field = this.pagespeed?.field || {}
      return [
        { label: 'LCP', value: ms(field.lcpMs) },
        { label: 'INP', value: ms(field.inpMs) },
        { label: 'CLS', value: cls(field.cls) },
      ]
    },
  },
}
</script>
