<template>
  <PageContainer width="narrow" data-testid="changelog-entry-page">
    <PageHeader
      :title="entryId === 'new' ? 'New entry' : 'Edit entry'"
      back-to="/dashboard/changelog"
      back-label="Changelog"
    />

    <div v-if="scopeProject && !isLoading && !error" class="-mt-2 mb-4" data-testid="changelog-entry-project">
      <ProjectTag :project="scopeProject" />
    </div>

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
      :key="project.id"
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
import { findScopeProject, isAllProjects } from '~/lib/project-scope'

export default {
  name: 'ChangelogEntryPage',

  created() {
    useHead({ title: 'Changelog entry' })
  },

  data() {
    // An entry of another project (`?project=`) can't render from the cached active project
    const cached = cachedActiveProject()
    // (computed properties are not available inside data())
    const wanted = typeof this.$route.query.project === 'string' ? this.$route.query.project : ''
    const usable = cached?.project && (!wanted || wanted === cached.project.id)
    return {
      isLoading: !usable,
      error: null,
      context: cached || null,
      project: usable ? cached.project : null,
      products: usable ? cached.products || [] : [],
      orgSlug: cached?.organization?.slug || '',
    }
  },

  computed: {
    // Entries of any project in scope open here: the list links with `?project=<id>`
    wantedProjectId() {
      const value = this.$route.query.project
      return typeof value === 'string' ? value : ''
    },
    // Named only while working in All projects, where the project isn't implied
    scopeProject() {
      if (!isAllProjects(this.context) || !this.project) return null
      return findScopeProject(this.context, this.project.id)
    },
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

    // The entry's project is not the active one: take it from the projects the user can open
    async loadOtherProject(context) {
      const scopeProject = findScopeProject(context, this.wantedProjectId)
      if (!scopeProject) {
        this.project = null
        this.error = 'You cannot open the project of this entry.'
        return
      }
      const response = await $fetch(`/api/projects/${scopeProject.slug}`)
      this.project = response?.data || null
      this.products = response?.data?.products || []
      if (!this.project) this.error = 'No project found for this entry.'
    },

    async loadProject() {
      if (!this.project) this.isLoading = true
      this.error = null
      try {
        const context = await loadActiveProject()
        this.context = context
        this.orgSlug = context?.organization?.slug || ''
        if (this.wantedProjectId && context?.project && this.wantedProjectId !== context.project.id) {
          await this.loadOtherProject(context)
        } else {
          this.project = context?.project || null
          this.products = context?.products || []
          if (!this.project) this.error = 'No active project found.'
        }
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load the active project')
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
