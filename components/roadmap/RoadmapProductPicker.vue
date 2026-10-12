<template>
  <div data-testid="roadmap-product-picker">
    <Skeleton v-if="isLoading" class="h-9 w-48" />

    <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
      <span>Failed to load products</span>
      <Button variant="outline" size="sm" @click="load">Retry</Button>
    </div>

    <DropdownMenu v-else-if="products.length > 0">
      <DropdownMenuTrigger as-child>
        <Button variant="outline" class="gap-2" data-testid="roadmap-product-picker-trigger">
          <Icon name="lucide:package" class="w-4 h-4" />
          <span class="max-w-48 truncate">{{ selected?.name || 'Select product' }}</span>
          <Icon name="lucide:chevrons-up-down" class="w-4 h-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-64">
        <DropdownMenuItem
          v-for="product in products"
          :key="product.id"
          :data-testid="`roadmap-product-picker-item-${product.slug}`"
          @select="select(product)"
        >
          <span class="flex-1 truncate">{{ product.name }}</span>
          <span v-if="!isRoadmapOn(product)" class="text-xs text-muted-foreground">Off</span>
          <Icon v-if="product.id === selected?.id" name="lucide:check" class="w-4 h-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'
import { resolveProductModules } from '~/lib/modules'

const STORAGE_KEY = 'veerify_roadmap_product'

/**
 * Product picker for the roadmap pages. The selection lives in the
 * `?product=<slug>` query (shareable links) and is remembered in localStorage.
 *
 * Emits `change` with (product | null, teamSlug), including once after the
 * initial load, and `error` when products fail to load. Products with the
 * roadmap switched off are listed and marked "Off".
 */
export default {
  name: 'RoadmapProductPicker',

  emits: ['change', 'error'],

  data() {
    return {
      products: [],
      selected: null,
      teamSlug: '',
      isLoading: true,
      error: null,
    }
  },

  async mounted() {
    if (import.meta.client) {
      window.addEventListener('veerify:active-team-changed', this.load)
    }
    await this.load()
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener('veerify:active-team-changed', this.load)
    }
  },

  methods: {
    isRoadmapOn(product) {
      return resolveProductModules(product.settings).roadmapEnabled === true
    },

    async load() {
      this.isLoading = true
      this.error = null
      try {
        const activeTeam = await $fetch('/api/teams/active')
        const teamId = activeTeam?.data?.id
        this.teamSlug = activeTeam?.data?.slug || ''
        if (!teamId) {
          this.products = []
          this.applySelection(null)
          return
        }
        const response = await $fetch(`/api/teams/${teamId}/projects`)
        this.products = response?.data || []

        const wanted = this.$route.query.product || this.readStoredSlug()
        const match =
          this.products.find((product) => product.slug === wanted) ||
          this.products.find((product) => this.isRoadmapOn(product)) ||
          this.products[0] ||
          null
        this.applySelection(match)
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load products')
        this.$emit('error', this.error)
      } finally {
        this.isLoading = false
      }
    },

    select(product) {
      if (product.id === this.selected?.id) return
      this.applySelection(product)
    },

    applySelection(product) {
      this.selected = product
      if (product) {
        this.storeSlug(product.slug)
        if (this.$route.query.product !== product.slug) {
          this.$router.replace({ query: { ...this.$route.query, product: product.slug } })
        }
      }
      this.$emit('change', product, this.teamSlug)
    },

    readStoredSlug() {
      if (!import.meta.client) return null
      try {
        return localStorage.getItem(STORAGE_KEY)
      } catch {
        return null
      }
    },

    storeSlug(slug) {
      if (!import.meta.client) return
      try {
        localStorage.setItem(STORAGE_KEY, slug)
      } catch {
        // Ignore storage failures.
      }
    },
  },
}
</script>
