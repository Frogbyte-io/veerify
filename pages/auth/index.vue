<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8">
        <div>
          <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Better Auth Demo
          </h2>
          <p class="mt-2 text-center text-sm text-gray-600">
            Authentication powered by Better Auth
          </p>
        </div>

        <!-- Show user info if logged in -->
        <div v-if="session && session.data && session.data.user" class="bg-white p-6 rounded-lg shadow">
          <div class="text-center">
            <Icon name="lucide:user-check" class="mx-auto h-12 w-12 text-green-600" />
            <h3 class="mt-2 text-lg font-medium text-gray-900">Welcome back!</h3>
            <div class="mt-4 space-y-2">
              <p class="text-sm text-gray-600">
                <strong>Name:</strong> {{ session.data.user.name }}
              </p>
              <p class="text-sm text-gray-600">
                <strong>Email:</strong> {{ session.data.user.email }}
              </p>
              <p class="text-sm text-gray-600">
                <strong>ID:</strong> {{ session.data.user.id }}
              </p>
            </div>
            <div class="mt-6">
              <button
                @click="handleSignOut"
                class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        <!-- Show auth options if not logged in -->
        <div v-else class="bg-white p-6 rounded-lg shadow">
          <div class="space-y-4">
            <h3 class="text-lg font-medium text-gray-900 text-center">Sign In Options</h3>
            
            <!-- Email/Password Sign In -->
            <div class="space-y-4">
              <div>
                <label for="email" class="block text-sm font-medium text-gray-700">Email</label>
                <input
                  id="email"
                  v-model="email"
                  type="email"
                  required
                  class="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your email"
                />
              </div>
              
              <div>
                <label for="password" class="block text-sm font-medium text-gray-700">Password</label>
                <input
                  id="password"
                  v-model="password"
                  type="password"
                  required
                  class="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your password"
                />
              </div>

              <div class="flex space-x-4">
                <button
                  @click="handleSignIn"
                  :disabled="isLoading"
                  class="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {{ isLoading ? 'Signing In...' : 'Sign In' }}
                </button>
                
                <button
                  @click="handleSignUp"
                  :disabled="isLoading"
                  class="flex-1 flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {{ isLoading ? 'Signing Up...' : 'Sign Up' }}
                </button>
              </div>
            </div>

            <!-- Divider -->
            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-gray-300" />
              </div>
              <div class="relative flex justify-center text-sm">
                <span class="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

            <!-- Social Sign In (GitHub example) -->
            <button
              @click="handleGitHubSignIn"
              class="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <Icon name="lucide:github" class="w-5 h-5 mr-2" />
              Continue with GitHub
            </button>
          </div>

          <!-- Error message -->
          <div v-if="error" class="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {{ error }}
          </div>
        </div>

        <!-- Session Debug Info -->
        <div class="bg-gray-100 p-4 rounded-lg">
          <h4 class="text-sm font-medium text-gray-900 mb-2">Session Debug:</h4>
          <pre class="text-xs text-gray-600 overflow-auto">{{ JSON.stringify(session, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import { authClient } from "~/lib/auth-client";

export default {
  name: 'AuthPage',
  data() {
    return {
      email: '',
      password: '',
      isLoading: false,
      error: '',
    };
  },
  computed: {
    session() {
      return authClient.useSession();
    },
  },
  methods: {
    // Sign in handler
    async handleSignIn() {
      if (!this.email || !this.password) {
        this.error = 'Please enter both email and password';
        return;
      }

      this.isLoading = true;
      this.error = '';

      try {
        const result = await authClient.signIn.email({
          email: this.email,
          password: this.password,
        });

        if (result.error) {
          this.error = result.error.message || 'Sign in failed';
        } else {
          // Success - session will be automatically updated
          this.email = '';
          this.password = '';
        }
      } catch (err) {
        this.error = 'An unexpected error occurred';
        console.error('Sign in error:', err);
      } finally {
        this.isLoading = false;
      }
    },

    // Sign up handler
    async handleSignUp() {
      if (!this.email || !this.password) {
        this.error = 'Please enter both email and password';
        return;
      }

      this.isLoading = true;
      this.error = '';

      try {
        const result = await authClient.signUp.email({
          email: this.email,
          password: this.password,
          name: this.email.split('@')[0], // Use email prefix as name
        });

        if (result.error) {
          this.error = result.error.message || 'Sign up failed';
        } else {
          // Success - session will be automatically updated
          this.email = '';
          this.password = '';
        }
      } catch (err) {
        this.error = 'An unexpected error occurred';
        console.error('Sign up error:', err);
      } finally {
        this.isLoading = false;
      }
    },

    // GitHub sign in handler
    async handleGitHubSignIn() {
      try {
        await authClient.signIn.social({
          provider: 'github',
        });
      } catch (err) {
        this.error = 'GitHub sign in failed';
        console.error('GitHub sign in error:', err);
      }
    },

    // Sign out handler
    async handleSignOut() {
      try {
        await authClient.signOut();
      } catch (err) {
        this.error = 'Sign out failed';
        console.error('Sign out error:', err);
      }
    },
  },
};
</script> 