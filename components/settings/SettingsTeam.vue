<template>
  <div class="space-y-6">
    <!-- Explanation -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:users" class="h-5 w-5" />
              <span data-testid="team-title">Teams</span>
            </CardTitle>
            <CardDescription>
              Your workspace operates as a single shared space by default. Create additional teams to organize different
              projects or departments separately.
            </CardDescription>
          </div>
          <Button data-testid="team-open-create-dialog" size="sm" @click="showCreateTeamDialog = true">
            <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
            New Team
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-14 w-full" />
          <Skeleton class="h-14 w-full" />
        </div>

        <div v-else-if="additionalTeams.length === 0" class="text-center py-8">
          <div class="flex justify-center mb-4">
            <div class="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
              <Icon name="lucide:users" class="w-6 h-6 text-muted-foreground" />
            </div>
          </div>
          <p class="font-medium mb-1">No additional teams</p>
          <p class="text-sm text-muted-foreground max-w-sm mx-auto">
            All workspace members share access to projects. Create a team when you need separate groups for different
            projects or departments.
          </p>
          <Button
            data-testid="team-open-create-dialog-empty"
            class="mt-4"
            variant="outline"
            @click="showCreateTeamDialog = true"
          >
            <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
            Create your first team
          </Button>
        </div>

        <div v-else class="space-y-2">
          <button
            v-for="team in additionalTeams"
            :key="team.id"
            :data-testid="`team-list-item-${team.id}`"
            class="w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
            :class="{ 'border-primary bg-accent/30': currentTeam?.id === team.id }"
            @click="switchToTeam(team)"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shrink-0"
              >
                <Icon name="lucide:users" class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="font-medium truncate">{{ team.name }}</p>
                <p class="text-xs text-muted-foreground truncate">{{ getTeamOrganizationName(team) }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Badge v-if="currentTeam?.id === team.id" variant="default" class="text-xs">Active</Badge>
              <Icon
                v-if="switchingTeamId === team.id"
                name="lucide:loader-2"
                class="h-4 w-4 animate-spin text-muted-foreground"
              />
            </div>
          </button>
        </div>
      </CardContent>
    </Card>

    <!-- Active Team Settings -->
    <Card v-if="currentTeam && !isDefaultTeam(currentTeam)">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:settings" class="h-5 w-5" />
          Team Settings
        </CardTitle>
        <CardDescription>Configure the active team: {{ currentTeam.name }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="team-name">Team Name</Label>
          <Input id="team-name" v-model="teamName" placeholder="Team name" />
        </div>
        <div class="space-y-2">
          <Label for="team-slug">Subdomain Slug</Label>
          <Input id="team-slug" v-model="teamSlug" placeholder="my-team" />
          <p class="text-xs text-muted-foreground">Public URL: {{ teamSlugPreview }}</p>
        </div>
        <div class="flex justify-end">
          <Button :disabled="isSavingTeam || !hasTeamChanges" @click="updateTeam">
            <Icon v-if="isSavingTeam" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Save Team
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Team Members -->
    <Card v-if="currentTeam && !isDefaultTeam(currentTeam)">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:user-plus" class="h-5 w-5" />
          Team Members
        </CardTitle>
        <CardDescription>Members of {{ currentTeam.name }}.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex justify-between items-center mb-4">
          <p data-testid="team-members-count" class="text-sm text-muted-foreground">{{ teamMembers.length }} members</p>
          <Button size="sm" @click="showInviteDialog = true">
            <Icon name="lucide:user-plus" class="h-4 w-4 mr-2" />
            Invite to Team
          </Button>
        </div>

        <div v-if="isLoadingMembers" class="space-y-2">
          <Skeleton class="h-14 w-full" />
          <Skeleton class="h-14 w-full" />
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="member in teamMembers"
            :key="member.id"
            class="flex items-center justify-between rounded-lg border p-3"
          >
            <div class="flex items-center gap-3">
              <Avatar class="h-8 w-8">
                <AvatarImage v-if="member.userImage" :src="member.userImage" :alt="member.userName" />
                <AvatarFallback>{{ getInitials(member.userName) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <p class="font-medium truncate">{{ member.userName || 'Unknown User' }}</p>
                <p class="text-xs text-muted-foreground truncate">{{ member.userEmail || member.userId }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant="secondary" class="text-xs uppercase">{{ member.role || 'member' }}</Badge>
              <Button
                v-if="session?.user?.id !== member.userId"
                variant="ghost"
                size="sm"
                class="text-red-600 hover:text-red-700"
                @click="removeTeamMember(member.userId)"
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Danger Zone -->
    <Card v-if="currentTeam && !isDefaultTeam(currentTeam)" class="border-red-200">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-red-600">
          <Icon name="lucide:alert-triangle" class="h-5 w-5" />
          Danger Zone
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" @click="showDeleteTeamDialog = true">Delete Team</Button>
      </CardContent>
    </Card>

    <!-- Create Team Dialog -->
    <Dialog :open="showCreateTeamDialog" @update:open="showCreateTeamDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription
            >Create a new team to organize a separate group of projects. Team members will have their own workspace
            context.</DialogDescription
          >
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="new-team-name">Team Name</Label>
            <Input
              id="new-team-name"
              data-testid="team-create-name"
              v-model="newTeamName"
              placeholder="Platform Team"
            />
          </div>
          <div class="space-y-2">
            <Label for="new-team-slug">Subdomain Slug</Label>
            <Input id="new-team-slug" v-model="newTeamSlug" placeholder="platform-team" />
            <p class="text-xs text-muted-foreground">
              Your public feedback boards will live at
              <span class="font-medium">{{ newTeamSlug || 'slug' }}.{{ appDomain }}</span>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateTeamDialog = false">Cancel</Button>
          <Button
            data-testid="team-create-submit"
            :disabled="isCreatingTeam || !newTeamName.trim() || !newTeamSlug.trim()"
            @click="createTeam"
          >
            <Icon v-if="isCreatingTeam" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Create Team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Invite Dialog -->
    <Dialog :open="showInviteDialog" @update:open="showInviteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to Team</DialogTitle>
          <DialogDescription>Invite a user directly into this team.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="invite-email">Email</Label>
            <Input id="invite-email" v-model="inviteEmail" type="email" placeholder="user@example.com" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showInviteDialog = false">Cancel</Button>
          <Button :disabled="isInviting || !inviteEmail.trim()" @click="inviteToTeam">
            <Icon v-if="isInviting" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Team Dialog -->
    <Dialog :open="showDeleteTeamDialog" @update:open="showDeleteTeamDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-red-600">Delete Team</DialogTitle>
          <DialogDescription> This permanently deletes the team and removes its workspace context. </DialogDescription>
        </DialogHeader>
        <div class="py-3">
          <Input v-model="deleteConfirmation" placeholder="Type team name to confirm" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteTeamDialog = false">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="deleteConfirmation !== currentTeam?.name || isDeletingTeam"
            @click="deleteTeam"
          >
            <Icon v-if="isDeletingTeam" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Delete Team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import { toast } from 'vue-sonner'

const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'SettingsTeam',
  data() {
    return {
      session: null,
      currentTeam: null,
      activeOrganization: null,
      allTeams: [],
      organizations: [],
      teamName: '',
      teamSlug: '',
      teamMembers: [],
      isLoading: true,
      isLoadingMembers: false,
      isSavingTeam: false,
      isCreatingTeam: false,
      isInviting: false,
      isDeletingTeam: false,
      switchingTeamId: null,
      showCreateTeamDialog: false,
      showInviteDialog: false,
      showDeleteTeamDialog: false,
      newTeamName: '',
      newTeamSlug: '',
      inviteEmail: '',
      deleteConfirmation: '',
    }
  },

  computed: {
    appDomain() {
      return useRuntimeConfig().public.appDomain || 'localhost'
    },
    teamSlugPreview() {
      const slug = this.teamSlug || '...'
      return `${slug}.${this.appDomain}`
    },
    hasTeamChanges() {
      return (
        (this.teamName.trim() && this.teamName.trim() !== this.currentTeam?.name) ||
        (this.teamSlug.trim() && this.teamSlug.trim() !== this.currentTeam?.slug)
      )
    },
    additionalTeams() {
      return this.allTeams.filter((t) => !this.isDefaultTeam(t))
    },
  },

  watch: {
    newTeamName(newName) {
      this.newTeamSlug = this.slugify(newName)
    },
  },

  async mounted() {
    await this.initialize()

    if (import.meta.client) {
      window.addEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  methods: {
    isDefaultTeam(team) {
      if (!team) return false
      return team.name === 'Default'
    },

    async fetchActiveTeam() {
      try {
        const response = await $fetch('/api/teams/active')
        return response?.data || null
      } catch (error) {
        if (error?.statusCode === 409 || error?.status === 409) {
          return null
        }
        throw error
      }
    },

    async syncActiveTeamContext() {
      this.currentTeam = await this.fetchActiveTeam()
      this.teamName = this.currentTeam?.name || ''
      this.teamSlug = this.currentTeam?.slug || ''
    },

    async fetchActiveOrganization() {
      try {
        const { data } = await authClient.organization.getFullOrganization({})
        return data || null
      } catch (_error) {
        return null
      }
    },

    async fetchAllTeams() {
      try {
        const response = await $fetch('/api/teams/list-user')
        return Array.isArray(response) ? response : response?.data || []
      } catch (_error) {
        return []
      }
    },

    async fetchOrganizations() {
      try {
        const { data } = await authClient.organization.list()
        return Array.isArray(data) ? data : []
      } catch (_error) {
        return []
      }
    },

    async handleActiveTeamChanged() {
      await this.syncActiveTeamContext()
      this.allTeams = await this.fetchAllTeams()
      await this.loadTeamMembers()
    },

    async resolveOrganizationId() {
      if (this.activeOrganization?.id) {
        return this.activeOrganization.id
      }

      if (this.currentTeam?.organizationId) {
        return this.currentTeam.organizationId
      }

      try {
        const response = await $fetch('/api/teams/active')
        return response?.data?.organizationId || null
      } catch (_error) {
        return null
      }
    },

    getTeamOrganizationName(team) {
      const org = this.organizations.find((o) => o.id === team.organizationId)
      return org?.name || ''
    },

    getInitials(name) {
      if (!name) return '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },

    async initialize() {
      try {
        const [_activeTeam, sessionResult, activeOrganization, allTeams, organizations] = await Promise.all([
          this.syncActiveTeamContext(),
          authClient.useSession(useFetch),
          this.fetchActiveOrganization(),
          this.fetchAllTeams(),
          this.fetchOrganizations(),
        ])

        this.session = sessionResult.data.value
        this.activeOrganization = activeOrganization
        this.allTeams = allTeams
        this.organizations = organizations

        await this.loadTeamMembers()
      } catch (error) {
        console.error('Error during team settings initialization:', error)
        toast.error('Failed to load team settings')
      } finally {
        this.isLoading = false
      }
    },

    async loadTeamMembers() {
      if (!this.currentTeam?.id || this.isDefaultTeam(this.currentTeam)) {
        this.teamMembers = []
        return
      }

      try {
        this.isLoadingMembers = true
        const response = await $fetch('/api/teams/members', {
          params: { teamId: this.currentTeam.id },
        })
        this.teamMembers = response?.data || []
      } catch (_error) {
        // Fall back to Better-Auth API (returns userId only)
        try {
          const { data } = await authClient.organization.listTeamMembers({
            teamId: this.currentTeam.id,
          })
          this.teamMembers = (data || []).map((m) => ({
            ...m,
            userName: null,
            userEmail: null,
            userImage: null,
          }))
        } catch (error) {
          console.error('Error loading team members:', error)
          toast.error('Failed to load team members')
        }
      } finally {
        this.isLoadingMembers = false
      }
    },

    async switchToTeam(team) {
      if (team.id === this.currentTeam?.id || this.switchingTeamId) return

      try {
        this.switchingTeamId = team.id

        await $fetch('/api/teams/active', {
          method: 'POST',
          body: { teamId: team.id },
        })

        // Sync Better-Auth client-side organization context
        if (team.organizationId && team.organizationId !== this.currentTeam?.organizationId) {
          await authClient.organization.setActive({
            organizationId: team.organizationId,
          })
        }

        this.currentTeam = { ...team, organization: null }
        this.teamName = team.name

        // Refresh organization context if org changed
        if (team.organizationId !== this.activeOrganization?.id) {
          this.activeOrganization = await this.fetchActiveOrganization()
        }

        await this.loadTeamMembers()

        // Notify other components (sidebar TeamSwitcher, pages)
        if (import.meta.client) {
          window.dispatchEvent(
            new CustomEvent(ACTIVE_TEAM_CHANGED_EVENT, {
              detail: { teamId: team.id },
            })
          )
        }

        toast.success(`Switched to ${team.name}`)
      } catch (error) {
        console.error('Error switching team:', error)
        toast.error('Failed to switch team')
      } finally {
        this.switchingTeamId = null
      }
    },

    async updateTeam() {
      if (!this.currentTeam?.id) return
      try {
        this.isSavingTeam = true

        const nameChanged = this.teamName.trim() && this.teamName.trim() !== this.currentTeam.name
        const slugChanged = this.teamSlug.trim() && this.teamSlug.trim() !== this.currentTeam.slug

        if (nameChanged) {
          await authClient.organization.updateTeam({
            teamId: this.currentTeam.id,
            data: { name: this.teamName.trim() },
          })
          this.currentTeam.name = this.teamName.trim()
          const teamInList = this.allTeams.find((t) => t.id === this.currentTeam.id)
          if (teamInList) teamInList.name = this.teamName.trim()
        }

        if (slugChanged) {
          await $fetch(`/api/teams/${this.currentTeam.id}/slug`, {
            method: 'PUT',
            body: { slug: this.teamSlug.trim() },
          })
          this.currentTeam.slug = this.teamSlug.trim()
          const teamInList = this.allTeams.find((t) => t.id === this.currentTeam.id)
          if (teamInList) teamInList.slug = this.teamSlug.trim()
        }

        toast.success('Team updated')
      } catch (error) {
        console.error('Error updating team:', error)
        toast.error(error?.data?.error?.message || 'Failed to update team')
      } finally {
        this.isSavingTeam = false
      }
    },

    slugify(value) {
      return value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    },

    async createTeam() {
      if (!this.newTeamName.trim() || !this.newTeamSlug.trim()) return

      const organizationId = await this.resolveOrganizationId()
      if (!organizationId) {
        toast.error('No active workspace context')
        return
      }

      try {
        this.isCreatingTeam = true
        const result = await $fetch('/api/teams/create', {
          method: 'POST',
          body: {
            name: this.newTeamName.trim(),
            slug: this.newTeamSlug.trim(),
            organizationId,
          },
        })

        const newTeamId = result?.data?.id
        if (newTeamId) {
          await $fetch('/api/teams/active', {
            method: 'POST',
            body: { teamId: newTeamId },
          })

          await this.syncActiveTeamContext()
          this.allTeams = await this.fetchAllTeams()
          await this.loadTeamMembers()

          // Notify other components
          if (import.meta.client) {
            window.dispatchEvent(
              new CustomEvent(ACTIVE_TEAM_CHANGED_EVENT, {
                detail: { teamId: newTeamId },
              })
            )
          }
        }

        this.showCreateTeamDialog = false
        this.newTeamName = ''
        this.newTeamSlug = ''
        toast.success('Team created')
      } catch (error) {
        console.error('Error creating team:', error)
        toast.error(error?.data?.error?.message || 'Failed to create team')
      } finally {
        this.isCreatingTeam = false
      }
    },

    async inviteToTeam() {
      if (!this.currentTeam?.id || !this.inviteEmail.trim()) return

      const organizationId = await this.resolveOrganizationId()
      if (!organizationId) {
        toast.error('No active workspace context')
        return
      }

      try {
        this.isInviting = true
        await $fetch('/api/organizations/invite', {
          method: 'POST',
          body: {
            organizationId,
            email: this.inviteEmail.trim(),
            role: 'member',
            teamId: this.currentTeam.id,
          },
        })
        this.showInviteDialog = false
        this.inviteEmail = ''
        toast.success('Invitation sent')
      } catch (error) {
        console.error('Error inviting team member:', error)
        const message = error?.data?.statusMessage || 'Failed to send invitation'
        const steps = error?.data?.data?.recommendedSteps
        const hint = steps ? `\n${steps[0]}` : ''
        toast.error(message + hint)
      } finally {
        this.isInviting = false
      }
    },

    async removeTeamMember(userId) {
      if (!this.currentTeam?.id) return
      try {
        await authClient.organization.removeTeamMember({
          teamId: this.currentTeam.id,
          userId,
        })
        await this.loadTeamMembers()
        toast.success('Team member removed')
      } catch (error) {
        console.error('Error removing team member:', error)
        toast.error('Failed to remove team member')
      }
    },

    async deleteTeam() {
      if (!this.currentTeam?.id) return
      try {
        this.isDeletingTeam = true
        const deletedTeamId = this.currentTeam.id
        await authClient.organization.removeTeam({ teamId: deletedTeamId })
        this.showDeleteTeamDialog = false
        this.deleteConfirmation = ''

        // Remove from local list
        this.allTeams = this.allTeams.filter((t) => t.id !== deletedTeamId)

        await this.syncActiveTeamContext()
        await this.loadTeamMembers()

        // Notify other components
        if (import.meta.client) {
          window.dispatchEvent(
            new CustomEvent(ACTIVE_TEAM_CHANGED_EVENT, {
              detail: { teamId: this.currentTeam?.id || null },
            })
          )
        }

        toast.success('Team deleted')
      } catch (error) {
        console.error('Error deleting team:', error)
        toast.error('Failed to delete team')
      } finally {
        this.isDeletingTeam = false
      }
    },

    formatDate(date) {
      return new Date(date).toLocaleDateString()
    },
  },
}
</script>
