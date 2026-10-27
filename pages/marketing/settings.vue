<template>
  <PageContainer data-testid="marketing-settings-page">
    <PageHeader title="Marketing settings" description="Your site and the terms Marketing uses for this project" />

    <MarketingProjectLoader @change="onProjectChange" @error="onLoaderError" />

    <template v-if="!loaderError">
      <div v-if="!pickerReady || isLoading" class="space-y-6">
        <Skeleton class="h-56 w-full" />
        <Skeleton class="h-56 w-full" />
        <Skeleton class="h-20 w-full" />
      </div>

      <MarketingNotice v-else-if="!project" title="No project yet">
        Marketing works on a project. Create one to get started.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/workspace">Go to workspace settings</NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <MarketingDisabled v-else-if="disabledMessage !== null" :project="project" :message="disabledMessage" />

      <MarketingLoadError
        v-else-if="error"
        title="Failed to load marketing settings"
        :message="error"
        @retry="loadSite()"
      />

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
                <Icon name="lucide:settings" class="mr-2 h-4 w-4" />
                Workspace settings
              </NuxtLink>
            </Button>
          </CardContent>
        </Card>
      </template>
    </template>
  </PageContainer>
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
