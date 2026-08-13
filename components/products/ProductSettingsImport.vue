<template>
  <div class="space-y-6">
    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_320px]">
      <div class="space-y-6">
        <!-- Upload & Analyze -->
        <Card>
          <CardHeader>
            <div class="flex items-start justify-between gap-4">
              <div>
                <CardTitle class="flex items-center gap-2">
                  <Icon name="lucide:database-zap" class="h-5 w-5" />
                  Import CSV Files
                </CardTitle>
                <CardDescription>
                  Upload one or more CSV exports to import feedback, comments, and subscribers into
                  <span class="font-medium text-foreground">{{ project.name }}</span>.
                </CardDescription>
              </div>
              <div class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <span v-for="(step, i) in wizardSteps" :key="step.id" class="flex items-center gap-1.5">
                  <span v-if="i > 0" class="text-border">/</span>
                  <span :class="stepTextClass(step.id)">{{ step.label }}</span>
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label class="mb-2 block">CSV Files</Label>
              <div class="rounded-xl border-2 border-dashed p-6 text-center transition-colors" :class="csvFiles.length > 0 ? 'border-primary/30 bg-primary/5' : 'border-border hover:border-muted-foreground/30'">
                <input ref="fileInput" type="file" accept=".csv,text/csv" multiple class="hidden" @change="handleFileSelect">
                <div v-if="csvFiles.length === 0" class="space-y-2">
                  <Icon name="lucide:upload" class="mx-auto h-8 w-8 text-muted-foreground" />
                  <p class="text-sm text-muted-foreground">Drop CSV files here or <button type="button" class="text-primary underline underline-offset-2" @click="$refs.fileInput.click()">browse</button></p>
                  <p class="text-xs text-muted-foreground">Supports Sleekplan exports (feedback, comments, votes, users) or generic CSV</p>
                </div>
                <div v-else class="space-y-2">
                  <div v-for="(file, idx) in csvFiles" :key="idx" class="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left text-sm">
                    <div class="flex items-center gap-2 min-w-0">
                      <Icon name="lucide:file-text" class="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span class="truncate font-medium">{{ file.filename }}</span>
                      <span v-if="file.detectedType" class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{{ file.detectedType }}</span>
                    </div>
                    <button type="button" class="shrink-0 text-muted-foreground hover:text-destructive" @click="removeFile(idx)">
                      <Icon name="lucide:x" class="h-4 w-4" />
                    </button>
                  </div>
                  <button type="button" class="mt-1 text-xs text-primary underline underline-offset-2" @click="$refs.fileInput.click()">Add more files</button>
                </div>
              </div>
            </div>

            <div>
              <Label class="mb-2 block">Content to import</Label>
              <div class="flex flex-wrap gap-3">
                <label v-for="scope in contentScopeOptions" :key="scope.key" class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input v-model="form.contentScope[scope.key]" type="checkbox" class="accent-primary">
                  <span>{{ scope.label }}</span>
                </label>
              </div>
            </div>

            <div class="flex items-center gap-3 pt-1">
              <Button :disabled="csvFiles.length === 0 || isAnalyzing" @click="analyzeImport">
                <Icon v-if="isAnalyzing" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                <Icon v-else name="lucide:scan-search" class="mr-2 h-4 w-4" />
                Analyze
              </Button>
              <p v-if="currentRun" class="text-sm text-muted-foreground">
                Latest: {{ formatDate(currentRun.createdAt) }}
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- Analysis Results + Mapping + Duplicate Policy -->
        <Card v-if="currentRun">
          <CardHeader>
            <CardTitle class="text-base">Review &amp; Configure</CardTitle>
          </CardHeader>
          <CardContent class="space-y-5">
            <!-- Counts -->
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div v-for="stat in analysisCounts" :key="stat.label" class="rounded-xl border p-3">
                <p class="text-xs uppercase tracking-wide text-muted-foreground">{{ stat.label }}</p>
                <p class="mt-1 text-xl font-semibold">{{ stat.value }}</p>
              </div>
            </div>

            <!-- Warnings -->
            <div v-if="visibleIssues.length > 0" class="space-y-2">
              <button type="button" class="flex items-center gap-1.5 text-sm font-medium text-muted-foreground" @click="showWarnings = !showWarnings">
                <Icon :name="showWarnings ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="h-4 w-4" />
                {{ visibleIssues.length }} warning{{ visibleIssues.length === 1 ? '' : 's' }}
              </button>
              <div v-if="showWarnings" class="max-h-48 space-y-2 overflow-y-auto">
                <div v-for="issue in visibleIssues" :key="`${issue.id || issue.externalId || issue.message}`" class="rounded-lg border p-2.5 text-sm" :class="issueClasses(issue.severity)">
                  <p>{{ issue.message }}</p>
                </div>
              </div>
            </div>

            <!-- Category Mappings -->
            <div v-if="Object.values(localMappingConfig.categoryMappings || {}).length > 0" class="space-y-3">
              <p class="text-sm font-medium">Category Mappings</p>
              <div v-for="entry in Object.values(localMappingConfig.categoryMappings || {})" :key="`cat-${entry.sourceKey}`" class="grid gap-3 rounded-xl border p-3 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
                <div>
                  <p class="text-sm font-medium">{{ entry.sourceName }}</p>
                  <p class="text-xs text-muted-foreground">{{ entry.sourceKey }}</p>
                </div>
                <select v-model="entry.mode" class="h-9 rounded-md border bg-background px-2 text-sm" :disabled="!canConfigureRun">
                  <option value="create">Create New</option>
                  <option value="existing">Use Existing</option>
                </select>
                <div>
                  <select v-if="entry.mode === 'existing'" v-model="entry.targetId" class="h-9 w-full rounded-md border bg-background px-2 text-sm" :disabled="!canConfigureRun" @change="normalizeCategoryMappings">
                    <option value="">Select category</option>
                    <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
                  </select>
                  <Input v-else v-model="entry.targetName" :disabled="!canConfigureRun" placeholder="Category name" class="h-9" />
                </div>
              </div>
            </div>

            <!-- Status Mappings -->
            <div v-if="Object.values(localMappingConfig.statusMappings || {}).length > 0" class="space-y-3">
              <p class="text-sm font-medium">Status Mappings</p>
              <div v-for="entry in Object.values(localMappingConfig.statusMappings || {})" :key="`st-${entry.sourceKey}`" class="grid gap-3 rounded-xl border p-3 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
                <div>
                  <p class="text-sm font-medium">{{ entry.sourceName }}</p>
                  <p class="text-xs text-muted-foreground">{{ entry.sourceKey }}</p>
                </div>
                <select v-model="entry.mode" class="h-9 rounded-md border bg-background px-2 text-sm" :disabled="!canConfigureRun">
                  <option value="system">Use System</option>
                  <option value="existing">Use Existing</option>
                  <option value="create">Create New</option>
                </select>
                <div>
                  <select v-if="entry.mode !== 'create'" v-model="entry.targetValue" class="h-9 w-full rounded-md border bg-background px-2 text-sm" :disabled="!canConfigureRun" @change="normalizeStatusMappings">
                    <option value="">Select status</option>
                    <option v-for="status in statusOptions" :key="status.value" :value="status.value">{{ status.name }}</option>
                  </select>
                  <Input v-else v-model="entry.targetName" :disabled="!canConfigureRun" placeholder="Status name" class="h-9" />
                </div>
              </div>
            </div>

            <!-- Duplicate Policy -->
            <div class="space-y-2">
              <p class="text-sm font-medium">Duplicate Policy</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <button type="button" class="rounded-xl border p-3 text-left text-sm transition-colors" :class="localDuplicatePolicy === 'skip_existing' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'" :disabled="!canConfigureRun" @click="localDuplicatePolicy = 'skip_existing'">
                  <p class="font-medium">Skip Existing</p>
                  <p class="mt-0.5 text-muted-foreground">Keep prior imported records unchanged.</p>
                </button>
                <button type="button" class="rounded-xl border p-3 text-left text-sm transition-colors" :class="localDuplicatePolicy === 'update_existing' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'" :disabled="!canConfigureRun" @click="localDuplicatePolicy = 'update_existing'">
                  <p class="font-medium">Update Existing</p>
                  <p class="mt-0.5 text-muted-foreground">Refresh matching records with source data.</p>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Import Execution -->
        <Card v-if="currentRun">
          <CardHeader>
            <div class="flex items-center justify-between gap-3">
              <CardTitle class="text-base">Import</CardTitle>
              <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium" :class="statusClasses(currentRun.status)">
                {{ formatStatus(currentRun.status) }}
              </span>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{{ currentRun.progressCompleted || 0 }} of {{ currentRun.progressTotal || 0 }} processed</span>
                <span class="font-medium">{{ Math.max(0, Math.min(100, Number(currentRun.progressPercent || 0))) }}%</span>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${Math.max(0, Math.min(100, Number(currentRun.progressPercent || 0)))}%` }" />
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <Button :disabled="!canStartImport" @click="startImport">
                <Icon v-if="isStarting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                <Icon v-else name="lucide:play" class="mr-2 h-4 w-4" />
                {{ currentRun.status === 'failed' ? 'Retry Import' : 'Start Import' }}
              </Button>
              <Button v-if="currentRun.status === 'importing'" variant="outline" :disabled="isStepping" @click="stepImportRun">
                <Icon v-if="isStepping" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                <Icon v-else name="lucide:fast-forward" class="mr-2 h-4 w-4" />
                Advance Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Run History sidebar -->
      <div>
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between gap-2">
              <CardTitle class="text-base">History</CardTitle>
              <Button variant="ghost" size="icon" class="h-8 w-8" @click="reloadHistory">
                <Icon name="lucide:refresh-cw" class="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent class="space-y-2">
            <div v-if="historyLoading" class="space-y-2">
              <Skeleton v-for="n in 3" :key="n" class="h-16 w-full" />
            </div>
            <div v-else-if="historyError" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {{ historyError }}
            </div>
            <p v-else-if="runs.length === 0" class="py-4 text-center text-sm text-muted-foreground">No import runs yet.</p>
            <button v-for="run in runs" :key="run.id" type="button" class="w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/30" :class="selectedRunId === run.id ? 'border-primary bg-primary/5' : ''" @click="selectRun(run)">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-sm font-medium">{{ formatSource(run.sourceType) }}</p>
                  <p class="text-xs text-muted-foreground">{{ formatDate(run.createdAt) }}</p>
                </div>
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" :class="statusClasses(run.status)">
                  {{ formatStatus(run.status) }}
                </span>
              </div>
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

const SYSTEM_STATUS_OPTIONS = [
  { value: 'open', name: 'Open' },
  { value: 'planned', name: 'Planned' },
  { value: 'in_progress', name: 'In Progress' },
  { value: 'completed', name: 'Completed' },
  { value: 'closed', name: 'Closed' },
]

function defaultScope() {
  return { feedback: true, roadmap: true, changelog: true, comments: true, subscriptions: true }
}

function defaultMapping() {
  return { duplicatePolicy: 'skip_existing', contentScope: defaultScope(), categoryMappings: {}, statusMappings: {} }
}

function clone(value, fallback) {
  if (value === undefined || value === null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function detectFileType(content) {
  const firstLine = content.split(/\r?\n/)[0] || ''
  const headers = firstLine.toLowerCase()
  if (headers.includes('title') && headers.includes('description') && headers.includes('status_name')) return 'feedback'
  if (headers.includes('comment_id') && headers.includes('comment')) return 'comments'
  if (headers.includes('vote') && !headers.includes('comment_id') && !headers.includes('title')) return 'votes'
  if (headers.includes('data_mail') && headers.includes('product_id') && !headers.includes('title')) return 'users'
  return null
}

export default {
  name: 'ProductSettingsImport',
  props: {
    project: { type: Object, required: true },
    resourceState: { type: Object, required: true },
    categories: { type: Array, default: () => [] },
    statuses: { type: Array, default: () => [] },
    ensureLoaded: { type: Function, default: null },
    refresh: { type: Function, default: null },
    ensureCategoriesLoaded: { type: Function, default: null },
    ensureStatusesLoaded: { type: Function, default: null },
    isActive: { type: Boolean, default: false },
  },
  data() {
    return {
      wizardSteps: [
        { id: 'upload', label: 'Upload' },
        { id: 'analyze', label: 'Analyze' },
        { id: 'configure', label: 'Configure' },
        { id: 'import', label: 'Import' },
      ],
      contentScopeOptions: [
        { key: 'feedback', label: 'Feedback' },
        { key: 'roadmap', label: 'Roadmap' },
        { key: 'changelog', label: 'Changelog' },
        { key: 'comments', label: 'Comments' },
        { key: 'subscriptions', label: 'Subscribers' },
      ],
      form: {
        contentScope: defaultScope(),
      },
      csvFiles: [],
      localMappingConfig: defaultMapping(),
      localDuplicatePolicy: 'skip_existing',
      currentRun: null,
      selectedRunId: null,
      isAnalyzing: false,
      isStarting: false,
      isStepping: false,
      runPollHandle: null,
      showWarnings: false,
    }
  },
  computed: {
    runs() {
      return Array.isArray(this.resourceState?.data) ? this.resourceState.data : []
    },
    historyLoading() {
      return ['idle', 'loading'].includes(this.resourceState?.status) && this.runs.length === 0
    },
    historyError() {
      return this.resourceState?.status === 'error' ? this.resourceState?.error || 'Failed to load import history' : null
    },
    canConfigureRun() {
      return Boolean(this.currentRun && ['ready', 'failed'].includes(this.currentRun.status))
    },
    canStartImport() {
      return this.canConfigureRun && !this.isStarting
    },
    visibleIssues() {
      return Array.isArray(this.currentRun?.issues) ? this.currentRun.issues : []
    },
    statusOptions() {
      const merged = [...SYSTEM_STATUS_OPTIONS, ...(Array.isArray(this.statuses) ? this.statuses : [])]
      const seen = new Set()
      return merged.filter((status) => {
        const key = String(status?.value || '').trim()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
    activeStep() {
      if (!this.currentRun) return this.csvFiles.length > 0 ? 'analyze' : 'upload'
      if (['ready', 'failed'].includes(this.currentRun.status)) return 'configure'
      return 'import'
    },
    analysisCounts() {
      const counts = this.currentRun?.summary?.counts || {}
      return [
        { label: 'Feedback', value: counts.feedback || 0 },
        { label: 'Comments', value: counts.comments || 0 },
        { label: 'Subscribers', value: counts.subscriptions || 0 },
        { label: 'Warnings', value: this.currentRun?.summary?.warnings || 0 },
      ]
    },
  },
  watch: {
    isActive: {
      immediate: true,
      async handler(isActive) {
        if (!isActive) return
        await this.activatePanel()
      },
    },
  },
  beforeUnmount() {
    this.stopPolling()
  },
  methods: {
    async activatePanel() {
      await Promise.all([
        this.ensureLoaded ? this.ensureLoaded().catch(() => null) : Promise.resolve(null),
        this.ensureCategoriesLoaded ? this.ensureCategoriesLoaded().catch(() => null) : Promise.resolve(null),
        this.ensureStatusesLoaded ? this.ensureStatusesLoaded().catch(() => null) : Promise.resolve(null),
      ])
      if (!this.currentRun && this.runs[0]) {
        await this.fetchRunDetail(this.runs[0].id).catch(() => null)
      } else if (this.currentRun?.status === 'importing') {
        this.schedulePolling()
      }
    },
    async handleFileSelect(event) {
      const files = event?.target?.files
      if (!files?.length) return
      for (const file of files) {
        try {
          const content = await file.text()
          const detectedType = detectFileType(content)
          this.csvFiles.push({ content, filename: file.name || 'import.csv', detectedType })
        } catch (err) {
          console.error('Failed to read CSV file:', err)
          toast.error(`Failed to read ${file.name}`)
        }
      }
      if (this.$refs.fileInput) this.$refs.fileInput.value = ''
    },
    removeFile(index) {
      this.csvFiles.splice(index, 1)
    },
    stepTextClass(stepId) {
      const steps = this.wizardSteps.map((s) => s.id)
      const activeIdx = steps.indexOf(this.activeStep)
      const thisIdx = steps.indexOf(stepId)
      if (thisIdx < activeIdx) return 'text-primary'
      if (thisIdx === activeIdx) return 'text-foreground font-semibold'
      return ''
    },
    statusClasses(status) {
      const map = {
        ready: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
        importing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
        failed: 'bg-destructive/10 text-destructive',
        canceled: 'bg-muted text-muted-foreground',
      }
      return map[status] || 'bg-muted text-muted-foreground'
    },
    issueClasses(severity) {
      const map = {
        warning: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20',
        error: 'border-destructive/30 bg-destructive/5',
        skipped: 'border-border bg-muted/20',
      }
      return map[severity] || 'border-border'
    },
    formatStatus(status) {
      return String(status || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    },
    formatSource(sourceType) {
      return sourceType === 'sleekplan' ? 'Sleekplan' : 'CSV'
    },
    formatDate(value) {
      if (!value) return 'just now'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return 'just now'
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    },
    normalizeError(err, fallbackMessage) {
      return err?.data?.error?.message || err?.statusMessage || fallbackMessage
    },
    async reloadHistory() {
      if (this.refresh) {
        await this.refresh().catch(() => {})
      }
    },
    buildAnalyzePayload() {
      const payload = {
        sourceType: 'csv',
        sourceMode: 'file',
        contentScope: clone(this.form.contentScope, defaultScope()),
      }

      if (this.csvFiles.length > 1) {
        return {
          ...payload,
          csvFiles: this.csvFiles.map((f) => ({ content: f.content, filename: f.filename || null })),
        }
      }

      return {
        ...payload,
        csvContent: this.csvFiles[0]?.content || '',
        csvFilename: this.csvFiles[0]?.filename || null,
      }
    },
    hydrateMappingConfig(run) {
      const mappingConfig = clone(run?.mappingConfig, defaultMapping())
      mappingConfig.contentScope = clone(run?.contentScope || mappingConfig.contentScope, defaultScope())
      mappingConfig.duplicatePolicy = mappingConfig.duplicatePolicy || 'skip_existing'
      this.localMappingConfig = mappingConfig
      this.localDuplicatePolicy = mappingConfig.duplicatePolicy
      this.form.contentScope = clone(mappingConfig.contentScope, defaultScope())
    },
    async fetchRunDetail(runId) {
      if (!runId) return null
      const response = await $fetch(`/api/projects/${this.project.slug}/imports/${runId}`)
      this.currentRun = response?.data || null
      this.selectedRunId = this.currentRun?.id || runId
      this.hydrateMappingConfig(this.currentRun)
      if (this.currentRun?.status === 'importing') this.schedulePolling()
      else this.stopPolling()
      return this.currentRun
    },
    async analyzeImport() {
      if (this.csvFiles.length === 0 || this.isAnalyzing) return
      this.isAnalyzing = true
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/imports/analyze`, {
          method: 'POST',
          body: this.buildAnalyzePayload(),
        })
        this.currentRun = response?.data || null
        if (!this.currentRun?.id) throw new Error('Missing import run from analysis')
        this.selectedRunId = this.currentRun.id
        this.hydrateMappingConfig(this.currentRun)
        await this.reloadHistory()
        toast.success('Analysis completed')
      } catch (err) {
        console.error('Import analysis failed:', err)
        toast.error(this.normalizeError(err, 'Failed to analyze import'))
      } finally {
        this.isAnalyzing = false
      }
    },
    selectRun(run) {
      this.fetchRunDetail(run.id).catch((err) => {
        console.error('Failed to load import run:', err)
        toast.error(this.normalizeError(err, 'Failed to load import run'))
      })
    },
    normalizeCategoryMappings() {
      const entries = Object.values(this.localMappingConfig.categoryMappings || {})
      for (const entry of entries) {
        if (entry.mode === 'existing' && !entry.targetId && this.categories[0]?.id) {
          entry.targetId = this.categories[0].id
        }
        if (entry.mode === 'existing') {
          const category = this.categories.find((item) => item.id === entry.targetId)
          if (category) entry.targetName = category.name
          continue
        }
        entry.targetId = undefined
        entry.targetName = entry.targetName || entry.sourceName
      }
    },
    normalizeStatusMappings() {
      const entries = Object.values(this.localMappingConfig.statusMappings || {})
      for (const entry of entries) {
        if (entry.mode === 'create') {
          entry.targetName = entry.targetName || entry.sourceName
          continue
        }
        if (!entry.targetValue && this.statusOptions[0]?.value) {
          entry.targetValue = this.statusOptions[0].value
        }
        const status = this.statusOptions.find((item) => item.value === entry.targetValue)
        if (status) entry.targetName = status.name
      }
    },
    buildMappingPayload() {
      this.normalizeCategoryMappings()
      this.normalizeStatusMappings()
      const payload = clone(this.localMappingConfig, defaultMapping())
      payload.duplicatePolicy = this.localDuplicatePolicy
      payload.contentScope = clone(this.form.contentScope, defaultScope())
      return payload
    },
    async startImport() {
      if (!this.currentRun || this.isStarting) return
      this.isStarting = true
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/imports/${this.currentRun.id}/start`, {
          method: 'POST',
          body: { mappingConfig: this.buildMappingPayload() },
        })
        this.currentRun = response?.data || null
        this.selectedRunId = this.currentRun?.id || this.selectedRunId
        await this.reloadHistory()
        this.schedulePolling()
        toast.success('Import started')
      } catch (err) {
        console.error('Failed to start import:', err)
        toast.error(this.normalizeError(err, 'Failed to start import'))
      } finally {
        this.isStarting = false
      }
    },
    async stepImportRun() {
      if (!this.currentRun || this.isStepping) return
      this.isStepping = true
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/imports/${this.currentRun.id}/step`, {
          method: 'POST',
        })
        this.currentRun = response?.data || null
        await this.reloadHistory()
        if (this.currentRun?.status === 'importing') this.schedulePolling()
        else this.stopPolling()
      } catch (err) {
        console.error('Failed to advance import:', err)
        this.stopPolling()
      } finally {
        this.isStepping = false
      }
    },
    schedulePolling() {
      if (!import.meta.client || this.currentRun?.status !== 'importing') {
        this.stopPolling()
        return
      }
      this.stopPolling()
      this.runPollHandle = window.setTimeout(() => {
        this.stepImportRun()
      }, 1500)
    },
    stopPolling() {
      if (!import.meta.client || !this.runPollHandle) return
      window.clearTimeout(this.runPollHandle)
      this.runPollHandle = null
    },
  },
}
</script>
