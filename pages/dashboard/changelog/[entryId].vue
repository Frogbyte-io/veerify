<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-3xl mx-auto space-y-6" data-testid="changelog-entry-page">
      <div class="flex items-center gap-3">
        <Button as-child variant="ghost" size="sm">
          <NuxtLink to="/dashboard/changelog">
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
          <Button variant="outline" @click="loadProject">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <ChangelogEntryEditor
        v-else-if="project"
        :project="project"
        :org-slug="orgSlug"
        :products="products"
        :initial-product-id="initialProductId"
        :entry-id="entryId"
      />
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'

export default {
  name: 'ChangelogEntryPage',

  created() {
    useHead({ title: 'Changelog entry' })
  },

  data() {
    return { isLoading: true, error: null, project: null, products: [], orgSlug: '' }
  },

  computed: {
    entryId() {
      return String(this.$route.params.entryId)
    },
    // Pre-selected product tag for a new entry (the list's current filter)
    initialProductId() {
      return this.entryId === 'new' ? String(this.$route.query.productId || '') : ''
    },
  },

  async mounted() {
    if (import.meta.client) window.addEventListener('veerify:active-project-changed', this.onProjectChanged)
    await this.loadProject()
  },

  beforeUnmount() {
    if (import.meta.client) window.removeEventListener('veerify:active-project-changed', this.onProjectChanged)
  },

  methods: {
    // An entry belongs to one project: after a switch go back to that project's list
    async onProjectChanged() {
      await navigateTo('/dashboard/changelog')
    },

    async loadProject() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch('/api/projects/active')
        const context = response?.data
        this.project = context?.project || null
        this.products = context?.products || []
        this.orgSlug = context?.organization?.slug || ''
        if (!this.project) this.error = 'No active project found.'
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load the active project')
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
