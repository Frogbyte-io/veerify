<template>
  <div>
    <PublicProjectSite
      v-if="publicOrgSlug && projectSlug && subPage !== 'not-found'"
      :org-slug="publicOrgSlug"
      :project-slug="projectSlug"
      :active-tab="subPage || 'feedback'"
      :product-slug="productSlug"
      :entry-slug="entrySlug"
    />
    <NuxtLayout v-else name="clean">
      <div class="min-h-screen flex items-center justify-center bg-background">
        <div class="text-center">
          <Icon name="lucide:file-question" class="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h1 class="text-3xl font-bold text-foreground mb-2">404</h1>
          <p class="text-muted-foreground mb-6">Page not found</p>
          <NuxtLink to="/" class="text-primary hover:underline">Go home</NuxtLink>
        </div>
      </div>
    </NuxtLayout>
  </div>
</template>

<script>
// Project-wide sub-pages of the public site. Product slugs can never be one of
// these (reserved when a product is created).
//   org subdomain:  /<project>[/<product> | /roadmap | /changelog[/<entry>] | /testimonials]
//   custom domain:  /[<product> | /roadmap | /changelog[/<entry>] | /testimonials]
const SUB_PAGES = ['roadmap', 'changelog', 'testimonials']

export default {
  name: 'CatchAllPage',
  computed: {
    publicOrgSlug() {
      return useState('publicOrgSlug').value
    },
    publicProjectSlug() {
      return useState('publicProjectSlug').value
    },
    slugParts() {
      const params = useRoute().params.slug
      return Array.isArray(params) ? params : params ? [params] : []
    },
    projectSlug() {
      return this.publicProjectSlug || this.slugParts[0] || null
    },
    // Segments after the project (a custom domain has no project segment)
    restParts() {
      return this.publicProjectSlug ? this.slugParts : this.slugParts.slice(1)
    },
    subPage() {
      const first = this.restParts[0] || null
      if (SUB_PAGES.includes(first)) return first
      // Any other first segment is a product board; more segments are a 404
      if (first && this.restParts.length > 1) return 'not-found'
      return null
    },
    productSlug() {
      const first = this.restParts[0] || null
      return first && !SUB_PAGES.includes(first) ? first : null
    },
    // `changelog/<entrySlug>` permalink segment, when present
    entrySlug() {
      return this.subPage === 'changelog' ? this.restParts[1] || null : null
    },
  },
}
</script>
