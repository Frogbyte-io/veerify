<template>
  <div data-testid="roadmap-product-picker">
    <Skeleton v-if="isLoading" class="h-9 w-48" />

    <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
      <span>{{ error }}</span>
      <Button variant="outline" size="sm" @click="load">Retry</Button>
    </div>

    <div v-else-if="products.length > 1" class="flex flex-wrap items-center gap-2" data-testid="roadmap-product-chips">
      <button type="button" :class="chipClass(!selectedId)" data-testid="roadmap-product-chip-all" @click="select('')">
        All products
      </button>
      <button
        v-for="product in products"
        :key="product.id"
        type="button"
        :class="chipClass(selectedId === product.id)"
        :data-testid="`roadmap-product-chip-${product.slug}`"
        @click="select(product.id)"
      >
        {{ product.name }}
      </button>
    </div>
  </div>
</template>

<script>
import { cn } from '~/lib/utils'
import { apiErrorMessage } from '~/lib/api-error'

/**
 * Product filter for the roadmap. The roadmap is project-wide, so this loads
 * the active project and only renders chips ("All products" + one per product)
 * when the project has more than one product. The selection lives in the
 * `?productId=<id>` query.
 *
 * Emits `change` with (activeProjectContext, productId) once after every
 * (re)load of the active project and whenever a chip is picked. `productId`
 * is '' for "All products".
 */
export default {
  name: 'RoadmapProductPicker',

  emits: ['change', 'error'],

  data() {
    return {
      context: null,
      selectedId: '',
      isLoading: true,
      error: null,
    }
  },

  computed: {
    products() {
      return this.context?.products || []
    },
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
    chipClass(active) {
      return cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-accent'
      )
    },

    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch('/api/projects/active')
        this.context = response?.data || null
        const wanted = this.$route.query.productId
        const match = this.products.length > 1 ? this.products.find((product) => product.id === wanted) : null
        this.selectedId = match ? match.id : ''
        this.$emit('change', this.context, this.selectedId)
      } catch (err) {
        this.context = null
        this.error = apiErrorMessage(err, 'Failed to load the active project')
        this.$emit('error', this.error)
      } finally {
        this.isLoading = false
      }
    },

    select(productId) {
      if (productId === this.selectedId) return
      this.selectedId = productId
      const query = { ...this.$route.query }
      if (productId) query.productId = productId
      else delete query.productId
      this.$router.replace({ query })
      this.$emit('change', this.context, productId)
    },
  },
}
</script>
