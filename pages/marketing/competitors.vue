<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="marketing-competitors-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Competitor watch</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Get told when a competitor changes their pricing, changelog or homepage.
          </p>
        </div>
        <MarketingProductPicker @change="onProductChange" @error="onPickerError" />
      </div>

      <div v-if="!pickerSettled || isLoading" class="space-y-4">
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        Products could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!product" class="text-sm text-muted-foreground">Create a product first to watch competitors.</div>

      <MarketingDisabled v-else-if="marketingOff" :product="product" :message="disabledMessage" />

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div
        v-else-if="!competitors.length"
        class="rounded-lg border border-border bg-card p-6"
        data-testid="competitor-empty"
      >
        <h2 class="text-lg font-semibold">No competitors listed yet</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Add the competitors you want to follow as terms first, optionally with their domain. Then come back here to
          pick the pages to watch.
        </p>
        <Button as-child variant="outline" class="mt-4">
          <NuxtLink to="/marketing/settings">
            <Icon name="lucide:settings" class="mr-2 h-4 w-4" />
            Marketing settings
          </NuxtLink>
        </Button>
      </div>

      <template v-else>
        <p
          v-if="site && !site.verified"
          class="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
          data-testid="competitor-unverified"
        >
          Pages are only checked once your site is verified. Verify it in
          <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
          .
        </p>

        <div
          class="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground"
          data-testid="competitor-note"
        >
          <p class="flex items-center gap-2 font-medium text-foreground">
            <Icon name="lucide:info" class="h-4 w-4" />
            How watching works
          </p>
          <ul class="mt-2 list-disc space-y-1 pl-5">
            <li>
              Each page is checked once a day at most, with at most {{ limits.perCompetitor }} pages per competitor.
            </li>
            <li>The competitor's robots.txt is respected. A page it disallows is never fetched.</li>
            <li>Requests identify as VeerifyBot. Only public pages are fetched, and only the page text is kept.</li>
          </ul>
          <label v-if="canManage" class="mt-3 flex items-start gap-2 text-foreground">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              :checked="summariesEnabled"
              :disabled="savingSetting"
              data-testid="competitor-summaries-toggle"
              @change="setSummaries($event.target.checked)"
            />
            <span>
              Summarise changes with AI
              <span class="block text-xs text-muted-foreground">
                Uses your own API key and monthly budget. Page text is sent to your AI provider.
              </span>
            </span>
          </label>
          <p v-if="settingError" class="mt-2 text-destructive">{{ settingError }}</p>
        </div>

        <p v-if="!canManage" class="text-sm text-muted-foreground">Only team admins can add or change watched pages.</p>

        <div class="grid gap-4 lg:grid-cols-2">
          <MarketingCompetitorWatch
            v-for="competitor in competitors"
            :key="competitor.id"
            :project-id="product.id"
            :competitor="competitor"
            :can-manage="canManage"
            :site-watch-count="siteWatchCount"
            :limits="limits"
            @changed="refresh"
          />
        </div>

        <p v-if="refreshError" class="text-sm text-destructive">{{ refreshError }}</p>

        <MarketingCompetitorChanges
          :changes="changes"
          :unseen-count="unseenCount"
          :marking="marking"
          @mark-seen="markAllSeen"
        />
        <p v-if="markError" class="text-sm text-destructive">{{ markError }}</p>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'MarketingCompetitorsPage',

  data() {
    return {
      product: null,
      pickerSettled: false,
      pickerError: false,
      isLoading: false,
      error: null,
      refreshError: null,
      marketingOff: false,
      disabledMessage: '',
      site: null,
      canManage: false,
      summariesEnabled: false,
      limits: { perCompetitor: 3, perSite: 15 },
      competitors: [],
      changes: [],
      unseenCount: 0,
      marking: false,
      markError: null,
      savingSetting: false,
      settingError: null,
    }
  },

  computed: {
    siteWatchCount() {
      return this.competitors.reduce((sum, c) => sum + c.watches.length, 0)
    },
  },

  methods: {
    base(productId = this.product.id) {
      return `/api/marketing/projects/${productId}/competitors`
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
      this.isLoading = false
      this.error = null
      this.refreshError = null
      this.marketingOff = false
      this.competitors = []
      this.changes = []
      this.unseenCount = 0
      this.site = null
      if (product) await this.load()
    },

    apply(data) {
      this.site = data.site
      this.canManage = data.canManage
      this.summariesEnabled = data.summariesEnabled
      this.limits = data.limits
      this.competitors = data.competitors
      this.changes = data.changes
      this.unseenCount = data.unseenCount
    },

    async load() {
      if (!this.product) return
      const productId = this.product.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      try {
        const response = await $fetch(this.base(productId))
        if (this.product?.id === productId) this.apply(response.data)
      } catch (err) {
        if (this.product?.id !== productId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load competitors')
        }
      } finally {
        if (this.product?.id === productId) this.isLoading = false
      }
    },

    /** Reload without replacing the page by skeletons. */
    async refresh() {
      if (!this.product) return
      const productId = this.product.id
      this.refreshError = null
      try {
        const response = await $fetch(this.base(productId))
        if (this.product?.id === productId) this.apply(response.data)
      } catch (err) {
        if (this.product?.id === productId) {
          this.refreshError = apiErrorMessage(err, 'Could not refresh the list. Reload the page to try again')
        }
      }
    },

    async markAllSeen() {
      this.marking = true
      this.markError = null
      try {
        await $fetch(`${this.base()}/changes/seen`, { method: 'POST', body: {} })
        await this.refresh()
      } catch (err) {
        this.markError = apiErrorMessage(err, 'Could not mark the changes as seen')
      } finally {
        this.marking = false
      }
    },

    async setSummaries(value) {
      this.savingSetting = true
      this.settingError = null
      try {
        const response = await $fetch(`${this.base()}/settings`, { method: 'PATCH', body: { summarize: value } })
        this.summariesEnabled = response.data.summariesEnabled
      } catch (err) {
        this.settingError = apiErrorMessage(err, 'Could not save the setting')
      } finally {
        this.savingSetting = false
      }
    },
  },
}
</script>
