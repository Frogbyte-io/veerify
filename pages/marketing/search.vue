<template>
  <NuxtLayout name="dashboard">
    <div class="space-y-6 p-6" data-testid="marketing-search-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Search</h1>
          <p class="mt-1 text-sm text-muted-foreground">Clicks, impressions and queries from Google Search Console.</p>
        </div>
        <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />
      </div>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        The project could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!project" class="text-sm text-muted-foreground">
        Create a project to see its search performance.
      </div>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <div v-else-if="isLoading" class="space-y-4">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div
        v-else-if="!data || !data.site || !data.site.verified"
        class="rounded-lg border border-border bg-card p-6"
        data-testid="search-not-verified"
      >
        <h2 class="text-lg font-semibold">Verify your site first</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Search Console data is only shown for sites you have proven you own. Add your site and verify it in
          <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
          .
        </p>
      </div>

      <template v-else>
        <p v-if="callbackError" class="text-sm text-destructive" role="alert" data-testid="search-callback-error">
          {{ callbackError }}
        </p>

        <MarketingSearchConnect
          v-if="!data.configured || !data.connection || data.connection.status === 'error'"
          :configured="data.configured"
          :can-manage="data.canManage"
          :origin="data.site.origin"
          :redirect-uri="data.redirectUri"
          :reconnect="Boolean(data.connection)"
          :connecting="connecting"
          :connect-error="connectError"
          @connect="connect"
        />

        <MarketingSearchStatus
          v-if="data.connection && data.configured"
          :project-id="project.id"
          :connection="data.connection"
          :can-manage="data.canManage"
          @disconnected="onDisconnected"
        />

        <MarketingSearchProperty
          v-if="data.connection && data.configured && data.connection.status === 'needs_property'"
          :project-id="project.id"
          :origin="data.site.origin"
          :email="data.connection.email"
          :can-manage="data.canManage"
          @saved="onPropertySaved"
          @revoked="load"
        />

        <template v-else-if="data.connection && data.connection.status === 'connected'">
          <MarketingSearchKpis v-if="data.totals" :totals="data.totals" :days="data.days" />
          <p
            v-else
            class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
            data-testid="search-no-data"
          >
            Connected. The first sync is queued and runs within the hour. Google only reports finished days, so new
            sites can take a few days to show data.
          </p>
          <MarketingSearchChart v-if="data.totals" :daily="data.daily" />
          <MarketingSearchQueries
            v-if="data.totals || data.topQueries.length"
            :queries="data.topQueries"
            :period-end="data.queriesPeriodEnd"
          />
        </template>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const CALLBACK_ERRORS = {
  access_denied: 'Google access was not granted, so Search Console was not connected.',
  invalid_state: 'The connection request was not valid. Start again.',
  expired_state: 'The connection request expired. Start again.',
  user_mismatch: 'You must finish connecting with the same account that started it.',
  forbidden: 'Only project admins can connect Search Console.',
  not_configured: 'Search Console is not configured on this server.',
  site_changed: 'The site changed or lost verification during the connection. Start again.',
  exchange_failed: 'Google did not accept the connection. Start again and approve all requested access.',
  google_error: 'Google reported an error. Start again.',
}

export default {
  name: 'MarketingSearchPage',

  created() {
    useHead({ title: 'Search · Marketing' })
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
      data: null,
      connecting: false,
      connectError: null,
      callbackError: null,
      handledCallback: false,
    }
  },

  methods: {
    onPickerError() {
      this.project = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProjectChange(project) {
      this.project = project
      this.pickerSettled = true
      this.pickerError = false
      this.isLoading = false
      this.error = null
      this.marketingOff = false
      this.connectError = null
      this.callbackError = null
      this.data = null
      this.consumeCallbackFlags()
      if (project) await this.load()
    },

    /** `?connected=1` and `?error=<code>` come from the OAuth callback redirect; show once, then clean the URL. */
    consumeCallbackFlags() {
      if (this.handledCallback) return
      const { connected, error, ...rest } = this.$route.query
      if (!connected && !error) return
      this.handledCallback = true
      if (connected === '1') {
        toast.success('Search Console connected')
      } else if (typeof error === 'string') {
        this.callbackError = CALLBACK_ERRORS[error] || 'Could not connect Search Console.'
      }
      this.$router.replace({ query: rest })
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/search/summary`)
        if (this.project?.id !== projectId) return
        this.data = response.data
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load search data')
        }
      } finally {
        if (this.project?.id === projectId) this.isLoading = false
      }
    },

    async connect() {
      const projectId = this.project.id
      this.connecting = true
      this.connectError = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/search/connect`)
        if (import.meta.client) window.location.href = response.data.url
      } catch (err) {
        this.connectError = apiErrorMessage(err, 'Could not start the connection')
        this.connecting = false
      }
    },

    async onPropertySaved() {
      toast.success('Property saved. The first sync runs within the hour.')
      await this.load()
    },

    async onDisconnected() {
      toast.success('Search Console disconnected')
      await this.load()
    },
  },
}
</script>
