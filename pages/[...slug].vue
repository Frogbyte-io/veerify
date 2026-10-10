<template>
  <div>
    <PublicRoadmap
      v-if="teamSubdomain && projectSlug && subPage === 'roadmap'"
      :team-slug="teamSubdomain"
      :project-slug="projectSlug"
    />
    <PublicChangelog
      v-else-if="teamSubdomain && projectSlug && subPage === 'changelog'"
      :team-slug="teamSubdomain"
      :project-slug="projectSlug"
      :entry-slug="entrySlug"
    />
    <PublicTestimonials
      v-else-if="teamSubdomain && projectSlug && subPage === 'testimonials'"
      :team-slug="teamSubdomain"
      :project-slug="projectSlug"
    />
    <PublicFeedbackBoard
      v-else-if="teamSubdomain && projectSlug"
      :team-slug="teamSubdomain"
      :project-slug="projectSlug"
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
// Sub-pages of a product's public site. On a custom domain they are addressed
// without the product slug (`/changelog`), on a team subdomain with it
// (`/<product>/changelog`).
const SUB_PAGES = ['roadmap', 'changelog', 'testimonials']

export default {
  name: 'CatchAllPage',
  computed: {
    teamSubdomain() {
      return useState('teamSubdomain').value
    },
    publicProjectSlug() {
      return useState('publicProjectSlug').value
    },
    slugParts() {
      const params = useRoute().params.slug
      return Array.isArray(params) ? params : params ? [params] : []
    },
    projectSlug() {
      if (!this.publicProjectSlug) {
        return this.slugParts[0] || null
      }

      const firstSegment = this.slugParts[0] || null
      if (!firstSegment || SUB_PAGES.includes(firstSegment) || firstSegment === this.publicProjectSlug) {
        return this.publicProjectSlug
      }

      return null
    },
    subPage() {
      if (!this.publicProjectSlug) {
        return this.slugParts[1] || null
      }

      const firstSegment = this.slugParts[0] || null
      if (SUB_PAGES.includes(firstSegment)) return firstSegment
      if (firstSegment === this.publicProjectSlug) {
        return this.slugParts[1] || null
      }

      return null
    },
    // `changelog/<entrySlug>` permalink segment, when present
    entrySlug() {
      if (this.subPage !== 'changelog') return null
      const parts = this.slugParts
      const index = this.publicProjectSlug && parts[0] !== this.publicProjectSlug ? 1 : 2
      return parts[index] || null
    },
  },
}
</script>
