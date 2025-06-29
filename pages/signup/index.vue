<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-sm">
        <div class="flex flex-col gap-6">
          <Card>
            <CardHeader class="text-center">
              <CardTitle class="text-xl">
                Create your account
              </CardTitle>
              <CardDescription>
                Sign up to get started with your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form @submit.prevent="handleSubmit">
                <div class="grid gap-6">
                  <!-- Social Sign Up Buttons -->
                  <div class="flex flex-col gap-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      class="w-full"
                      @click="handleGitHubSignUp"
                      :disabled="isLoading"
                    >
                      <Icon name="lucide:github" class="w-4 h-4 mr-2" />
                      Continue with GitHub
                    </Button>
                  </div>
                  
                  <!-- Divider -->
                  <div class="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                    <span class="bg-card text-muted-foreground relative z-10 px-2">
                      Or continue with email
                    </span>
                  </div>
                  
                  <!-- Email/Password Form -->
                  <div class="grid gap-6">
                    <div class="grid gap-3">
                      <Label for="name">Full Name</Label>
                      <Input
                        id="name"
                        v-model="name"
                        type="text"
                        placeholder="John Doe"
                        required
                        :disabled="isLoading"
                      />
                    </div>
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
                    <div class="grid gap-3">
                      <Label for="password">Password</Label>
                      <Input 
                        id="password" 
                        v-model="password"
                        type="password" 
                        placeholder="Create a strong password"
                        required 
                        :disabled="isLoading"
                      />
                    </div>
                    <Button type="submit" class="w-full" :disabled="isLoading">
                      {{ isLoading ? 'Creating account...' : 'Create account' }}
                    </Button>
                  </div>
                  
                  <!-- Sign In Link -->
                  <div class="text-center text-sm">
                    Already have an account?
                    <NuxtLink to="/login" class="underline underline-offset-4">
                      Sign in
                    </NuxtLink>
                  </div>
                </div>
              </form>
              
              <!-- Error Message -->
              <div v-if="error" class="mt-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm">
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
import { authClient } from "~/lib/auth-client";

export default {
  name: 'SignUpPage',
  data() {
    return {
      name: '',
      email: '',
      password: '',
      isLoading: false,
      error: ''
    }
  },
  methods: {
    async handleSubmit() {
      if (!this.name || !this.email || !this.password) {
        this.error = 'Please fill in all fields';
        return;
      }

      if (this.password.length < 6) {
        this.error = 'Password must be at least 6 characters long';
        return;
      }

      this.isLoading = true;
      this.error = '';

      try {
        const result = await authClient.signUp.email({
          email: this.email,
          password: this.password,
          name: this.name,
        });

        if (result.error) {
          this.error = result.error.message || 'Sign up failed';
        } else {
          // Success - redirect to dashboard
          await navigateTo('/dashboard');
        }
      } catch (err) {
        this.error = 'An unexpected error occurred';
        console.error('Sign up error:', err);
      } finally {
        this.isLoading = false;
      }
    },

    async handleGitHubSignUp() {
      this.isLoading = true;
      this.error = '';

      try {
        await authClient.signIn.social({
          provider: 'github',
        });
      } catch (err) {
        this.error = 'GitHub sign up failed';
        console.error('GitHub sign up error:', err);
        this.isLoading = false;
      }
    }
  }
}
</script> 