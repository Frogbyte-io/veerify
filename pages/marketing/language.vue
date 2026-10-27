<template>
  <PageContainer data-testid="marketing-language-page">
    <PageHeader title="Customer language">
      <template #description>
        Find the words your customers use, and turn them into terms and prompts to track.
        <span v-if="runError" class="mt-1 block min-h-5 text-destructive" role="alert" data-testid="language-run-error">
          {{ runError }}
        </span>
        <span v-else class="mt-1 block min-h-5" data-testid="language-run-reason">{{
          showContent ? runDisabledReason : ''
        }}</span>
      </template>
      <template #actions>
        <Button
          :disabled="!showContent || !canRunNow"
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
      </template>
    </PageHeader>

    <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />

    <template v-if="!pickerError">
      <div v-if="!pickerSettled || isLoading" class="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Skeleton class="h-72 w-full" />
        <div class="space-y-6">
          <Skeleton class="h-48 w-full" />
          <Skeleton class="h-64 w-full" />
        </div>
      </div>

      <MarketingNotice v-else-if="!project" title="No project yet">
        Marketing works on a project. Create one to analyze language.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/workspace">Go to workspace settings</NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <MarketingLoadError v-else-if="error" title="Failed to load customer language" :message="error" @retry="load()" />

      <MarketingNotice v-else-if="noSite" title="Add your site first" data-testid="language-no-site">
        Customer language results are stored with your marketing site. Add it in
        <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
        .
      </MarketingNotice>

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
          <MarketingNotice v-else title="No analysis yet" data-testid="language-empty">
            Allow a source on the left, then run an analysis. It needs at least 10 items from the last 90 days.
          </MarketingNotice>
        </div>
      </div>
    </template>
  </PageContainer>
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
