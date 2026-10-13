<template>
  <Card data-testid="search-queries">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="text-base">Top queries</CardTitle>
      <CardDescription>
        <template v-if="periodEnd">The 28 days ending {{ formatDate(periodEnd) }}, by clicks.</template>
        <template v-else>The 28 days of searches that brought people to your site.</template>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p v-if="queries.length === 0" class="text-sm text-muted-foreground" data-testid="search-queries-empty">
        No queries yet. They appear after the first sync.
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b text-left text-xs text-muted-foreground">
              <th scope="col" class="py-2 pr-4 font-medium">Query</th>
              <th scope="col" class="px-2 py-2 text-right font-medium">Clicks</th>
              <th scope="col" class="px-2 py-2 text-right font-medium">Impressions</th>
              <th scope="col" class="px-2 py-2 text-right font-medium">CTR</th>
              <th scope="col" class="py-2 pl-2 text-right font-medium">Position</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queries" :key="row.query" class="border-b last:border-0" data-testid="search-query-row">
              <td class="max-w-[28rem] truncate py-2 pr-4" :title="row.query">{{ row.query }}</td>
              <td class="px-2 py-2 text-right tabular-nums">{{ formatNumber(row.clicks) }}</td>
              <td class="px-2 py-2 text-right tabular-nums">{{ formatNumber(row.impressions) }}</td>
              <td class="px-2 py-2 text-right tabular-nums">{{ (row.ctr * 100).toFixed(1) }}%</td>
              <td class="py-2 pl-2 text-right tabular-nums">{{ row.position.toFixed(1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingSearchQueries',

  props: {
    queries: { type: Array, default: () => [] },
    periodEnd: { type: String, default: null },
  },

  methods: {
    formatNumber(value) {
      return new Intl.NumberFormat().format(value)
    },
    formatDate(value) {
      return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    },
  },
}
</script>
