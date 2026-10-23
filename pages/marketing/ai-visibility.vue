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
        <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />
      </div>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        The project could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!project" class="text-sm text-muted-foreground">Create a project to get started.</div>

      <!-- Marketing off (403) -->
      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="marketingOffMessage" />

      <div v-else-if="setupLoading" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <div v-else-if="setupError" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ setupError }}</span>
        <Button variant="outline" size="sm" @click="loadSetup">Retry</Button>
      </div>

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
          <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle role="heading" aria-level="2">Run</CardTitle>
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
    </div>
  </NuxtLayout>
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
      if (!project) return
      await this.loadSetup()
      if (this.isCurrent(project.id) && this.setup?.hasSite) {
        await Promise.all([this.loadRuns(), this.loadSummary()])
      }
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
