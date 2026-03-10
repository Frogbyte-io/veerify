<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-md">
        <Card>
          <CardHeader class="text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon name="lucide:mail-check" class="h-6 w-6" />
            </div>
            <CardTitle class="mt-4 text-2xl font-display">Accept Invitation</CardTitle>
            <CardDescription v-if="invitationSummary">
              Join <strong>{{ invitationSummary.organizationName }}</strong> on Veerify.
            </CardDescription>
            <CardDescription v-else-if="invitationId"> Accept your workspace invitation to continue. </CardDescription>
            <CardDescription v-else>Invitation link is missing the required ID.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div v-if="isLoading" class="space-y-3">
              <Skeleton class="mx-auto h-6 w-2/3" />
              <Skeleton class="h-10 w-full" />
              <Skeleton class="h-10 w-full" />
            </div>

            <template v-else>
              <template v-if="errorMessage">
                <Alert variant="destructive">
                  <Icon name="lucide:circle-alert" class="h-4 w-4" />
                  <AlertTitle>Invitation unavailable</AlertTitle>
                  <AlertDescription>{{ errorMessage }}</AlertDescription>
                </Alert>

                <template v-if="session?.user">
                  <div class="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                    You're signed in as <span class="font-medium text-foreground">{{ session.user.email }}</span>. Try
                    signing in with the email address this invitation was sent to.
                  </div>
                  <div class="grid gap-3">
                    <Button class="w-full" :disabled="isSwitching" @click="switchAccount">
                      <Icon v-if="isSwitching" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                      Sign in with a different account
                    </Button>
                    <Button as-child variant="outline" class="w-full">
                      <NuxtLink :to="signupLink">Create a new account</NuxtLink>
                    </Button>
                  </div>
                </template>
              </template>

              <div v-else-if="wasAccepted" class="space-y-4 text-center">
                <p class="text-sm text-muted-foreground">
                  The invitation was accepted. You can continue into your workspace now.
                </p>
                <Button class="w-full" @click="goToWorkspace">Open workspace</Button>
              </div>

              <template v-else-if="!session?.user">
                <div class="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                  Sign in or create an account with the invited email address to accept this invitation.
                </div>
                <div class="grid gap-3">
                  <Button as-child class="w-full">
                    <NuxtLink :to="loginLink">Sign in to accept</NuxtLink>
                  </Button>
                  <Button as-child variant="outline" class="w-full">
                    <NuxtLink :to="signupLink">Create account to accept</NuxtLink>
                  </Button>
                </div>
              </template>

              <template v-else>
                <div class="space-y-2 rounded-lg border p-4">
                  <p class="text-sm text-muted-foreground">Signed in as</p>
                  <p class="font-medium">{{ session.user.email }}</p>
                  <p v-if="invitationSummary?.role" class="text-sm text-muted-foreground">
                    Role: <span class="capitalize text-foreground">{{ invitationSummary.role }}</span>
                  </p>
                </div>
                <Button class="w-full" :disabled="isAccepting || !invitationId" @click="acceptInvitation">
                  <Icon v-if="isAccepting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                  Accept invitation
                </Button>
              </template>
            </template>
          </CardContent>
        </Card>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import { toast } from 'vue-sonner'

export default {
  name: 'AcceptInvitationPage',
  data() {
    return {
      invitationId: '',
      invitationSummary: null,
      session: null,
      isLoading: true,
      isAccepting: false,
      isSwitching: false,
      wasAccepted: false,
      errorMessage: '',
    }
  },
  computed: {
    redirectPath() {
      return this.$route.fullPath || '/accept-invitation'
    },
    loginLink() {
      return `/login?redirect=${encodeURIComponent(this.redirectPath)}`
    },
    signupLink() {
      return `/signup?redirect=${encodeURIComponent(this.redirectPath)}`
    },
  },
  async mounted() {
    this.invitationId = typeof this.$route.query.id === 'string' ? this.$route.query.id : ''

    if (!this.invitationId) {
      this.errorMessage = 'This invitation link is incomplete.'
      this.isLoading = false
      return
    }

    try {
      const sessionResult = await authClient.useSession(useFetch)
      this.session = sessionResult.data.value

      if (this.session?.user) {
        await this.loadInvitationSummary()
      }
    } catch (error) {
      console.error('Error loading invitation page:', error)
      this.errorMessage = 'Failed to load invitation details.'
    } finally {
      this.isLoading = false
    }
  },
  methods: {
    async loadInvitationSummary() {
      if (!this.invitationId) return

      try {
        this.invitationSummary = await $fetch('/api/auth/organization/get-invitation', {
          query: { id: this.invitationId },
        })
        this.errorMessage = ''
      } catch (error) {
        console.error('Error loading invitation summary:', error)
        this.invitationSummary = null
        this.errorMessage =
          error?.data?.message ||
          error?.data?.error?.message ||
          error?.statusMessage ||
          'This invitation is unavailable or belongs to a different email address.'
      }
    },

    async acceptInvitation() {
      if (!this.invitationId) return

      try {
        this.isAccepting = true
        await authClient.organization.acceptInvitation({
          invitationId: this.invitationId,
        })

        if (this.invitationSummary?.organizationId) {
          await authClient.organization.setActive({
            organizationId: this.invitationSummary.organizationId,
          })
        }

        if (this.invitationSummary?.teamId) {
          await $fetch('/api/teams/active', {
            method: 'POST',
            body: { teamId: this.invitationSummary.teamId },
          }).catch(() => null)
        }

        this.wasAccepted = true
        toast.success('Invitation accepted')
        await this.goToWorkspace()
      } catch (error) {
        console.error('Error accepting invitation:', error)
        const message =
          error?.data?.error?.message || error?.data?.message || error?.statusMessage || 'Failed to accept invitation'
        this.errorMessage = message
        toast.error(message)
      } finally {
        this.isAccepting = false
      }
    },

    async switchAccount() {
      try {
        this.isSwitching = true
        await authClient.signOut()
        await navigateTo(this.loginLink)
      } catch {
        this.isSwitching = false
      }
    },

    async goToWorkspace() {
      await navigateTo('/dashboard')
    },
  },
}
</script>
