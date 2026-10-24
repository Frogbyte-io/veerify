<template>
  <NuxtLayout name="dashboard">
    <div class="p-4 sm:p-6 max-w-4xl mx-auto min-w-0 space-y-6" data-testid="marketing-settings-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Marketing settings</h1>
          <p class="text-muted-foreground mt-1">Your site and the terms Marketing uses for this project</p>
        </div>
        <MarketingProjectLoader @change="onProjectChange" @error="onLoaderError" />
      </div>

      <p v-if="loaderError" class="text-sm text-muted-foreground" data-testid="marketing-picker-error">
        The project could not be loaded. Use Retry above to try again.
      </p>

      <template v-else-if="pickerReady">
        <Card v-if="!project">
          <CardContent class="py-10 text-center">
            <p class="font-medium mb-1">No project yet</p>
            <p class="text-sm text-muted-foreground mb-4">Marketing works on a project. Create one to get started.</p>
            <Button as-child variant="outline">
              <NuxtLink to="/workspace">Go to workspace settings</NuxtLink>
            </Button>
          </CardContent>
        </Card>

        <MarketingDisabled v-else-if="disabledMessage !== null" :project="project" :message="disabledMessage" />

        <template v-else>
          <div v-if="isLoading" class="space-y-6">
            <Skeleton class="h-56 w-full" />
            <Skeleton class="h-56 w-full" />
            <Skeleton class="h-56 w-full" />
          </div>

          <Card v-else-if="error">
            <CardContent class="text-center py-8">
              <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
              <p class="font-medium mb-2">Failed to load marketing settings</p>
              <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
              <Button variant="outline" @click="loadSite()">
                <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
                Try again
              </Button>
            </CardContent>
          </Card>

          <template v-else>
            <MarketingSettingsSite
              :project="project"
              :site="site"
              :verification="verification"
              :can-manage="canManage"
              @changed="onSiteChanged"
            />
            <MarketingSettingsTerms :project="project" :site-added="site !== null" />
            <Card data-testid="marketing-settings-workspace-note">
              <CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
                <p class="text-sm text-muted-foreground">
                  API keys, budgets, integrations and data consent are in Workspace settings.
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink to="/workspace">
                    <Icon name="lucide:settings" class="w-4 h-4 mr-2" />
                    Workspace settings
                  </NuxtLink>
                </Button>
              </CardContent>
            </Card>
          </template>
        </template>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'MarketingSettingsPage',

  created() {
    useHead({ title: 'Marketing settings' })
  },

  data() {
    return {
      pickerReady: false,
      project: null,
      loaderError: false,
      site: null,
      verification: null,
      canManage: false,
      isLoading: false,
      error: null,
      disabledMessage: null,
      hashToken: 0,
    }
  },

  watch: {
    // Same-page hash changes (setup checklist links) re-focus the target section
    '$route.hash'() {
      this.focusHashSection()
    },
  },

  beforeUnmount() {
    this.hashToken++
  },

  methods: {
    onLoaderError() {
      this.project = null
      this.loaderError = true
      this.pickerReady = true
    },

    async onProjectChange(project) {
      this.pickerReady = true
      this.loaderError = false
      this.project = project
      this.site = null
      this.verification = null
      this.disabledMessage = null
      this.error = null
      if (!project) return
      await this.loadSite()
    },

    // `silent` refreshes in place so the sections below keep their local state
    async loadSite(silent = false) {
      if (!this.project) return
      const projectId = this.project.id
      if (!silent) this.isLoading = true
      this.error = null
      this.disabledMessage = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/site`)
        if (this.project?.id !== projectId) return
        this.site = response?.data?.site || null
        this.verification = response?.data?.verification || null
        this.canManage = response?.data?.canManage === true
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the site')
        }
      } finally {
        if (this.project?.id === projectId) this.isLoading = false
        if (!silent && this.$route.hash) this.$nextTick(() => this.focusHashSection())
      }
    },

    // Deep links from the setup checklist: /marketing/settings#terms
    // Sections render after their data loads, so poll animation frames (up to ~2s) until the
    // section's first enabled control exists. A newer call or a route change cancels the poll.
    focusHashSection() {
      if (!import.meta.client) return
      const token = ++this.hashToken
      let id = ''
      try {
        id = decodeURIComponent((this.$route.hash || '').slice(1))
      } catch {
        return
      }
      if (!id || !['site', 'terms'].includes(id)) return
      const deadline = performance.now() + 2000
      const attempt = () => {
        if (token !== this.hashToken) return
        const section = document.getElementById(id)
        const field = section?.querySelector(
          'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]'
        )
        if (section && field) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' })
          field.focus({ preventScroll: true })
          return
        }
        if (performance.now() < deadline) requestAnimationFrame(attempt)
      }
      requestAnimationFrame(attempt)
    },

    async onSiteChanged() {
      await this.loadSite(true)
    },
  },
}
</script>
