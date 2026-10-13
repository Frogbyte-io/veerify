<template>
  <Card data-testid="audit-progress">
    <CardContent class="space-y-3 pt-6">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm font-medium">
          <Icon name="lucide:loader-circle" class="h-4 w-4 animate-spin" />
          <span>{{ label }}</span>
        </div>
        <Button variant="outline" size="sm" :disabled="cancelling" data-testid="audit-cancel" @click="$emit('cancel')">
          Cancel
        </Button>
      </div>
      <div v-if="audit.mode === 'full'" class="space-y-1">
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div class="h-full bg-primary transition-all" :style="{ width: `${percent}%` }" />
        </div>
        <p class="text-xs text-muted-foreground">
          {{ audit.pagesFetched }} of up to {{ audit.pageLimit }} pages fetched
        </p>
      </div>
      <p v-if="cancelError" class="text-sm text-destructive">{{ cancelError }}</p>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingAuditProgress',

  props: {
    audit: { type: Object, required: true },
    cancelling: { type: Boolean, default: false },
    cancelError: { type: String, default: null },
  },

  emits: ['cancel'],

  computed: {
    label() {
      if (this.audit.status === 'queued') return 'Audit queued, starting shortly'
      if (this.audit.status === 'crawling') return 'Crawling your site'
      return 'Analyzing pages and computing the score'
    },
    percent() {
      if (!this.audit.pageLimit) return 0
      return Math.min(100, Math.round((this.audit.pagesFetched / this.audit.pageLimit) * 100))
    },
  },
}
</script>
