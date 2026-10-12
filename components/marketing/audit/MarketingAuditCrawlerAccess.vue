<template>
  <Card data-testid="audit-crawler-access">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
        <Icon name="lucide:bot" class="h-4 w-4" />
        AI and search crawler access
      </CardTitle>
      <CardDescription>
        Whether your robots.txt lets these crawlers read your site. Blocked AI crawlers cannot learn about or cite your
        product.
        <span v-if="robotsMissing">No robots.txt was found, so every crawler is allowed.</span>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="!rows.length" class="text-sm text-muted-foreground">No crawler data for this audit.</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="text-xs uppercase text-muted-foreground">
            <tr>
              <th class="py-2 pr-4 font-medium">Bot</th>
              <th class="py-2 pr-4 font-medium">Operator</th>
              <th class="py-2 pr-4 font-medium">Purpose</th>
              <th class="py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.bot" class="border-t border-border">
              <td class="py-2 pr-4 font-mono text-xs">{{ row.bot }}</td>
              <td class="py-2 pr-4">{{ row.operator }}</td>
              <td class="py-2 pr-4 text-muted-foreground">{{ purposeLabel(row.purpose) }}</td>
              <td class="py-2">
                <Badge :variant="verdictVariant(row.verdict)" :data-testid="`crawler-verdict-${row.bot}`">
                  {{ verdictLabel(row.verdict) }}
                </Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
</template>

<script>
const PURPOSES = {
  search: 'Search',
  'ai-training': 'AI training',
  'ai-search': 'AI search',
  'ai-assistant': 'AI assistant',
}

export default {
  name: 'MarketingAuditCrawlerAccess',

  props: {
    siteFacts: { type: Object, default: null },
  },

  computed: {
    rows() {
      return this.siteFacts?.crawlerAccess || []
    },
    robotsMissing() {
      return this.siteFacts?.robotsTxt?.status === 'missing'
    },
  },

  methods: {
    purposeLabel(purpose) {
      return PURPOSES[purpose] || purpose
    },
    verdictLabel(verdict) {
      if (verdict === 'allowed') return 'Allowed'
      if (verdict === 'blocked') return 'Blocked'
      return 'Partly restricted'
    },
    verdictVariant(verdict) {
      if (verdict === 'allowed') return 'secondary'
      if (verdict === 'blocked') return 'destructive'
      return 'outline'
    },
  },
}
</script>
