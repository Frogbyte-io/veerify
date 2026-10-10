<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="ai-visibility-page">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold text-foreground">AI visibility</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            See how often AI assistants recommend your product, and which sources they rely on.
          </p>
        </div>
        <MarketingProductPicker @change="onProductChange" />
      </div>

      <div v-if="!product && pickerSettled" class="text-sm text-muted-foreground">Create a product to get started.</div>

      <!-- Marketing off (403) -->
      <Card v-else-if="marketingOff" data-testid="visibility-marketing-off">
        <CardHeader>
          <CardTitle>Marketing is off</CardTitle>
          <CardDescription>
            {{ marketingOffMessage }}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button as-child variant="outline"><NuxtLink to="/settings">Open settings</NuxtLink></Button>
        </CardContent>
      </Card>

      <div v-else-if="setupLoading" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <div v-else-if="setupError" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ setupError }}</span>
        <Button variant="outline" size="sm" @click="loadSetup">Retry</Button>
      </div>

      <template v-else-if="product && setup">
        <!-- Setup checklist -->
        <Card v-if="setupIssues.length" data-testid="visibility-setup-needed">
          <CardHeader>
            <CardTitle>Finish setup</CardTitle>
            <CardDescription>A few things are needed before AI visibility can run.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <ul class="space-y-2 text-sm">
              <li v-for="issue in setupIssues" :key="issue" class="flex items-center gap-2">
                <Icon name="lucide:circle-alert" class="h-4 w-4 text-muted-foreground" />
                {{ issue }}
              </li>
            </ul>
            <Button as-child>
              <NuxtLink :to="settingsLink">Go to Marketing settings</NuxtLink>
            </Button>
          </CardContent>
        </Card>

        <VisibilityPrompts v-if="setup.hasSite" :project-id="product.id" @changed="loadSetup(true)" />

        <!-- Run -->
        <Card v-if="setup.hasSite" data-testid="visibility-run">
          <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Run</CardTitle>
              <CardDescription>
                Runs happen weekly. Each prompt is sent to every connected provider several times, using your own API
                keys.
              </CardDescription>
            </div>
            <Button
              class="gap-2"
              :disabled="!setup.canRun || runActive || starting"
              data-testid="visibility-run-now"
              @click="startRun"
            >
              <Icon name="lucide:play" class="h-4 w-4" />
              Run now
            </Button>
          </CardHeader>
          <CardContent class="space-y-2">
            <p v-if="runError" class="text-sm text-destructive">{{ runError }}</p>
            <div v-if="runsError" class="flex items-center gap-2 text-sm text-destructive">
              <span>{{ runsError }}</span>
              <Button variant="outline" size="sm" @click="loadRuns">Retry</Button>
            </div>
            <Skeleton v-else-if="runsLoading" class="h-6 w-full" />
            <template v-else-if="latestRun">
              <div class="flex items-center gap-2 text-sm">
                <Badge :variant="statusVariant(latestRun.status)">{{ statusLabel(latestRun.status) }}</Badge>
                <span class="text-muted-foreground">Started {{ formatDateTime(latestRun.createdAt) }}</span>
              </div>
              <div v-if="runActive" data-testid="visibility-progress">
                <div class="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full bg-primary transition-all"
                    :style="{ width: `${progressPercent}%` }"
                  />
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ finishedAnswers }} of {{ latestRun.progress.total }} answers collected
                </p>
              </div>
              <p v-else-if="latestRun.progress.failed > 0" class="text-xs text-muted-foreground">
                {{ latestRun.progress.failed }} of {{ latestRun.progress.total }} answers failed (for example a rejected
                key or a reached budget).
              </p>
            </template>
            <p v-else class="text-sm text-muted-foreground">No runs yet.</p>
          </CardContent>
        </Card>

        <!-- Results -->
        <section v-if="setup.hasSite" class="space-y-3">
          <h2 class="text-xl font-semibold">Results</h2>
          <div v-if="summaryLoading" class="space-y-3">
            <Skeleton class="h-24 w-full" />
            <Skeleton class="h-48 w-full" />
          </div>
          <div v-else-if="summaryError" class="flex items-center gap-2 text-sm text-destructive">
            <span>{{ summaryError }}</span>
            <Button variant="outline" size="sm" @click="loadSummary">Retry</Button>
          </div>
          <VisibilityResults v-else-if="summary" :data="summary" @select-prompt="openPrompt" />
        </section>

        <VisibilityLlmsTxt v-if="setup.hasSite" :project-id="product.id" />

        <VisibilityAnswersDialog
          v-model:open="dialogOpen"
          :project-id="product.id"
          :run-id="summary && summary.run ? summary.run.id : null"
          :prompt-id="dialogPrompt ? dialogPrompt.id : null"
          :prompt-text="dialogPrompt ? dialogPrompt.text : ''"
        />
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
const POLL_MS = 5000

