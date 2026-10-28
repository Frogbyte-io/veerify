<template>
  <PageContainer data-testid="ai-visibility-page">
    <PageHeader
      title="AI visibility"
      description="See how often AI assistants recommend your product, and which sources they rely on."
    >
      <template #actions>
        <Button
          class="gap-2"
          :disabled="!canRunNow"
          :title="runDisabledReason"
          data-testid="visibility-run-now"
          @click="startRun"
        >
          <Icon name="lucide:play" class="h-4 w-4" />
          Run now
        </Button>
      </template>
    </PageHeader>

    <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />

    <template v-if="!pickerError">
      <div v-if="!pickerSettled || initialLoading" class="space-y-6">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-28 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <MarketingNotice v-else-if="!project" title="No project yet">
        Marketing works on a project. Create one to get started.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/workspace">Go to workspace settings</NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <!-- Marketing off (403) -->
      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="marketingOffMessage" />

      <MarketingLoadError
        v-else-if="setupError"
        title="Failed to load AI visibility"
        :message="setupError"
        @retry="loadAll()"
      />

      <template v-else-if="project && setup">
        <!-- Setup checklist -->
        <Card v-if="setupIssues.length" data-testid="visibility-setup-needed">
          <CardHeader>
            <CardTitle role="heading" aria-level="2">Finish setup</CardTitle>
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

        <VisibilityPrompts v-if="setup.hasSite" :project-id="project.id" @changed="loadSetup(true)" />

        <!-- Run -->
        <Card v-if="setup.hasSite" data-testid="visibility-run">
          <CardHeader>
            <CardTitle role="heading" aria-level="2">Run</CardTitle>
            <CardDescription>
              Runs happen weekly. Each prompt is sent to every connected provider several times, using your own API
              keys. Use Run now above to start one.
            </CardDescription>
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
              <p v-if="runActive" class="text-sm text-muted-foreground" data-testid="visibility-run-in-progress">
                A run is in progress, started {{ formatAgo(latestRun.createdAt) }}. Run now is available again when it
                finishes.
              </p>
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

        <VisibilityLlmsTxt v-if="setup.hasSite" :project-id="project.id" />

        <VisibilityAnswersDialog
          v-model:open="dialogOpen"
          :project-id="project.id"
          :run-id="summary && summary.run ? summary.run.id : null"
          :prompt-id="dialogPrompt ? dialogPrompt.id : null"
          :prompt-text="dialogPrompt ? dialogPrompt.text : ''"
        />
      </template>
    </template>
  </PageContainer>
</template>

<script>
import { toast } from 'vue-sonner'
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const POLL_MS = 5000

