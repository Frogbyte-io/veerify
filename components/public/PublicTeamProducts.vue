<template>
  <div class="min-h-screen bg-background">
    <div v-if="isLoading" class="max-w-3xl mx-auto px-4 py-12 space-y-4">
      <Skeleton class="h-10 w-48" />
      <Skeleton class="h-5 w-64" />
      <div class="grid gap-4 mt-8">
        <Skeleton v-for="n in 3" :key="n" class="h-24" />
      </div>
    </div>

    <div v-else-if="error" class="max-w-3xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">Team Not Found</h1>
      <p class="text-muted-foreground">{{ error }}</p>
    </div>

    <div v-else-if="teamData" class="max-w-3xl mx-auto px-4 py-8">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">{{ teamData.team.name }}</h1>
        <p class="text-muted-foreground">Public feedback boards</p>
      </div>

      <div v-if="teamData.projects.length === 0" class="rounded-lg border bg-card p-12 text-center">
        <Icon name="lucide:package-open" class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 class="text-lg font-semibold mb-2">No public products yet</h2>
        <p class="text-muted-foreground">This team hasn't published any feedback boards yet.</p>
      </div>

      <div v-else class="grid gap-4">
        <NuxtLink
          v-for="product in teamData.projects"
          :key="product.id"
          :to="`/${product.slug}`"
          class="block rounded-lg border bg-card p-6 hover:shadow-sm transition-shadow"
        >
          <div class="flex items-start gap-4">
            <div class="flex size-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
              <Icon name="lucide:message-square" class="w-5 h-5 text-primary" />
            </div>
            <div class="min-w-0">
              <h2 class="font-semibold text-lg">{{ product.name }}</h2>
              <p v-if="product.description" class="text-sm text-muted-foreground mt-1 line-clamp-2">
                {{ product.description }}
              </p>
            </div>
            <Icon name="lucide:arrow-right" class="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
          </div>
        </NuxtLink>
      </div>

      <div class="mt-12 pt-6 border-t text-center text-sm text-muted-foreground">
        Powered by <span class="font-medium">Veerify</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'PublicTeamProducts',
  props: {
    teamSlug: { type: String, required: true },
  },
  data() {
    return {
      teamData: null,
      isLoading: true,
      error: null,
    }
  },
  async mounted() {
    try {
      const response = await $fetch(`/api/public/t/${this.teamSlug}`)
      this.teamData = response?.data
    } catch (err) {
      console.error('Error loading team:', err)
      this.error = 'This team could not be found.'
    } finally {
      this.isLoading = false
    }
  },
}
</script>
