<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-3xl mx-auto space-y-6" data-testid="changelog-entry-page">
      <div class="flex items-center gap-3">
        <Button as-child variant="ghost" size="sm">
          <NuxtLink :to="backLink">
            <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
            Changelog
          </NuxtLink>
        </Button>
        <h1 class="text-2xl font-bold tracking-tight text-foreground">
          {{ entryId === 'new' ? 'New entry' : 'Edit entry' }}
        </h1>
      </div>

      <Skeleton v-if="isLoading" class="h-64 w-full" />

      <Card v-else-if="error">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">{{ error }}</p>
          <Button variant="outline" @click="loadProduct">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <ChangelogEntryEditor v-else-if="product" :project="product" :team-slug="teamSlug" :entry-id="entryId" />
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'

export default {
  name: 'ChangelogEntryPage',

  data() {
    return { isLoading: true, error: null, product: null, teamSlug: '' }
  },

  computed: {
    entryId() {
      return String(this.$route.params.entryId)
    },
    productSlug() {
      return String(this.$route.query.product || '')
    },
    backLink() {
      return this.productSlug ? `/changelog?product=${encodeURIComponent(this.productSlug)}` : '/changelog'
    },
  },

  async mounted() {
    await this.loadProduct()
  },

  methods: {
    async loadProduct() {
      this.isLoading = true
      this.error = null
      try {
        const activeTeam = await $fetch('/api/teams/active')
        const teamId = activeTeam?.data?.id
        this.teamSlug = activeTeam?.data?.slug || ''
        const response = teamId ? await $fetch(`/api/teams/${teamId}/projects`) : null
        const products = response?.data || []
        this.product = products.find((p) => p.slug === this.productSlug) || null
        if (!this.product) this.error = 'Product not found. Pick a product from the changelog list.'
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load the product')
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
