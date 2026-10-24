<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="marketing-audit-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Site audit</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Check how search engines and AI assistants see your site, and what to fix first.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />
          <Button
            v-if="showContent"
            :disabled="!canRun"
            :title="runDisabledReason"
            data-testid="audit-run"
            @click="runAudit"
          >
            <Icon name="lucide:play" class="mr-2 h-4 w-4" />
            {{ starting ? 'Starting...' : 'Run audit' }}
          </Button>
        </div>
      </div>

      <p v-if="showContent && runDisabledReason" class="text-sm text-muted-foreground" data-testid="audit-run-reason">
        {{ runDisabledReason }}
      </p>
      <p v-if="startError" class="text-sm text-destructive">{{ startError }}</p>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        The project could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!project" class="text-sm text-muted-foreground">Create a project to run a site audit.</div>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <div v-else-if="isLoading" class="space-y-4">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div v-else-if="notVerified" class="rounded-lg border border-border bg-card p-6" data-testid="audit-not-verified">
        <h2 class="text-lg font-semibold">Verify your site first</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Veerify only audits sites you have proven you own. Add your site and verify it in
          <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
          . The first audit then runs automatically.
        </p>
      </div>

      <div v-else-if="!audits.length" class="rounded-lg border border-border bg-card p-6" data-testid="audit-empty">
        <h2 class="text-lg font-semibold">No audits yet</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          The first audit of {{ site.origin }} starts automatically after verification. You can also run one now.
        </p>
      </div>

      <template v-else>
        <div v-if="detailLoading && !detail" class="space-y-4">
          <Skeleton class="h-40 w-full" />
          <Skeleton class="h-64 w-full" />
        </div>

        <div v-else-if="detailError" class="flex items-center gap-2 text-sm text-destructive">
          <span>{{ detailError }}</span>
          <Button variant="outline" size="sm" @click="loadDetail">Retry</Button>
        </div>

        <div v-else-if="detail" class="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div class="space-y-6">
            <MarketingAuditModeNotice :mode="detail.mode" :page-limit="detail.pageLimit" />

            <MarketingAuditProgress
              v-if="isActive"
              :audit="detail"
              :cancelling="cancelling"
              :cancel-error="cancelError"
              @cancel="cancelAudit"
            />

            <div
              v-else-if="detail.status === 'failed'"
              class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
              data-testid="audit-failed"
            >
              <p class="font-medium text-destructive">This audit failed</p>
              <p class="mt-1 text-muted-foreground">{{ detail.error || 'Unknown error.' }}</p>
            </div>

            <div v-else-if="detail.status === 'cancelled'" class="text-sm text-muted-foreground">
              This audit was cancelled.
            </div>

            <template v-if="detail.status === 'done'">
              <MarketingAuditScoreCard :audit="detail" :history="audits" />
              <MarketingAuditCrawlerAccess :site-facts="detail.siteFacts" />
              <MarketingAuditIssues :issues="detail.issues" :summary="detail.summary" />
              <div class="grid gap-6 md:grid-cols-2">
                <MarketingAuditSiteFiles :site-facts="detail.siteFacts" />
                <MarketingAuditVitals :site-facts="detail.siteFacts" />
              </div>
              <MarketingAuditPages :project-id="project.id" :audit-id="detail.id" />
            </template>
          </div>

          <MarketingAuditHistory :audits="audits" :selected-id="selectedId" @select="selectAudit" />
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const POLL_MS = 5000

