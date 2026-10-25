<template>
  <div v-if="products.length > 1" class="flex flex-wrap items-center gap-2 mb-6" data-testid="public-product-filter">
    <NuxtLink
      :to="{ path: basePath }"
      :class="chipClass(!selected)"
      :style="!selected ? activeStyle : {}"
      data-testid="public-product-filter-all"
    >
      All products
    </NuxtLink>
    <NuxtLink
      v-for="product in products"
      :key="product.id"
      :to="{ path: basePath, query: { product: product.slug } }"
      :class="chipClass(selected === product.slug)"
      :style="selected === product.slug ? activeStyle : {}"
    >
      {{ product.name }}
    </NuxtLink>
  </div>
</template>

<script>
/**
 * Product filter chips for the project-wide public roadmap and changelog.
 * Renders nothing unless the project has more than one public product.
 * Selection lives in the URL (`?product=<slug>`), so the parent just reads
 * `$route.query.product`.
 */
export default {
  name: 'PublicProductFilter',
  props: {
    products: { type: Array, default: () => [] },
    selected: { type: String, default: '' },
    basePath: { type: String, required: true },
    accentColor: { type: String, default: '#6366f1' },
  },
  computed: {
    activeStyle() {
      return { backgroundColor: this.accentColor, borderColor: this.accentColor, color: '#fff' }
    },
  },
  methods: {
    chipClass(active) {
      return [
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active ? '' : 'text-muted-foreground hover:bg-accent',
      ]
    },
  },
}
</script>
