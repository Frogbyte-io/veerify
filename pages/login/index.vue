<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-sm">
        <div class="flex flex-col gap-6">
          <!-- Brand -->
          <div class="flex flex-col items-center gap-2">
            <div class="flex items-center gap-2.5">
              <div class="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                <Icon name="lucide:check-check" class="h-5 w-5 text-primary-foreground" />
              </div>
              <span class="text-2xl font-display font-semibold tracking-tight">Veerify</span>
            </div>
          </div>

          <Card>
            <CardHeader class="text-center">
              <CardTitle class="text-xl font-display"> Welcome back </CardTitle>
              <CardDescription> Sign in to your account to continue </CardDescription>
            </CardHeader>
            <CardContent>
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

                <!-- Login Method Toggle -->
                <div class="flex rounded-lg border border-border p-1">
                  <button
                    type="button"
                    class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                    :class="
                      loginMethod === 'password'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="loginMethod = 'password'"
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                    :class="
                      loginMethod === 'magic-link'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="loginMethod = 'magic-link'"
                  >
                    Magic Link
                  </button>
                </div>

                <!-- Password Form -->
                <form v-if="loginMethod === 'password'" @submit.prevent="handleSubmit">
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
                        :disabled="isLoading || !isHydrated"
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
                        :disabled="isLoading || !isHydrated"
                      />
                    </div>
                    <Button
                      data-testid="login-submit"
                      type="submit"
                      class="w-full"
                      :disabled="isLoading || !isHydrated"
                    >
                      {{ isLoading ? 'Signing in...' : 'Sign in' }}
                    </Button>
                  </div>
                </form>

                <!-- Magic Link Form -->
                <form v-else @submit.prevent="handleMagicLink">
                  <div class="grid gap-6">
                    <div v-if="magicLinkSent" class="rounded-md border border-border bg-muted/50 p-4 text-center">
                      <Icon name="lucide:mail-check" class="mx-auto mb-2 h-8 w-8 text-primary" />
                      <p class="text-sm font-medium">Check your email</p>
                      <p class="mt-1 text-xs text-muted-foreground">
                        We sent a sign-in link to <strong>{{ email }}</strong
                        >. Click the link in the email to sign in.
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="mt-3"
                        :disabled="isLoading"
                        @click="magicLinkSent = false"
                      >
                        Use a different email
                      </Button>
                    </div>
                    <template v-else>
                      <div class="grid gap-3">
                        <Label for="magic-email">Email</Label>
                        <Input
                          id="magic-email"
                          v-model="email"
                          type="email"
                          placeholder="m@example.com"
                          required
                          :disabled="isLoading || !isHydrated"
                        />
                      </div>
                      <Button type="submit" class="w-full" :disabled="isLoading || !isHydrated">
                        <Icon name="lucide:wand-sparkles" class="w-4 h-4 mr-2" />
                        {{ isLoading ? 'Sending link...' : 'Send magic link' }}
                      </Button>
                    </template>
                  </div>
                </form>

                <!-- Sign Up Link -->
                <div class="text-center text-sm">
                  Don't have an account?
                  <NuxtLink :to="signupLink" class="underline underline-offset-4"> Sign up </NuxtLink>
                </div>
              </div>

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
import { resolvePostAuthRedirectTarget, resolveSafeRedirectTarget } from '~/lib/auth-redirect'

export default {
  name: 'LoginPage',
  data() {
    return {
      email: '',
      password: '',
      isLoading: false,
      error: '',
      loginMethod: 'password',
      magicLinkSent: false,
      // False until Vue has hydrated. The submit buttons are `type="submit"`
      // inside a `@submit.prevent` form, so a click landing before hydration
      // performs a NATIVE form submission: the page reloads to `/login?`, the
      // typed credentials are silently discarded, no request is made and no
      // error is shown. Gating the button on this closes that window - and
      // because automation waits for a control to be enabled, it also makes
      // scripted sign-in deterministic instead of a race.
      isHydrated: false,
    }
  },
  mounted() {
    this.isHydrated = true
  },
  computed: {
    signupLink() {
      const redirect = this.$route.query.redirect
      return redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : '/signup'
    },
  },
  methods: {
    async resolveRedirectTarget(rawRedirect, fallback = '/dashboard') {
      return resolveSafeRedirectTarget(rawRedirect, fallback)
    },

    async resolvePostAuthTarget(rawRedirect, fallback = '/dashboard') {
      return resolvePostAuthRedirectTarget(rawRedirect, fallback)
    },

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
          $fetch('/api/auth/merge-anonymous', { method: 'POST' }).catch(() => {})
          const target = await this.resolvePostAuthTarget(this.$route.query.redirect, '/dashboard')
          // Hard reload when adding an account to clear all in-memory session caches
          if (this.$route.query.addAccount === 'true') {
            window.location.href = target
          } else if (target.startsWith('http://') || target.startsWith('https://')) {
            window.location.href = target
          } else {
            await navigateTo(target)
          }
        }
      } catch (err) {
        this.error = 'An unexpected error occurred'
        console.error('Sign in error:', err)
      } finally {
        this.isLoading = false
      }
    },

    async handleMagicLink() {
      if (!this.email) {
        this.error = 'Please enter your email'
        return
      }

      this.isLoading = true
      this.error = ''

      try {
        const callbackURL = await this.resolvePostAuthTarget(this.$route.query.redirect, '/dashboard')

        const result = await authClient.signIn.magicLink({
          email: this.email,
          callbackURL,
        })

        if (result.error) {
          this.error = result.error.message || 'Failed to send magic link'
        } else {
          this.magicLinkSent = true
        }
      } catch (err) {
        this.error = 'An unexpected error occurred'
        console.error('Magic link error:', err)
      } finally {
        this.isLoading = false
      }
    },

    async handleGitHubSignIn() {
      this.isLoading = true
      this.error = ''

      try {
        const callbackURL = await this.resolvePostAuthTarget(this.$route.query.redirect, '/dashboard')
        await authClient.signIn.social({
          provider: 'github',
          callbackURL,
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
