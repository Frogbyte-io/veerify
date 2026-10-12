<template>
  <Card id="integrations" class="scroll-mt-20" data-testid="marketing-settings-integrations">
    <CardHeader>
      <CardTitle role="heading" aria-level="2">Integration status</CardTitle>
      <CardDescription>What works on this installation, and what to set up for the rest.</CardDescription>
      <div v-if="canManage && !isLoading && !error && integrations.length > 0" class="pt-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="busy"
          data-testid="marketing-integrations-test-all"
          @click="testAll"
        >
          <Icon
            :name="runningAll ? 'lucide:loader-circle' : 'lucide:plug-zap'"
            class="w-4 h-4 mr-2"
            :class="runningAll ? 'animate-spin' : ''"
          />
          {{ runningAll ? 'Testing...' : 'Test all' }}
        </Button>
      </div>
    </CardHeader>

    <CardContent>
      <div v-if="isLoading" class="space-y-2">
        <Skeleton v-for="i in 6" :key="i" class="h-12 w-full" />
      </div>

      <div v-else-if="error" class="text-center py-4" data-testid="marketing-integrations-error">
        <p class="text-sm text-destructive mb-2">{{ error }}</p>
        <Button variant="outline" size="sm" @click="$emit('retry')">Retry</Button>
      </div>

      <ul v-else class="min-w-0 divide-y rounded-lg border">
        <li
          v-for="item in integrations"
          :key="item.id"
          class="flex flex-wrap items-start gap-x-3 gap-y-2 p-3 sm:flex-nowrap"
          :data-testid="`marketing-integration-${item.id}`"
        >
          <Icon :name="icon(item.state)" class="w-4 h-4 mt-0.5 shrink-0" :class="iconClass(item.state)" />
          <div class="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
            <p class="text-sm font-medium">
              {{ item.label }}
              <span class="font-normal text-muted-foreground">{{ item.capability }}</span>
            </p>
            <p
              class="text-xs mt-0.5 [overflow-wrap:anywhere]"
              :class="item.state === 'failing' ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ item.detail }}
            </p>
            <p
              v-if="results[item.id]"
              class="text-xs mt-1 flex items-start gap-1 [overflow-wrap:anywhere]"
              :class="resultClass(results[item.id])"
              :data-testid="`marketing-integration-result-${item.id}`"
            >
              <Icon :name="resultIcon(results[item.id])" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {{ resultLabel(results[item.id]) }}: {{ results[item.id].detail }}
                <span v-if="results[item.id].durationMs !== undefined" class="text-muted-foreground">
                  ({{ formatDuration(results[item.id].durationMs) }})
                </span>
              </span>
            </p>
          </div>
          <Button
            v-if="canManage"
            variant="outline"
            size="sm"
            :disabled="busy"
            :aria-label="`Test ${item.label}`"
            :data-testid="`marketing-integration-test-${item.id}`"
            @click="testOne(item.id)"
          >
            <Icon v-if="running[item.id]" name="lucide:loader-circle" class="w-4 h-4 mr-1 animate-spin" />
            {{ running[item.id] ? 'Testing...' : 'Test' }}
          </Button>
          <Badge :variant="badge(item.state)">{{ stateLabel(item.state) }}</Badge>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { toast } from 'vue-sonner'

export default {
  name: 'MarketingSettingsIntegrations',

  props: {
    integrations: { type: Array, default: () => [] },
    isLoading: { type: Boolean, default: false },
    error: { type: String, default: null },
    teamId: { type: String, default: null },
    /** Team admins only: tests use the team's keys and count against a rate limit */
    canManage: { type: Boolean, default: false },
  },

  emits: ['retry', 'refresh'],

  data() {
    return {
      results: {},
      running: {},
      runningAll: false,
    }
  },

  computed: {
    busy() {
      return this.runningAll || Object.values(this.running).some(Boolean)
    },
  },

  methods: {
    isNotConfigured(result) {
      return result?.notConfigured === true
    },

    resultIcon(result) {
      if (this.isNotConfigured(result)) return 'lucide:circle-dashed'
      return result.ok ? 'lucide:check' : 'lucide:x'
    },

    resultLabel(result) {
      if (this.isNotConfigured(result)) return 'Not tested'
      return result.ok ? 'Works' : 'Failed'
    },

    resultClass(result) {
      if (this.isNotConfigured(result)) return 'text-muted-foreground'
      return result.ok ? 'text-green-700 dark:text-green-500' : 'text-destructive'
    },

    formatDuration(ms) {
      return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
    },

    // Returns false when the rate limit was hit, so "Test all" can stop
    async runTest(id) {
      this.running = { ...this.running, [id]: true }
      try {
        const response = await $fetch(`/api/marketing/teams/${this.teamId}/integrations/${id}/test`, {
          method: 'POST',
        })
        const result = response?.data
        if (result && !result.ok && this.integrations.find((i) => i.id === id)?.state === 'not_configured') {
          result.notConfigured = true
          result.detail = 'not configured'
        }
        this.results = { ...this.results, [id]: result }
        // A team key may have been marked valid or invalid
        if (result?.source === 'team') this.$emit('refresh')
        return true
      } catch (err) {
        this.results = {
          ...this.results,
          [id]: { ok: false, detail: apiErrorMessage(err, 'The test could not be run') },
        }
        return apiErrorStatus(err) !== 429
      } finally {
        this.running = { ...this.running, [id]: false }
      }
    },

    async testOne(id) {
      if (this.busy || !this.teamId) return
      await this.runTest(id)
    },

    // Sequential: keeps load low and stays inside the per-team hourly limit
    async testAll() {
      if (this.busy || !this.teamId) return
      this.runningAll = true
      let passed = 0
      let failed = 0
      let skipped = 0
      try {
        // Integrations that are not configured have nothing to test
        for (const item of this.integrations) {
          if (item.state === 'not_configured') {
            skipped++
            this.results = {
              ...this.results,
              [item.id]: { ok: false, notConfigured: true, detail: 'not configured' },
            }
            continue
          }
          const proceed = await this.runTest(item.id)
          if (this.results[item.id]?.ok) passed++
          else failed++
          if (!proceed) break
        }
        const summary = `${passed} passed, ${failed} failed, ${skipped} not configured`
        if (failed > 0) toast.warning(summary)
        else toast.success(summary)
      } finally {
        this.runningAll = false
      }
    },

    icon(state) {
      if (state === 'ready') return 'lucide:circle-check'
      if (state === 'failing') return 'lucide:circle-alert'
      return 'lucide:circle-dashed'
    },

    iconClass(state) {
      if (state === 'ready') return 'text-green-600 dark:text-green-500'
      if (state === 'failing') return 'text-destructive'
      return 'text-muted-foreground'
    },

    badge(state) {
      if (state === 'ready') return 'default'
      if (state === 'failing') return 'destructive'
      return 'outline'
    },

    stateLabel(state) {
      if (state === 'ready') return 'Ready'
      if (state === 'failing') return 'Failing'
      return 'Not configured'
    },
  },
}
</script>
