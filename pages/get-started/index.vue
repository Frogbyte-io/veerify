<template>
  <NuxtLayout name="clean">
    <AuthCard
      wide
      title="Start collecting feedback"
      description="Create a workspace to set up feedback boards, manage projects, and collaborate with your colleagues."
    >
      <!-- Loading while checking auth -->
      <div v-if="isChecking" class="space-y-4" data-testid="get-started-loading">
        <Skeleton class="h-5 w-3/4 mx-auto" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-10 w-full" />
      </div>

      <!-- Unauthenticated: show CTA -->
      <div v-else class="space-y-4">
        <div class="grid gap-3 rounded-lg border p-4">
          <div class="flex items-start gap-3">
            <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <p class="text-sm">Public feedback boards for your users</p>
          </div>
          <div class="flex items-start gap-3">
            <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <p class="text-sm">Upvoting and prioritization</p>
          </div>
          <div class="flex items-start gap-3">
            <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <p class="text-sm">Projects for each of your brands, shared with your colleagues</p>
          </div>
        </div>

        <Button class="w-full" size="lg" @click="goToSignUp">
          Create your workspace
          <Icon name="lucide:arrow-right" class="w-4 h-4 ml-2" />
        </Button>

        <p class="text-center text-sm text-muted-foreground">
          Already have an account?
          <NuxtLink :to="loginUrl" class="text-primary underline underline-offset-4 hover:text-primary/80">
            Sign in
          </NuxtLink>
        </p>
      </div>
    </AuthCard>
  </NuxtLayout>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'GetStartedPage',
  layout: 'clean',

  data() {
    return {
      isChecking: true,
    }
  },

  computed: {
    loginUrl() {
      return '/login?redirect=/onboarding'
    },
  },

  async mounted() {
    await this.checkAuth()
  },

  methods: {
    async checkAuth() {
      try {
        const { data: session } = await authClient.useSession(useFetch)
        if (session.value?.user) {
          // Already logged in, go straight to onboarding
          await navigateTo('/onboarding')
          return
        }
      } catch (_error) {
        // If check fails, show the page
      } finally {
        this.isChecking = false
      }
    },

    goToSignUp() {
      navigateTo('/signup?redirect=/onboarding')
    },
  },
}
</script>
