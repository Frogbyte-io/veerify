<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="marketing-language-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Customer language</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Find the words your customers use, and turn them into terms and prompts to track.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />
          <Button
            v-if="showContent"
            :disabled="!canRunNow"
            :title="runDisabledReason"
            data-testid="language-run"
            @click="run"
          >
            <Icon
              :name="running ? 'lucide:loader-circle' : 'lucide:sparkles'"
              :class="['mr-2 h-4 w-4', running && 'animate-spin']"
            />
            {{ running ? 'Analyzing...' : 'Run analysis' }}
          </Button>
        </div>
      </div>

      <p
        v-if="showContent && runDisabledReason"
        class="text-sm text-muted-foreground"
        data-testid="language-run-reason"
      >
        {{ runDisabledReason }}
      </p>
      <p v-if="runError" class="text-sm text-destructive" data-testid="language-run-error">{{ runError }}</p>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        The project could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!project" class="text-sm text-muted-foreground">Create a project to analyze language.</div>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <div v-else-if="isLoading" class="space-y-4">
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div v-else-if="noSite" class="rounded-lg border border-border bg-card p-6" data-testid="language-no-site">
        <h2 class="text-lg font-semibold">Add your site first</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Customer language results are stored with your marketing site. Add it in
          <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
          .
        </p>
      </div>

      <div v-else class="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <MarketingLanguageConsent :consent="consent" :can-manage="consent.canManage" @changed="refresh" />

        <div>
          <div v-if="running" class="space-y-4">
            <Skeleton class="h-40 w-full" />
            <Skeleton class="h-48 w-full" />
          </div>
          <MarketingLanguageResults
            v-else-if="insight"
            :insight="insight"
            :applying="applying"
            :apply-error="applyError"
            :selection-reset-key="selectionResetKey"
            @apply="apply"
          />
          <div v-else class="rounded-lg border border-border bg-card p-6" data-testid="language-empty">
            <h2 class="text-lg font-semibold">No analysis yet</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Allow a source on the left, then run an analysis. It needs at least 10 items from the last 90 days.
            </p>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'MarketingLanguagePage',

  created() {
    useHead({ title: 'Language · Marketing' })
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
      noSite: false,
      insight: null,
      consent: {
        allowFeedbackText: false,
        allowSupportText: false,
        consentedBy: null,
        consentedAt: null,
        canManage: false,
      },
      canRun: false,
      reason: null,
      message: null,
      running: false,
      runError: null,
      applying: false,
      applyError: null,
      selectionResetKey: 0,
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
        !this.noSite
      )
    },
    canRunNow() {
      return this.consent.canManage && this.canRun && !this.running
    },
    runDisabledReason() {
      if (this.running) return ''
      if (!this.consent.canManage) return 'Only project admins can run an analysis.'
      return this.canRun ? '' : this.message || ''
    },
  },

  methods: {
    base(projectId = this.project.id) {
      return `/api/marketing/projects/${projectId}/language`
    },

    onPickerError() {
      this.project = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProjectChange(project) {
      this.project = project
      this.pickerSettled = true
      this.pickerError = false
      this.error = null
      this.marketingOff = false
      this.noSite = false
      this.runError = null
      this.applyError = null
      this.insight = null
      this.running = false
      this.applying = false
      if (project) await this.load()
    },

    applyLatest(data) {
      this.insight = data.insight
      this.consent = data.consent
      this.canRun = data.canRun
      this.reason = data.reason
      this.message = data.message
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      this.noSite = false
      try {
        const response = await $fetch(`${this.base(projectId)}/latest`)
        if (this.project?.id === projectId) this.applyLatest(response.data)
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else if (apiErrorStatus(err) === 404) {
          this.noSite = true
        } else {
          this.error = apiErrorMessage(err, 'Failed to load customer language')
        }
      } finally {
        if (this.project?.id === projectId) this.isLoading = false
      }
    },

    /**
     * Reload without skeletons, e.g. after a consent change or a run. A failure
     * keeps the page as it is and tells the user with a toast; a 403 means
     * marketing was switched off in the meantime.
     */
    async refresh() {
      if (!this.project) return
      const projectId = this.project.id
      try {
        const response = await $fetch(`${this.base(projectId)}/latest`)
        if (this.project?.id === projectId) this.applyLatest(response.data)
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          toast.error(apiErrorMessage(err, 'Could not refresh customer language'))
        }
      }
    },

    async run() {
      if (!this.project) return
      const projectId = this.project.id
      this.running = true
      this.runError = null
      try {
        await $fetch(`${this.base(projectId)}/runs`, { method: 'POST' })
        if (this.project?.id === projectId) toast.success('Analysis complete')
      } catch (err) {
        if (this.project?.id === projectId) this.runError = apiErrorMessage(err, 'The analysis could not be run')
      } finally {
        if (this.project?.id === projectId) {
          this.running = false
          await this.refresh()
        }
      }
    },

    async apply(selection) {
      if (!this.project) return
      const projectId = this.project.id
      this.applying = true
      this.applyError = null
      try {
        const response = await $fetch(`${this.base(projectId)}/apply`, { method: 'POST', body: selection })
        if (this.project?.id !== projectId) return
        const { terms, prompts } = response.data
        const added = terms.added.length + prompts.added.length
        const skipped = terms.skipped.length + prompts.skipped.length
        const text = `Added ${added}${skipped ? `, skipped ${skipped} (duplicates, invalid or over the limit)` : ''}`
        if (added > 0) toast.success(text)
        else toast.error(`Nothing added. ${skipped} skipped (duplicates, invalid or over the limit)`)
        this.selectionResetKey += 1
        await this.refresh()
      } catch (err) {
        if (this.project?.id === projectId) this.applyError = apiErrorMessage(err, 'Could not add the selection')
      } finally {
        if (this.project?.id === projectId) this.applying = false
      }
    },
  },
}
</script>
