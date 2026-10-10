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
          <MarketingProductPicker @change="onProductChange" />
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

      <div v-if="!product && pickerSettled" class="text-sm text-muted-foreground">
        Create a product first to run a site audit.
      </div>

      <div v-else-if="isLoading" class="space-y-4">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div
        v-else-if="marketingOff"
        class="rounded-lg border border-border bg-card p-6"
        data-testid="audit-marketing-off"
      >
        <h2 class="text-lg font-semibold">Marketing is off for this product</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Turn on the Marketing module for your team and this product in
          <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
          to run audits.
        </p>
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
              <MarketingAuditPages :project-id="product.id" :audit-id="detail.id" />
            </template>
          </div>

          <MarketingAuditHistory :audits="audits" :selected-id="selectedId" @select="selectAudit" />
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
const POLL_MS = 5000

export default {
  name: 'MarketingAuditPage',

  data() {
    return {
      product: null,
      pickerSettled: false,
      isLoading: false,
      error: null,
      marketingOff: false,
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
      return Boolean(this.product) && !this.marketingOff && !this.isLoading && !this.error && !this.notVerified
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
    base() {
      return `/api/marketing/projects/${this.product.id}/audits`
    },

    async onProductChange(product) {
      this.stopPolling()
      this.product = product
      this.pickerSettled = true
      this.detail = null
      this.selectedId = null
      this.audits = []
      this.site = null
      if (product) await this.load()
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
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      try {
        const response = await $fetch(this.base())
        this.applyList(response.data)
        if (this.audits.length) {
          this.selectedId = this.selectedId || this.audits[0].id
          await this.loadDetail()
        }
      } catch (err) {
        if (err?.statusCode === 403 || err?.status === 403) this.marketingOff = true
        else this.error = err?.data?.error?.message || 'Failed to load audits'
      } finally {
        this.isLoading = false
      }
      this.syncPolling()
    },

    async loadDetail() {
      if (!this.selectedId) return
      const id = this.selectedId
      this.detailLoading = true
      this.detailError = null
      try {
        const response = await $fetch(`${this.base()}/${id}`)
        if (id === this.selectedId) this.detail = response.data
      } catch (err) {
        this.detailError = err?.data?.error?.message || 'Failed to load the audit'
      } finally {
        this.detailLoading = false
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
        this.startError = err?.data?.error?.message || err?.data?.statusMessage || 'Could not start the audit'
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
        this.cancelError = err?.data?.error?.message || 'Could not cancel the audit'
      } finally {
        this.cancelling = false
      }
    },

    /** Reload the list and the selected audit without flashing skeletons */
    async refresh() {
      try {
        const response = await $fetch(this.base())
        this.applyList(response.data)
        if (!this.selectedId && this.audits.length) this.selectedId = this.audits[0].id
        await this.loadDetail()
      } catch (err) {
        this.error = err?.data?.error?.message || 'Failed to refresh audits'
      }
      this.syncPolling()
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
