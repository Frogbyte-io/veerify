<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-sm">
        <div class="flex flex-col gap-6">
          <Card>
            <CardHeader class="text-center">
              <CardTitle class="text-xl"> Welcome back </CardTitle>
              <CardDescription> Sign in to your account to continue </CardDescription>
            </CardHeader>
            <CardContent>
              <form @submit.prevent="handleSubmit">
                <div class="grid gap-6">
                  <!-- Social Sign In Buttons -->
                  <div class="flex flex-col gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      class="w-full"
                      :disabled="isLoading"
                      @click="handleGitHubSignIn"
                    >
                      <Icon name="lucide:github" class="w-4 h-4 mr-2" />
                      Continue with GitHub
                    </Button>
                  </div>

                  <!-- Divider -->
                  <div
                    class="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t"
                  >
                    <span class="bg-card text-muted-foreground relative z-10 px-2"> Or continue with email </span>
                  </div>

                  <!-- Email/Password Form -->
                  <div class="grid gap-6">
                    <div class="grid gap-3">
                      <Label for="email">Email</Label>
                      <Input
                        id="email"
                        data-testid="login-email"
                        v-model="email"
                        type="email"
                        placeholder="m@example.com"
                        required
                        :disabled="isLoading"
                      />
                    </div>
                    <div class="grid gap-3">
                      <div class="flex items-center">
                        <Label for="password">Password</Label>
                        <NuxtLink to="/forgot-password" class="ml-auto text-sm underline-offset-4 hover:underline">
                          Forgot your password?
                        </NuxtLink>
                      </div>
                      <Input
                        id="password"
                        data-testid="login-password"
                        v-model="password"
                        type="password"
                        required
                        :disabled="isLoading"
                      />
                    </div>
                    <Button data-testid="login-submit" type="submit" class="w-full" :disabled="isLoading">
                      {{ isLoading ? 'Signing in...' : 'Sign in' }}
                    </Button>
                  </div>

                  <!-- Sign Up Link -->
                  <div class="text-center text-sm">
                    Don't have an account?
                    <NuxtLink :to="signupLink" class="underline underline-offset-4"> Sign up </NuxtLink>
                  </div>
                </div>
              </form>

              <!-- Error Message -->
              <div
                v-if="error"
                data-testid="login-error"
                class="mt-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm"
              >
                {{ error }}
              </div>
            </CardContent>
          </Card>
          <div class="text-muted-foreground text-center text-xs text-balance">
            By clicking continue, you agree to our
            <NuxtLink to="/terms" class="underline underline-offset-4 hover:text-primary">Terms of Service</NuxtLink>
            and
            <NuxtLink to="/privacy" class="underline underline-offset-4 hover:text-primary">Privacy Policy</NuxtLink>.
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'LoginPage',
  data() {
    return {
      email: '',
      password: '',
      isLoading: false,
      error: '',
    }
  },
  computed: {
    signupLink() {
      const redirect = this.$route.query.redirect
      return redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : '/signup'
    },
  },
  methods: {
    async handleSubmit() {
      if (!this.email || !this.password) {
        this.error = 'Please enter both email and password'
        return
      }

      this.isLoading = true
      this.error = ''

      try {
        const result = await authClient.signIn.email({
          email: this.email,
          password: this.password,
        })

        if (result.error) {
          this.error = result.error.message || 'Sign in failed'
        } else {
          const redirect = this.$route.query.redirect
          await navigateTo(redirect && typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/dashboard')
        }
      } catch (err) {
        this.error = 'An unexpected error occurred'
        console.error('Sign in error:', err)
      } finally {
        this.isLoading = false
      }
    },

    async handleGitHubSignIn() {
      this.isLoading = true
      this.error = ''

      try {
        await authClient.signIn.social({
          provider: 'github',
        })
      } catch (err) {
        this.error = 'GitHub sign in failed'
        console.error('GitHub sign in error:', err)
        this.isLoading = false
      }
    },
  },
}
</script>
