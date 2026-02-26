<template>
  <div data-testid="settings-status-panel" class="space-y-6">
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Instance Status</CardTitle>
          <CardDescription>Health checks for self-hosted services.</CardDescription>
        </div>
        <Button type="button" variant="outline" :disabled="isLoading" data-testid="status-refresh" @click="loadStatus">
          <Icon v-if="isLoading" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
          <Icon v-else name="lucide:refresh-cw" class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-2">
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
        </div>

        <div v-else-if="error" class="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p class="text-sm text-destructive">{{ error }}</p>
        </div>

        <template v-else>
          <div class="grid grid-cols-3 gap-3">
            <div class="rounded-md border p-3">
              <p class="text-xs text-muted-foreground">Healthy</p>
              <p class="text-2xl font-semibold text-green-600" data-testid="status-summary-ok">{{ summary.ok }}</p>
            </div>
            <div class="rounded-md border p-3">
              <p class="text-xs text-muted-foreground">Warnings</p>
              <p class="text-2xl font-semibold text-amber-600" data-testid="status-summary-warn">{{ summary.warn }}</p>
            </div>
            <div class="rounded-md border p-3">
              <p class="text-xs text-muted-foreground">Errors</p>
              <p class="text-2xl font-semibold text-red-600" data-testid="status-summary-error">{{ summary.error }}</p>
            </div>
          </div>

          <div class="space-y-2">
            <div
              v-for="status in statuses"
              :key="status.key"
              class="rounded-md border p-3 flex items-start justify-between gap-3"
              :data-testid="`status-service-${status.key}`"
            >
              <div>
                <p class="font-medium">{{ status.label }}</p>
                <p class="text-sm text-muted-foreground">{{ status.message }}</p>
              </div>
              <Badge :variant="status.level === 'error' ? 'destructive' : 'secondary'">
                {{ status.level.toUpperCase() }}
              </Badge>
            </div>
          </div>

          <p class="text-xs text-muted-foreground">
            Last checked:
            <span data-testid="status-checked-at">{{ formattedCheckedAt }}</span>
          </p>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script>
export default {
  name: 'SettingsStatus',
  data() {
    return {
      isLoading: true,
      error: '',
      statuses: [],
      checkedAt: '',
      summary: {
        ok: 0,
        warn: 0,
        error: 0,
      },
    }
  },
  computed: {
    formattedCheckedAt() {
      if (!this.checkedAt) return 'n/a'
      return new Date(this.checkedAt).toLocaleString()
    },
  },
  async mounted() {
    await this.loadStatus()
  },
  methods: {
    async loadStatus() {
      this.isLoading = true
      this.error = ''
      try {
        const response = await $fetch('/api/system/status')
        this.statuses = response?.data?.statuses || []
        this.summary = response?.data?.summary || { ok: 0, warn: 0, error: 0 }
        this.checkedAt = response?.data?.checkedAt || ''
      } catch (error) {
        console.error('Failed to load system status:', error)
        this.error = error?.data?.error?.message || 'Unable to load system status'
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
