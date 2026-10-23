<template>
  <div class="min-h-screen bg-background flex flex-col">
    <div v-if="isLoading" class="max-w-3xl mx-auto px-4 py-12 space-y-4">
      <Skeleton class="h-10 w-48" />
      <Skeleton class="h-5 w-64" />
      <div class="grid gap-4 mt-8">
        <Skeleton v-for="n in 3" :key="n" class="h-24" />
      </div>
    </div>

    <div v-else-if="error" class="max-w-3xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">Page Not Found</h1>
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <button class="text-sm text-primary hover:underline" @click="load">Try again</button>
    </div>

    <div v-else-if="orgData" class="flex-1 flex flex-col max-w-3xl mx-auto px-4 py-8 w-full">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">{{ orgData.organization.name }}</h1>
        <p class="text-muted-foreground">Public feedback boards</p>
      </div>

      <div v-if="orgData.projects.length === 0" class="rounded-lg border bg-card p-12 text-center">
        <Icon name="lucide:package-open" class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 class="text-lg font-semibold mb-2">No public projects yet</h2>
        <p class="text-muted-foreground">Nothing has been published here yet.</p>
      </div>

      <div v-else class="grid gap-4">
        <NuxtLink
          v-for="project in orgData.projects"
          :key="project.id"
          :to="`/${project.slug}`"
          prefetch-on="interaction"
          class="block rounded-lg border bg-card p-6 hover:shadow-sm transition-shadow"
        >
          <div class="flex items-start gap-4">
            <div class="flex size-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
              <Icon name="lucide:message-square" class="w-5 h-5 text-primary" />
            </div>
            <div class="min-w-0">
              <h2 class="font-semibold text-lg">{{ project.name }}</h2>
              <p v-if="project.description" class="text-sm text-muted-foreground mt-1 line-clamp-2">
                {{ project.description }}
              </p>
            </div>
            <Icon name="lucide:arrow-right" class="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
          </div>
        </NuxtLink>
      </div>

      <div class="mt-auto py-3 text-center text-xs text-muted-foreground">
        Powered by
        <a href="https://veerify.io" target="_blank" rel="noopener noreferrer" class="hover:underline">Veerify</a>
      </div>
    </div>
  </div>
</template>

<script>
/** Landing page of a workspace's public subdomain: lists its public projects. */
export default {
  name: 'PublicOrgProjects',
  props: {
    orgSlug: { type: String, required: true },
  },
  data() {
    return {
      orgData: null,
      isLoading: true,
      error: null,
    }
  },
  async mounted() {
    await this.load()
  },
  methods: {
    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(`/api/public/o/${encodeURIComponent(this.orgSlug)}`)
        this.orgData = response?.data
      } catch (err) {
        console.error('Error loading workspace:', err)
        this.error = 'This page could not be found.'
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
