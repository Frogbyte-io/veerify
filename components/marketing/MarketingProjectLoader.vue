<template>
  <div data-testid="marketing-project-loader">
    <div v-if="error" class="flex items-center gap-2 text-sm text-destructive">
      <span>Failed to load the project</span>
      <Button variant="outline" size="sm" @click="load">Retry</Button>
    </div>
  </div>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'
import { cachedActiveProject, loadActiveProject } from '~/lib/active-project'

/**
 * Loads the active project for the marketing pages (marketing belongs to the
 * active project, there is nothing to pick). Emits `change` with the project
 * (id, slug, name, role, settings, isPublic, organization, products, modules),
 * or null when the user has no project yet, once after the initial load and
 * again whenever the active project is switched. Emits `error` when loading
 * fails; renders a Retry button in that case and nothing otherwise.
 */
export default {
  name: 'MarketingProjectLoader',

  emits: ['change', 'error'],

  data() {
    return {
      error: null,
      lastEmitted: null,
    }
  },

  async mounted() {
    if (import.meta.client) {
      window.addEventListener('veerify:active-project-changed', this.load)
    }
    await this.load()
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener('veerify:active-project-changed', this.load)
    }
  },

  methods: {
    toProject(context) {
      if (!context?.project) return null
      return {
        ...context.project,
        organization: context.organization,
        products: context.products,
        modules: context.modules,
      }
    },
    emitIfChanged(context) {
      const project = this.toProject(context)
      const key = JSON.stringify(project)
      if (key === this.lastEmitted) return
      this.lastEmitted = key
      this.$emit('change', project)
    },
    async load(event) {
      this.error = null
      // Render from the shared cache at once; the request below only revalidates it.
      const cached = cachedActiveProject()
      if (cached !== undefined && !event) this.emitIfChanged(cached)
      try {
        this.emitIfChanged(await loadActiveProject({ force: Boolean(event) }))
      } catch (err) {
        if (cached !== undefined && !event) return
        this.error = apiErrorMessage(err, 'Failed to load the project')
        this.$emit('error', this.error)
      }
    },
  },
}
</script>
