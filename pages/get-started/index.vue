<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-md">
        <!-- Loading while checking auth -->
        <div v-if="isChecking" class="flex justify-center">
          <Icon name="lucide:loader-2" class="w-8 h-8 animate-spin text-muted-foreground" />
        </div>

        <!-- Unauthenticated: show CTA -->
        <Card v-else>
          <CardHeader class="text-center">
            <div class="flex justify-center mb-4">
              <div class="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10">
                <Icon name="lucide:building-2" class="w-7 h-7 text-primary" />
              </div>
            </div>
            <CardTitle class="text-2xl">Start collecting feedback</CardTitle>
            <CardDescription class="text-base">
              Create a workspace to set up feedback boards, manage projects, and collaborate with your team.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
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
                <p class="text-sm">Team collaboration and project management</p>
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
          </CardContent>
        </Card>
      </div>
    </div>
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