export default {
  name: 'MarketingAiVisibilityPage',

  data() {
    return {
      product: null,
      pickerSettled: false,
      marketingOff: false,
      marketingOffMessage: '',
      setup: null,
      setupLoading: false,
      setupError: null,
      runs: [],
      runsLoading: false,
      runsError: null,
      starting: false,
      runError: null,
      summary: null,
      summaryLoading: false,
      summaryError: null,
      dialogOpen: false,
      dialogPrompt: null,
      pollTimer: null,
    }
  },

  computed: {
    base() {
      return `/api/marketing/projects/${this.product.id}/visibility`
    },
    settingsLink() {
      return this.product ? `/marketing/settings?product=${this.product.slug}` : '/marketing/settings'
    },
    setupIssues() {
      const s = this.setup
      if (!s) return []
      const issues = []
      if (!s.hasSite || !s.siteVerified) issues.push('Verify your site')
      if (s.brandTermCount === 0) issues.push('Add at least one brand term')
      if (!s.hasUsableKey) issues.push('Add a valid Anthropic or OpenAI API key')
      if (s.hasSite && s.activePromptCount === 0) issues.push('Add at least one active prompt below')
      return issues
    },
    latestRun() {
      return this.runs[0] || null
    },
    runActive() {
      return this.latestRun ? ['queued', 'running'].includes(this.latestRun.status) : false
    },
    finishedAnswers() {
      const progress = this.latestRun?.progress
      return progress ? progress.done + progress.failed : 0
    },
    progressPercent() {
      const progress = this.latestRun?.progress
      if (!progress || progress.total === 0) return 0
      return Math.round((this.finishedAnswers / progress.total) * 100)
    },
  },

  beforeUnmount() {
    this.stopPolling()
  },

  methods: {
    errorMessage(err, fallback) {
      return err?.data?.error?.message || err?.data?.message || fallback
    },

    async onProductChange(product) {
      this.pickerSettled = true
      this.stopPolling()
      this.product = product
      this.setup = null
      this.runs = []
      this.summary = null
      this.marketingOff = false
      if (!product) return
      await this.loadSetup()
      if (this.setup?.hasSite) {
        await Promise.all([this.loadRuns(), this.loadSummary()])
      }
    },

    async loadSetup(quiet = false) {
      if (!this.product) return
      if (!quiet) this.setupLoading = true
      this.setupError = null
      try {
        const response = await $fetch(`${this.base}/setup`)
        this.setup = response.data
        this.marketingOff = false
      } catch (err) {
        if (err?.statusCode === 403 || err?.status === 403) {
          this.marketingOff = true
          this.marketingOffMessage = this.errorMessage(err, 'Marketing is not enabled for this product.')
        } else {
          this.setupError = this.errorMessage(err, 'Failed to load AI visibility')
        }
      } finally {
        this.setupLoading = false
      }
    },

    async loadRuns() {
      this.runsLoading = this.runs.length === 0
      this.runsError = null
      try {
        const response = await $fetch(`${this.base}/runs`)
        this.runs = response.data.runs
        if (this.runActive) this.startPolling()
      } catch (err) {
        this.runsError = this.errorMessage(err, 'Failed to load runs')
      } finally {
        this.runsLoading = false
      }
    },

    async loadSummary() {
      this.summaryLoading = this.summary === null
      this.summaryError = null
      try {
        const response = await $fetch(`${this.base}/summary`)
        this.summary = response.data
      } catch (err) {
        this.summaryError = this.errorMessage(err, 'Failed to load results')
      } finally {
        this.summaryLoading = false
      }
    },

    async startRun() {
      this.starting = true
      this.runError = null
      try {
        const response = await $fetch(`${this.base}/runs`, { method: 'POST' })
        this.runs = [response.data.run, ...this.runs.filter((run) => run.id !== response.data.run.id)]
        this.startPolling()
      } catch (err) {
        this.runError = this.errorMessage(err, 'Failed to start the run')
      } finally {
        this.starting = false
      }
    },

    startPolling() {
      if (!import.meta.client || this.pollTimer) return
      this.pollTimer = setInterval(this.poll, POLL_MS)
    },

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    },

    async poll() {
      const run = this.latestRun
      if (!run || !this.product) {
        this.stopPolling()
        return
      }
      try {
        const response = await $fetch(`${this.base}/runs/${run.id}`)
        this.runs = [response.data.run, ...this.runs.slice(1)]
        if (!this.runActive) {
          this.stopPolling()
          await this.loadSummary()
        }
      } catch {
        // Transient failure: keep polling; the next tick retries
      }
    },

    openPrompt(prompt) {
      this.dialogPrompt = prompt
      this.dialogOpen = true
    },

    statusLabel(status) {
      return (
        { queued: 'Queued', running: 'Running', done: 'Finished', partial: 'Partly finished', failed: 'Failed' }[
          status
        ] || status
      )
    },

    statusVariant(status) {
      if (status === 'failed') return 'destructive'
      if (status === 'done') return 'default'
      return 'secondary'
    },

    formatDateTime(value) {
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    },
  },
}
</script>
