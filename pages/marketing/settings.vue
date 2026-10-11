<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-4xl mx-auto space-y-6" data-testid="marketing-settings-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Marketing settings</h1>
          <p class="text-muted-foreground mt-1">Your site, brand terms and the keys Marketing runs on</p>
        </div>
        <MarketingProductPicker @change="onProductChange" />
      </div>

      <template v-if="pickerReady">
        <Card v-if="!product">
          <CardContent class="py-10 text-center">
            <p class="font-medium mb-1">No products yet</p>
            <p class="text-sm text-muted-foreground mb-4">Marketing works on a product. Create one to get started.</p>
            <Button as-child variant="outline">
              <NuxtLink to="/products">Go to products</NuxtLink>
            </Button>
          </CardContent>
        </Card>

        <MarketingDisabled v-else-if="disabledMessage !== null" :product="product" :message="disabledMessage" />

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
              :product="product"
              :site="site"
              :verification="verification"
              :can-manage="canManage"
              @changed="onSiteChanged"
            />
            <MarketingSettingsTerms :product="product" :site-added="site !== null" />
            <MarketingSettingsApiKeys :team-id="product.teamId" @changed="loadIntegrations" />
            <MarketingSettingsIntegrations
              :integrations="integrations"
              :is-loading="integrationsLoading"
              :error="integrationsError"
              :team-id="product.teamId"
              :can-manage="canManage"
              @retry="loadIntegrations()"
              @refresh="loadIntegrations(true)"
            />
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

  data() {
    return {
      pickerReady: false,
      product: null,
      site: null,
      verification: null,
      canManage: false,
      isLoading: false,
      error: null,
      disabledMessage: null,
      integrations: [],
      integrationsLoading: false,
      integrationsError: null,
    }
  },

  methods: {
    async onProductChange(product) {
      this.pickerReady = true
      this.product = product
      this.site = null
      this.verification = null
      this.integrations = []
      this.disabledMessage = null
      this.error = null
      if (!product) return
      await this.loadSite()
    },

    // `silent` refreshes in place so the sections below keep their local state
    async loadSite(silent = false) {
      if (!this.product) return
      const productId = this.product.id
      if (!silent) this.isLoading = true
      this.error = null
      this.disabledMessage = null
      try {
        const response = await $fetch(`/api/marketing/projects/${productId}/site`)
        if (this.product?.id !== productId) return
        this.site = response?.data?.site || null
        this.verification = response?.data?.verification || null
        this.canManage = response?.data?.canManage === true
        this.loadIntegrations()
      } catch (err) {
        if (this.product?.id !== productId) return
        if (apiErrorStatus(err) === 403) {
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the site')
        }
      } finally {
        if (this.product?.id === productId) this.isLoading = false
      }
    },

    async onSiteChanged() {
      await this.loadSite(true)
    },

    // `silent` refreshes in place, so test results below stay on screen
    async loadIntegrations(silent = false) {
      if (!this.product) return
      const productId = this.product.id
      if (silent !== true) this.integrationsLoading = true
      this.integrationsError = null
      try {
        const response = await $fetch(`/api/marketing/projects/${productId}/overview`)
        if (this.product?.id !== productId) return
        this.integrations = response?.data?.integrations || []
      } catch (err) {
        if (this.product?.id !== productId) return
        this.integrationsError = apiErrorMessage(err, 'Failed to load integration status')
      } finally {
        if (this.product?.id === productId) this.integrationsLoading = false
      }
    },
  },
}
</script>
