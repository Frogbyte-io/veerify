<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-lg">
        <!-- Step Indicator -->
        <div class="flex items-center justify-center mb-8">
          <div v-for="(step, index) in steps" :key="step.key" class="flex items-center">
            <div
              class="flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors"
              :class="{
                'bg-primary text-primary-foreground': currentStep === index,
                'bg-primary text-primary-foreground': currentStep > index,
                'bg-muted text-muted-foreground': currentStep < index,
              }"
            >
              <Icon v-if="currentStep > index" name="lucide:check" class="w-4 h-4" />
              <span v-else>{{ index + 1 }}</span>
            </div>
            <div
              v-if="index < steps.length - 1"
              class="w-12 h-0.5 mx-2 transition-colors"
              :class="currentStep > index ? 'bg-primary' : 'bg-muted'"
            />
          </div>
        </div>

        <!-- Step 1: Create Workspace -->
        <Card v-if="currentStep === 0">
          <CardHeader class="text-center">
            <div class="flex justify-center mb-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <Icon name="lucide:building-2" class="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle class="text-2xl">Create your workspace</CardTitle>
            <CardDescription>
              A workspace is where your team collaborates on feedback and projects. You can think of it as your company
              or organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form class="space-y-4" @submit.prevent="createWorkspace">
              <div class="space-y-2">
                <Label for="org-name">Workspace name</Label>
                <Input id="org-name" v-model="orgName" placeholder="Acme Inc." :disabled="isCreatingOrg" />
              </div>
              <div class="space-y-2">
                <Label for="org-slug">URL</Label>
                <div class="flex items-center gap-2">
                  <Input
                    id="org-slug"
                    v-model="orgSlug"
                    placeholder="acme-inc"
                    :disabled="isCreatingOrg"
                    class="flex-1"
                  />
                  <span class="text-sm text-muted-foreground whitespace-nowrap">.veerify.com</span>
                </div>
                <p class="text-xs text-muted-foreground">
                  This will be your public workspace URL. You can change it later.
                </p>
              </div>

              <div
                v-if="createOrgError"
                class="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm"
              >
                {{ createOrgError }}
              </div>

              <Button type="submit" class="w-full" :disabled="isCreatingOrg || !orgName.trim() || !orgSlug.trim()">
                <Icon v-if="isCreatingOrg" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                {{ isCreatingOrg ? 'Creating workspace...' : 'Create workspace' }}
              </Button>
            </form>
          </CardContent>
        </Card>

        <!-- Step 2: Invite Members -->
        <Card v-if="currentStep === 1">
          <CardHeader class="text-center">
            <div class="flex justify-center mb-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <Icon name="lucide:user-plus" class="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle class="text-2xl">Invite your team</CardTitle>
            <CardDescription>
              Veerify works best with your team. Add members now or invite them later from settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div v-for="(invite, index) in inviteEmails" :key="index" class="flex items-center gap-2">
                <Input
                  v-model="inviteEmails[index]"
                  type="email"
                  :placeholder="index === 0 ? 'teammate@company.com' : 'Another teammate'"
                  :disabled="isInviting"
                />
                <Button
                  v-if="inviteEmails.length > 1"
                  variant="ghost"
                  size="icon"
                  class="shrink-0"
                  :disabled="isInviting"
                  @click="removeInviteField(index)"
                >
                  <Icon name="lucide:x" class="w-4 h-4" />
                </Button>
              </div>

              <Button
                v-if="inviteEmails.length < 5"
                variant="outline"
                size="sm"
                class="w-full"
                :disabled="isInviting"
                @click="addInviteField"
              >
                <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
                Add another
              </Button>

              <div
                v-if="inviteError"
                class="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm"
              >
                {{ inviteError }}
              </div>

              <div
                v-if="inviteSuccess"
                class="p-3 bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 rounded-md text-sm"
              >
                {{ inviteSuccess }}
              </div>

              <div class="flex flex-col gap-2 pt-2">
                <Button :disabled="isInviting || !hasValidEmails" @click="sendInvitations">
                  <Icon v-if="isInviting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  {{ isInviting ? 'Sending invitations...' : 'Send invitations' }}
                </Button>
                <Button variant="ghost" :disabled="isInviting" @click="skipInvitations"> Skip for now </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 3: How it Works -->
        <Card v-if="currentStep === 2">
          <CardHeader class="text-center">
            <div class="flex justify-center mb-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <Icon name="lucide:sparkles" class="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle class="text-2xl">You're all set!</CardTitle>
            <CardDescription>
              Your workspace <strong>{{ createdOrgName }}</strong> is ready to go.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <!-- Quick overview cards -->
              <div class="grid gap-3">
                <div class="flex items-start gap-3 rounded-lg border p-3">
                  <div class="flex items-center justify-center w-8 h-8 rounded-md bg-blue-500/10 shrink-0">
                    <Icon name="lucide:message-square" class="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p class="font-medium text-sm">Collect feedback</p>
                    <p class="text-xs text-muted-foreground">
                      Gather feature requests, bug reports, and ideas from your users.
                    </p>
                  </div>
                </div>
                <div class="flex items-start gap-3 rounded-lg border p-3">
                  <div class="flex items-center justify-center w-8 h-8 rounded-md bg-purple-500/10 shrink-0">
                    <Icon name="lucide:package" class="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p class="font-medium text-sm">Organize with projects</p>
                    <p class="text-xs text-muted-foreground">
                      Create projects for different products or areas. Need more separation? Create additional teams
                      later.
                    </p>
                  </div>
                </div>
                <div class="flex items-start gap-3 rounded-lg border p-3">
                  <div class="flex items-center justify-center w-8 h-8 rounded-md bg-green-500/10 shrink-0">
                    <Icon name="lucide:users" class="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p class="font-medium text-sm">Collaborate with your team</p>
                    <p class="text-xs text-muted-foreground">
                      Everyone in your workspace has access. Invite more members anytime from settings.
                    </p>
                  </div>
                </div>
              </div>

              <Button class="w-full" @click="goToDashboard">
                Go to dashboard
                <Icon name="lucide:arrow-right" class="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'OnboardingPage',
  layout: 'clean',

  data() {
    return {
      currentStep: 0,
      steps: [
        { key: 'workspace', label: 'Create workspace' },
        { key: 'invite', label: 'Invite team' },
        { key: 'done', label: 'All set' },
      ],

      // Step 1: Create workspace
      orgName: '',
      orgSlug: '',
      isCreatingOrg: false,
      createOrgError: '',
      createdOrgId: null,
      createdOrgName: '',

      // Step 2: Invite members
      inviteEmails: [''],
      isInviting: false,
      inviteError: '',
      inviteSuccess: '',
    }
  },

  computed: {
    hasValidEmails() {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return this.inviteEmails.some((email) => emailRegex.test(email.trim()))
    },
  },

  watch: {
    orgName(newName) {
      this.orgSlug = this.slugify(newName)
    },
  },

  methods: {
    slugify(value) {
      return value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    },

    async createWorkspace() {
      if (!this.orgName.trim() || !this.orgSlug.trim()) return

      this.isCreatingOrg = true
      this.createOrgError = ''

      try {
        const result = await authClient.organization.create({
          name: this.orgName.trim(),
          slug: this.orgSlug.trim(),
        })

        if (result.error) {
          this.createOrgError = result.error.message || 'Failed to create workspace'
          return
        }

        this.createdOrgId = result.data?.id || null
        this.createdOrgName = this.orgName.trim()

        // Set the new org as active
        if (this.createdOrgId) {
          await authClient.organization.setActive({
            organizationId: this.createdOrgId,
          })

          // Resolve team context so the session has activeTeamId
          await $fetch('/api/teams/active').catch(() => null)
        }

        this.currentStep = 1
      } catch (error) {
        this.createOrgError = error?.message || 'An unexpected error occurred'
        console.error('Error creating workspace:', error)
      } finally {
        this.isCreatingOrg = false
      }
    },

    addInviteField() {
      if (this.inviteEmails.length < 5) {
        this.inviteEmails.push('')
      }
    },

    removeInviteField(index) {
      this.inviteEmails.splice(index, 1)
    },

    async sendInvitations() {
      if (!this.createdOrgId) return

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const validEmails = this.inviteEmails.map((e) => e.trim()).filter((e) => emailRegex.test(e))

      if (validEmails.length === 0) return

      this.isInviting = true
      this.inviteError = ''
      this.inviteSuccess = ''

      try {
        let successCount = 0
        const errors = []

        for (const email of validEmails) {
          try {
            await $fetch('/api/organizations/invite', {
              method: 'POST',
              body: {
                organizationId: this.createdOrgId,
                email,
                role: 'member',
              },
            })
            successCount++
          } catch (error) {
            const statusMessage =
              error?.statusMessage || error?.data?.statusMessage || error?.message || 'Failed to send'
            const steps = error?.data?.data?.recommendedSteps
            const detail = steps ? ` — ${steps[0]}` : ''
            errors.push(`${email}: ${statusMessage}${detail}`)
          }
        }

        if (successCount > 0) {
          this.inviteSuccess = `${successCount} invitation${successCount > 1 ? 's' : ''} sent successfully!`
        }

        if (errors.length > 0) {
          this.inviteError = errors.join(', ')
        }

        // Move to next step after a brief delay to show success
        if (successCount > 0) {
          setTimeout(() => {
            this.currentStep = 2
          }, 1500)
        }
      } catch (error) {
        this.inviteError = error?.statusMessage || error?.message || 'Failed to send invitations'
        console.error('Error sending invitations:', error)
      } finally {
        this.isInviting = false
      }
    },

    skipInvitations() {
      this.currentStep = 2
    },

    async goToDashboard() {
      await navigateTo('/dashboard')
    },
  },
}
</script>
