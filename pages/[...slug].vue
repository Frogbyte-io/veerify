<template>
  <div>
    <PublicFeedbackBoard v-if="teamSubdomain && slug" :team-slug="teamSubdomain" :project-slug="slug" />
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
export default {
  name: 'CatchAllPage',
  computed: {
    teamSubdomain() {
      return useState('teamSubdomain').value
    },
    slug() {
      const params = useRoute().params.slug
      return Array.isArray(params) ? params[0] : params
    },
  },
}
</script>
