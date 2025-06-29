<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-sm">
        <div class="flex flex-col gap-6">
          <Card>
            <CardHeader class="text-center">
              <CardTitle class="text-xl">
                Reset your password
              </CardTitle>
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
                      :disabled="isLoading"
                    />
                  </div>
                  <Button type="submit" class="w-full" :disabled="isLoading">
                    {{ isLoading ? 'Sending...' : 'Send reset link' }}
                  </Button>
                </div>
              </form>
              
              <!-- Success Message -->
              <div v-if="success" class="mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm">
                {{ success }}
              </div>
              
              <!-- Error Message -->
              <div v-if="error" class="mt-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm">
                {{ error }}
              </div>
              
              <!-- Back to login link -->
              <div class="mt-6 text-center text-sm">
                <NuxtLink to="/login" class="underline underline-offset-4">
                  Back to sign in
                </NuxtLink>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
export default {
  name: 'ForgotPasswordPage',
  data() {
    return {
      email: '',
      isLoading: false,
      error: '',
      success: ''
    }
  },
  methods: {
    async handleSubmit() {
      if (!this.email) {
        this.error = 'Please enter your email address';
        return;
      }

      this.isLoading = true;
      this.error = '';
      this.success = '';

      try {
        // For now, just show a success message
        // In a real implementation, you would call the forgot password API
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
        
        this.success = 'If an account with that email exists, we\'ve sent you a password reset link.';
        this.email = '';
      } catch (err) {
        this.error = 'An unexpected error occurred';
        console.error('Forgot password error:', err);
      } finally {
        this.isLoading = false;
      }
    }
  }
}
</script> 