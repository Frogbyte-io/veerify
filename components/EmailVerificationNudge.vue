<template>
  <div
    v-if="showNudge"
    class="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
  >
    <Icon name="lucide:mail-warning" class="h-4 w-4 shrink-0" />
    <span class="flex-1">
      Please verify your email address
      <span class="font-medium">{{ userEmail }}</span>
      to access all features.
    </span>
    <span v-if="successMessage" class="font-medium text-green-700 dark:text-green-400">
      {{ successMessage }}
    </span>
    <span v-else-if="errorMessage" class="font-medium text-red-700 dark:text-red-400">
      {{ errorMessage }}
    </span>
    <Button
      v-if="!successMessage"
      variant="outline"
      size="sm"
      :disabled="isSending"
      class="shrink-0 border-yellow-300 bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:border-yellow-700 dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
      @click="resendVerification"
    >
      <Icon v-if="isSending" name="lucide:loader-circle" class="h-3 w-3 animate-spin" />
      {{ isSending ? 'Sending…' : 'Resend email' }}
    </Button>
    <button class="ml-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100" aria-label="Dismiss" @click="dismiss">
      <Icon name="lucide:x" class="h-4 w-4" />
    </button>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import { fetchDashboardBootstrap, getCachedDashboardBootstrap } from '~/lib/dashboard-bootstrap-client'

export default {
  name: 'EmailVerificationNudge',

  data() {
    return {
      session: null,
      isPending: true,
      dismissed: false,
      isSending: false,
      successMessage: '',
      errorMessage: '',
    }
  },

  computed: {
    userEmail() {
      return this.session?.user?.email || ''
    },

    emailVerified() {
      return this.session?.user?.emailVerified ?? true
    },

    showNudge() {
      return !this.isPending && !this.dismissed && !this.emailVerified
    },
  },

  async mounted() {
    if (import.meta.client) {
      try {
        const bootstrap = getCachedDashboardBootstrap() || (await fetchDashboardBootstrap())
        this.session = bootstrap?.session || null
        this.isPending = false
      } catch {
        this.isPending = false
      }
    }
  },

  methods: {
    dismiss() {
      this.dismissed = true
    },

    async resendVerification() {
      if (!this.userEmail || this.isSending) return

      this.isSending = true
      this.errorMessage = ''
      this.successMessage = ''

      try {
        await authClient.sendVerificationEmail({
          email: this.userEmail,
          callbackURL: '/dashboard',
        })
        this.successMessage = 'Verification email sent!'
      } catch {
        this.errorMessage = 'Failed to send. Please try again.'
      } finally {
        this.isSending = false
      }
    },
  },
}
</script>
