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
    <PublicOrgProjects v-else-if="publicOrgSlug && isRoot" :org-slug="publicOrgSlug" />
    <!-- App root on the dashboard host: a splash while the session decides /dashboard or /login -->
    <NuxtLayout v-else-if="isRoot" name="clean">
      <div class="min-h-screen flex items-center justify-center bg-background">
        <div class="text-center">
          <Icon name="lucide:zap" class="mx-auto h-16 w-16 text-primary mb-4" />
          <h1 class="text-2xl font-bold text-foreground mb-2">Veerify</h1>
          <p class="text-muted-foreground mb-8">Feedback collection and management</p>
          <Skeleton class="h-4 w-32 mx-auto" />
        </div>
      </div>
    </NuxtLayout>
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
import { authClient } from '~/lib/auth-client'

// This page also serves `/` (there is no pages/index.vue), so on a custom domain the public
// site's root and its tabs are one mounted page and switching between them never remounts it.
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
    isRoot() {
      return this.slugParts.length === 0
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
  async mounted() {
    if (import.meta.client && this.isRoot && !this.publicOrgSlug) {
      try {
        const { data: session } = await authClient.useSession(useFetch)
        await navigateTo(session.value?.user ? '/dashboard' : '/login')
      } catch (error) {
        console.error('Auth check error:', error)
        await navigateTo('/login')
      }
    }
  },
}
</script>
