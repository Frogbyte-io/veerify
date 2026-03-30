<template>
  <div>
    <PublicFeedbackBoard
      v-if="teamSubdomain && publicProjectSlug"
      :team-slug="teamSubdomain"
      :project-slug="publicProjectSlug"
    />
    <PublicTeamProducts v-else-if="teamSubdomain" :team-slug="teamSubdomain" />
    <NuxtLayout v-else name="clean">
      <div class="min-h-screen flex items-center justify-center bg-background">
        <div class="text-center">
          <Icon name="lucide:zap" class="mx-auto h-16 w-16 text-primary mb-4" />
          <h1 class="text-2xl font-bold text-foreground mb-2">Veerify</h1>
          <p class="text-muted-foreground mb-8">Feedback collection and management</p>
          <Skeleton class="h-4 w-32 mx-auto" />
        </div>
      </div>
    </NuxtLayout>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'IndexPage',
  computed: {
    teamSubdomain() {
      return useState('teamSubdomain').value
    },
    publicProjectSlug() {
      return useState('publicProjectSlug').value
    },
  },
  async mounted() {
    if (import.meta.client && !this.teamSubdomain) {
      try {
        const { data: session } = await authClient.useSession(useFetch)

        if (session.value?.user) {
          await navigateTo('/dashboard')
        } else {
          await navigateTo('/login')
        }
      } catch (error) {
        console.error('Auth check error:', error)
        await navigateTo('/login')
      }
    }
  },
}
</script>
