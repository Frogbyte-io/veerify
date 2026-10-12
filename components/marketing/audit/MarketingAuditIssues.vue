<template>
  <Card data-testid="audit-issues">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="text-base">Issues</CardTitle>
      <CardDescription v-if="summary">
        {{ summary.total }} found: {{ summary.bySeverity.error }} errors, {{ summary.bySeverity.warning }} warnings,
        {{ summary.bySeverity.notice }} notices.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="!issues.length" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="lucide:circle-check" class="h-4 w-4 text-emerald-600" />
        No issues found.
      </div>

      <div v-for="group in groups" :key="group.severity" class="mb-6 last:mb-0">
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ group.label }} ({{ group.items.length }})
        </h3>
        <ul class="divide-y divide-border rounded-lg border border-border">
          <li v-for="issue in group.items" :key="issue.ruleId" :data-testid="`issue-${issue.ruleId}`">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
              :aria-expanded="isOpen(issue.ruleId)"
              @click="toggle(issue.ruleId)"
            >
              <Badge :variant="severityVariant(issue.severity)">{{ issue.severity }}</Badge>
              <span class="flex-1 text-sm font-medium">{{ issue.title }}</span>
              <span class="text-sm text-muted-foreground">
                {{ issue.scope === 'site' ? 'Site-wide' : `${issue.total} page${issue.total === 1 ? '' : 's'}` }}
              </span>
              <Icon :name="isOpen(issue.ruleId) ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="h-4 w-4" />
            </button>
            <div v-if="isOpen(issue.ruleId)" class="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
              <p class="text-sm">{{ issue.guidance }}</p>
              <ul class="space-y-1 text-sm">
                <li v-for="(item, index) in issue.affected" :key="index" class="break-all">
                  <span v-if="item.url" class="font-mono text-xs">{{ item.url }}</span>
                  <span v-if="detailText(item.details)" class="text-xs text-muted-foreground">
                    {{ detailText(item.details) }}
                  </span>
                </li>
              </ul>
              <p v-if="issue.total > issue.affected.length" class="text-xs text-muted-foreground">
                Showing {{ issue.affected.length }} of {{ issue.total }}.
              </p>
            </div>
          </li>
        </ul>
      </div>
    </CardContent>
  </Card>
</template>

<script>
const SEVERITIES = [
  { severity: 'error', label: 'Errors' },
  { severity: 'warning', label: 'Warnings' },
  { severity: 'notice', label: 'Notices' },
]

export default {
  name: 'MarketingAuditIssues',

  props: {
    issues: { type: Array, default: () => [] },
    summary: { type: Object, default: null },
  },

  data() {
    return { open: {} }
  },

  computed: {
    groups() {
      return SEVERITIES.map((entry) => ({
        ...entry,
        items: this.issues.filter((issue) => issue.severity === entry.severity),
      })).filter((group) => group.items.length > 0)
    },
  },

  methods: {
    isOpen(ruleId) {
      return this.open[ruleId] === true
    },
    toggle(ruleId) {
      this.open = { ...this.open, [ruleId]: !this.open[ruleId] }
    },
    severityVariant(severity) {
      if (severity === 'error') return 'destructive'
      if (severity === 'warning') return 'outline'
      return 'secondary'
    },
    /** Short plain-text rendering of rule details; never HTML. */
    detailText(details) {
      if (!details || typeof details !== 'object') return ''
      return Object.entries(details)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`)
        .join(', ')
    },
  },
}
</script>
