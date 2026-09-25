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
              <CardTitle class="text-xl font-display"> Reset your password </CardTitle>
              <CardDescription>
                Enter your email address and we'll send you a link to reset your password
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form @submit.prevent="handleSubmit">
                <div class="grid gap-6">
                  <div class="grid gap-3">
                    <Label for="email">Email</Label>
                    <Input
                      id="email"
                      v-model="email"
                      type="email"
                      placeholder="m@example.com"
                      required
                      :disabled="isLoading || !isHydrated"
                    />
                  </div>
                  <Button type="submit" class="w-full" :disabled="isLoading || !isHydrated">
                    {{ isLoading ? 'Sending...' : 'Send reset link' }}
                  </Button>
                </div>
              </form>

              <!-- Success Message -->
              <div
                v-if="success"
                class="mt-4 p-3 bg-primary/10 border border-primary/20 text-foreground rounded-md text-sm"
              >
                {{ success }}
              </div>

              <!-- Error Message -->
              <div
                v-if="error"
                class="mt-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm"
              >
                {{ error }}
              </div>

              <!-- Back to login link -->
              <div class="mt-6 text-center text-sm">
                <NuxtLink to="/login" class="underline underline-offset-4"> Back to sign in </NuxtLink>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'ForgotPasswordPage',
  data() {
    return {
      email: '',
      isLoading: false,
      error: '',
      success: '',
      // See the note in pages/login/index.vue: a click before hydration
      // triggers a native form submit that silently reloads the page and
      // discards what was typed.
      isHydrated: false,
    }
  },
  mounted() {
    this.isHydrated = true
  },
  methods: {
    async handleSubmit() {
      if (!this.email) {
        this.error = 'Please enter your email address'
        return
      }

      this.isLoading = true
      this.error = ''
      this.success = ''

      try {
        await authClient.requestPasswordReset({
          email: this.email,
        })

        this.success = "If an account with that email exists, we've sent you a password reset link."
        this.email = ''
      } catch (err) {
        this.error = 'An unexpected error occurred'
        console.error('Forgot password error:', err)
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
