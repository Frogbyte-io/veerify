<template>
  <div data-testid="marketing-project-loader">
    <div v-if="error" class="flex items-center gap-2 text-sm text-destructive">
      <span>Failed to load the project</span>
      <Button variant="outline" size="sm" @click="load">Retry</Button>
    </div>
  </div>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

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
    async load() {
      this.error = null
      try {
        const response = await $fetch('/api/projects/active')
        const context = response?.data
        if (!context?.project) {
          this.$emit('change', null)
          return
        }
        this.$emit('change', {
          ...context.project,
          organization: context.organization,
          products: context.products,
          modules: context.modules,
        })
      } catch (err) {
        if (apiErrorStatus(err) === 409) {
          this.$emit('change', null)
          return
        }
        this.error = apiErrorMessage(err, 'Failed to load the project')
        this.$emit('error', this.error)
      }
    },
  },
}
</script>
