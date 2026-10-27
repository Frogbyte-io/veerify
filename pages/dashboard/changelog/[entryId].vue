<template>
  <PageContainer width="narrow" data-testid="changelog-entry-page">
    <PageHeader
      :title="entryId === 'new' ? 'New entry' : 'Edit entry'"
      back-to="/dashboard/changelog"
      back-label="Changelog"
    />

    <ChangelogEditorSkeleton v-if="isLoading" />

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
  </PageContainer>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'
import { cachedActiveProject, loadActiveProject } from '~/lib/active-project'

export default {
  name: 'ChangelogEntryPage',

  created() {
    useHead({ title: 'Changelog entry' })
  },

  data() {
    const cached = cachedActiveProject()
    return {
      isLoading: !cached?.project,
      error: null,
      project: cached?.project || null,
      products: cached?.products || [],
      orgSlug: cached?.organization?.slug || '',
    }
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
      if (!this.project) this.isLoading = true
      this.error = null
      try {
        const context = await loadActiveProject()
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
