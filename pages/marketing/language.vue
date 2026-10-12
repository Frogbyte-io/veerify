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
          <MarketingProductPicker @change="onProductChange" @error="onPickerError" />
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
        Products could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!product" class="text-sm text-muted-foreground">Create a product first to analyze language.</div>

      <MarketingDisabled v-else-if="marketingOff" :product="product" :message="disabledMessage" />

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
        <MarketingLanguageConsent
          :team-id="teamId"
          :consent="consent"
          :can-manage="consent.canManage"
          @changed="refresh"
        />

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
      product: null,
      pickerSettled: false,
      pickerError: false,
      isLoading: false,
      error: null,
      marketingOff: false,
      disabledMessage: '',
      noSite: false,
      teamId: '',
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
        Boolean(this.product) &&
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
      if (!this.consent.canManage) return 'Only team admins can run an analysis.'
      return this.canRun ? '' : this.message || ''
    },
  },

  methods: {
    base(productId = this.product.id) {
      return `/api/marketing/projects/${productId}/language`
    },

    onPickerError() {
      this.product = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProductChange(product) {
      this.product = product
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
      if (product) await this.load()
    },

    applyLatest(data) {
      this.teamId = data.teamId
      this.insight = data.insight
      this.consent = data.consent
      this.canRun = data.canRun
      this.reason = data.reason
      this.message = data.message
    },

    async load() {
      if (!this.product) return
      const productId = this.product.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      this.noSite = false
      try {
        const response = await $fetch(`${this.base(productId)}/latest`)
        if (this.product?.id === productId) this.applyLatest(response.data)
      } catch (err) {
        if (this.product?.id !== productId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else if (apiErrorStatus(err) === 404) {
          this.noSite = true
        } else {
          this.error = apiErrorMessage(err, 'Failed to load customer language')
        }
      } finally {
        if (this.product?.id === productId) this.isLoading = false
      }
    },

    /**
     * Reload without skeletons, e.g. after a consent change or a run. A failure
     * keeps the page as it is and tells the user with a toast; a 403 means
     * marketing was switched off in the meantime.
     */
    async refresh() {
      if (!this.product) return
      const productId = this.product.id
      try {
        const response = await $fetch(`${this.base(productId)}/latest`)
        if (this.product?.id === productId) this.applyLatest(response.data)
      } catch (err) {
        if (this.product?.id !== productId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          toast.error(apiErrorMessage(err, 'Could not refresh customer language'))
        }
      }
    },

    async run() {
      if (!this.product) return
      const productId = this.product.id
      this.running = true
      this.runError = null
      try {
        await $fetch(`${this.base(productId)}/runs`, { method: 'POST' })
        if (this.product?.id === productId) toast.success('Analysis complete')
      } catch (err) {
        if (this.product?.id === productId) this.runError = apiErrorMessage(err, 'The analysis could not be run')
      } finally {
        if (this.product?.id === productId) {
          this.running = false
          await this.refresh()
        }
      }
    },

    async apply(selection) {
      if (!this.product) return
      const productId = this.product.id
      this.applying = true
      this.applyError = null
      try {
        const response = await $fetch(`${this.base(productId)}/apply`, { method: 'POST', body: selection })
        if (this.product?.id !== productId) return
        const { terms, prompts } = response.data
        const added = terms.added.length + prompts.added.length
        const skipped = terms.skipped.length + prompts.skipped.length
        const text = `Added ${added}${skipped ? `, skipped ${skipped} (duplicates, invalid or over the limit)` : ''}`
        if (added > 0) toast.success(text)
        else toast.error(`Nothing added. ${skipped} skipped (duplicates, invalid or over the limit)`)
        this.selectionResetKey += 1
        await this.refresh()
      } catch (err) {
        if (this.product?.id === productId) this.applyError = apiErrorMessage(err, 'Could not add the selection')
      } finally {
        if (this.product?.id === productId) this.applying = false
      }
    },
  },
}
</script>