export default {
  name: 'MarketingAiVisibilityPage',

  created() {
    useHead({ title: 'AI visibility · Marketing' })
  },

  data() {
    return {
      project: null,
      pickerSettled: false,
      pickerError: false,
      marketingOff: false,
      marketingOffMessage: '',
      setup: null,
      initialLoading: false,
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
      return `/api/marketing/projects/${this.project.id}/visibility`
    },
    settingsLink() {
      return this.project ? `/marketing/settings` : '/marketing/settings'
    },
    setupIssues() {
      const s = this.setup
      if (!s) return []
      const issues = []
      if (!s.hasSite || !s.siteVerified) issues.push('Verify your site')
      if (s.brandTermCount === 0) issues.push('Add at least one brand name')
      if (!s.hasUsableKey) issues.push('Add a valid Anthropic, OpenAI, Gemini or Perplexity API key')
      if (s.hasSite && s.activePromptCount === 0) issues.push('Add at least one active prompt below')
      return issues
    },
    canRunNow() {
      return Boolean(this.setup?.canRun) && !this.initialLoading && !this.runActive && !this.starting
    },
    runDisabledReason() {
      if (this.initialLoading || !this.setup || this.setup.canRun) return ''
      return 'Finish the setup first.'
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
      return apiErrorMessage(err, fallback)
    },

    onPickerError() {
      this.stopPolling()
      this.project = null
      this.pickerError = true
      this.pickerSettled = true
    },

    isCurrent(projectId) {
      return this.project?.id === projectId
    },

    async onProjectChange(project) {
      this.pickerSettled = true
      this.pickerError = false
      this.stopPolling()
      this.project = project
      this.setup = null
      this.setupError = null
      this.setupLoading = false
      this.runs = []
      this.runsError = null
      this.runsLoading = false
      this.summary = null
      this.summaryError = null
      this.summaryLoading = false
      this.runError = null
      this.marketingOff = false
      this.dialogOpen = false
      this.initialLoading = false
      if (!project) return
      await this.loadAll()
    },

    /** Everything the page shows, fetched in parallel behind one skeleton. */
    async loadAll() {
      if (!this.project) return
      const projectId = this.project.id
      this.initialLoading = true
      this.setupError = null
      this.runsError = null
      this.summaryError = null
      await Promise.all([this.loadSetup(), this.loadRuns(), this.loadSummary()])
      if (!this.isCurrent(projectId)) return
      // Without a site there is nothing to run or summarise, so failures there are not worth showing.
      if (!this.setup?.hasSite) {
        this.runsError = null
        this.summaryError = null
      }
      this.initialLoading = false
    },

    async loadSetup(quiet = false) {
      if (!this.project) return
      const projectId = this.project.id
      if (!quiet) {
        this.setupLoading = true
        this.setupError = null
      }
      try {
        const response = await $fetch(`${this.base}/setup`)
        if (!this.isCurrent(projectId)) return
        this.setup = response.data
        this.setupError = null
        this.marketingOff = false
      } catch (err) {
        if (!this.isCurrent(projectId)) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.marketingOffMessage = this.errorMessage(err, '')
        } else if (quiet) {
          toast.error(this.errorMessage(err, 'Failed to refresh AI visibility setup'))
        } else {
          this.setupError = this.errorMessage(err, 'Failed to load AI visibility')
        }
      } finally {
        if (this.isCurrent(projectId)) this.setupLoading = false
      }
    },

    async loadRuns() {
      if (!this.project) return
      const projectId = this.project.id
      this.runsLoading = this.runs.length === 0
      this.runsError = null
      try {
        const response = await $fetch(`${this.base}/runs`)
        if (!this.isCurrent(projectId)) return
        this.runs = response.data.runs
        if (this.runActive) this.startPolling()
      } catch (err) {
        if (!this.isCurrent(projectId)) return
        this.runsError = this.errorMessage(err, 'Failed to load runs')
      } finally {
        if (this.isCurrent(projectId)) this.runsLoading = false
      }
    },

    async loadSummary() {
      if (!this.project) return
      const projectId = this.project.id
      this.summaryLoading = this.summary === null
      this.summaryError = null
      try {
        const response = await $fetch(`${this.base}/summary`)
        if (!this.isCurrent(projectId)) return
        this.summary = response.data
      } catch (err) {
        if (!this.isCurrent(projectId)) return
        this.summaryError = this.errorMessage(err, 'Failed to load results')
      } finally {
        if (this.isCurrent(projectId)) this.summaryLoading = false
      }
    },

    async startRun() {
      const projectId = this.project.id
      this.starting = true
      this.runError = null
      try {
        const response = await $fetch(`${this.base}/runs`, { method: 'POST' })
        if (!this.isCurrent(projectId)) return
        this.runs = [response.data.run, ...this.runs.filter((run) => run.id !== response.data.run.id)]
        this.startPolling()
      } catch (err) {
        if (this.isCurrent(projectId)) this.runError = this.errorMessage(err, 'Failed to start the run')
      } finally {
        if (this.isCurrent(projectId)) this.starting = false
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
      if (!run || !this.project) {
        this.stopPolling()
        return
      }
      const projectId = this.project.id
      try {
        const response = await $fetch(`${this.base}/runs/${run.id}`)
        if (!this.isCurrent(projectId)) return
        this.runs = [response.data.run, ...this.runs.slice(1)]
        if (!this.runActive) {
          this.stopPolling()
          await this.loadSummary()
        }
      } catch (err) {
        if (!this.isCurrent(projectId)) {
          this.stopPolling()
          return
        }
        // 404 means the run is gone: stop. Other failures are transient, the next tick retries.
        if (apiErrorStatus(err) === 404) this.stopPolling()
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

    formatAgo(value) {
      const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
      if (minutes < 1) return 'less than a minute ago'
      if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
      const hours = Math.round(minutes / 60)
      if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
      return `${Math.round(hours / 24)} days ago`
    },

    formatDateTime(value) {
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    },
  },
}
</script>