export default {
  name: 'MarketingAuditPage',

  created() {
    useHead({ title: 'Site audit · Marketing' })
  },

  data() {
    return {
      project: null,
      pickerSettled: false,
      pickerError: false,
      isLoading: false,
      error: null,
      marketingOff: false,
      disabledMessage: '',
      site: null,
      audits: [],
      canStart: false,
      reason: null,
      message: null,
      resetsAt: null,
      selectedId: null,
      detail: null,
      detailLoading: false,
      detailError: null,
      starting: false,
      startError: null,
      cancelling: false,
      cancelError: null,
      pollTimer: null,
    }
  },

  computed: {
    showContent() {
      return (
        this.pickerSettled &&
        Boolean(this.project) &&
        !this.marketingOff &&
        !this.isLoading &&
        !this.error &&
        !this.notVerified
      )
    },
    notVerified() {
      return !this.marketingOff && !this.error && !this.isLoading && (!this.site || !this.site.verified)
    },
    isActive() {
      return Boolean(this.detail) && ['queued', 'crawling', 'analyzing'].includes(this.detail.status)
    },
    canRun() {
      return this.canStart && !this.starting
    },
    runDisabledReason() {
      if (this.canStart) return ''
      if (this.reason === 'daily_limit' && this.resetsAt) {
        return `Daily limit reached. You can run another audit after ${new Date(this.resetsAt).toLocaleString()}.`
      }
      return this.message || ''
    },
  },

  beforeUnmount() {
    this.stopPolling()
  },

  methods: {
    base(projectId = this.project.id) {
      return `/api/marketing/projects/${projectId}/audits`
    },

    onPickerError() {
      this.stopPolling()
      this.project = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProjectChange(project) {
      this.stopPolling()
      this.project = project
      this.pickerSettled = true
      this.pickerError = false
      this.isLoading = false
      this.error = null
      this.detailError = null
      this.marketingOff = false
      this.startError = null
      this.cancelError = null
      this.detail = null
      this.selectedId = null
      this.audits = []
      this.site = null
      if (project) await this.load()
    },

    applyList(data) {
      this.site = data.site
      this.audits = data.audits
      this.canStart = data.canStart
      this.reason = data.reason
      this.message = data.message
      this.resetsAt = data.resetsAt
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      try {
        const response = await $fetch(this.base(projectId))
        if (this.project?.id !== projectId) return
        this.applyList(response.data)
        if (this.audits.length) {
          this.selectedId = this.selectedId || this.audits[0].id
          await this.loadDetail()
        }
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load audits')
        }
      } finally {
        if (this.project?.id === projectId) {
          this.isLoading = false
          this.syncPolling()
        }
      }
    },

    async loadDetail() {
      if (!this.selectedId || !this.project) return
      const id = this.selectedId
      const projectId = this.project.id
      this.detailLoading = true
      this.detailError = null
      try {
        const response = await $fetch(`${this.base(projectId)}/${id}`)
        if (this.project?.id === projectId && id === this.selectedId) this.detail = response.data
      } catch (err) {
        if (this.project?.id === projectId && id === this.selectedId) {
          this.detailError = apiErrorMessage(err, 'Failed to load the audit')
        }
      } finally {
        if (this.project?.id === projectId && id === this.selectedId) this.detailLoading = false
      }
    },

    async selectAudit(id) {
      if (id === this.selectedId) return
      this.selectedId = id
      this.detail = null
      await this.loadDetail()
      this.syncPolling()
    },

    async runAudit() {
      this.starting = true
      this.startError = null
      try {
        const response = await $fetch(this.base(), { method: 'POST' })
        this.selectedId = response.data.id
        this.detail = null
        await this.refresh()
      } catch (err) {
        this.startError = apiErrorMessage(err, 'Could not start the audit')
        await this.refresh()
      } finally {
        this.starting = false
      }
    },

    async cancelAudit() {
      this.cancelling = true
      this.cancelError = null
      try {
        await $fetch(`${this.base()}/${this.detail.id}/cancel`, { method: 'POST' })
        await this.refresh()
      } catch (err) {
        this.cancelError = apiErrorMessage(err, 'Could not cancel the audit')
      } finally {
        this.cancelling = false
      }
    },

    /**
     * Reload the list and the selected audit without flashing skeletons.
     * Background failures never replace the page: poll errors are ignored and
     * the next tick retries.
     */
    async refresh() {
      if (!this.project) return
      const projectId = this.project.id
      try {
        const response = await $fetch(this.base(projectId))
        if (this.project?.id !== projectId) return
        this.applyList(response.data)
        this.error = null
        if (!this.selectedId && this.audits.length) this.selectedId = this.audits[0].id
        await this.loadDetail()
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.stopPolling()
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        }
      }
      if (this.project?.id === projectId) this.syncPolling()
    },

    syncPolling() {
      if (!import.meta.client) return
      if (this.isActive && !this.pollTimer) {
        this.pollTimer = setInterval(() => this.refresh(), POLL_MS)
      } else if (!this.isActive) {
        this.stopPolling()
      }
    },

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    },
  },
}
</script>
