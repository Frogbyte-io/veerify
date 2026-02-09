<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:users" class="h-5 w-5" />
          Team Settings
        </CardTitle>
        <CardDescription> Teams are your operational workspace. </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
        <template v-else-if="currentTeam">
          <div class="space-y-2">
            <Label for="team-name">Team Name</Label>
            <Input id="team-name" v-model="teamName" placeholder="Team name" />
          </div>
          <div class="flex justify-between gap-2">
            <Button variant="outline" @click="showCreateTeamDialog = true">
              <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
              New Team
            </Button>
            <Button :disabled="isSavingTeam" @click="updateTeam">
              <Icon v-if="isSavingTeam" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
              Save Team
            </Button>
          </div>
        </template>
        <div v-else class="text-center py-6">
          <p class="text-muted-foreground">No active team. Create a team to continue.</p>
          <Button class="mt-3" @click="showCreateTeamDialog = true">Create Team</Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="currentTeam">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:user-plus" class="h-5 w-5" />
          Team Members
        </CardTitle>
        <CardDescription> Members of the active team workspace. </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex justify-between items-center mb-4">
          <p class="text-sm text-muted-foreground">{{ teamMembers.length }} members</p>
          <Button size="sm" @click="showInviteDialog = true">
            <Icon name="lucide:user-plus" class="h-4 w-4 mr-2" />
            Invite to Team
          </Button>
        </div>

        <div v-if="isLoadingMembers" class="space-y-2">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="member in teamMembers"
            :key="member.id"
            class="flex items-center justify-between rounded-lg border p-3"
          >
            <div>
              <p class="font-medium">{{ member.userId }}</p>
              <p class="text-xs text-muted-foreground">Joined {{ formatDate(member.createdAt) }}</p>
            </div>
            <Button
              v-if="session?.user?.id !== member.userId"
              variant="ghost"
              class="text-red-600 hover:text-red-700"
              @click="removeTeamMember(member.userId)"
            >
              Remove
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card v-if="currentTeam" class="border-red-200">
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

    <Dialog :open="showCreateTeamDialog" @update:open="showCreateTeamDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription>Create a new operational team in your current organization.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="new-team-name">Team Name</Label>
            <Input id="new-team-name" v-model="newTeamName" placeholder="Platform Team" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateTeamDialog = false">Cancel</Button>
          <Button :disabled="isCreatingTeam || !newTeamName.trim()" @click="createTeam">
            <Icon v-if="isCreatingTeam" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Create Team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="showInviteDialog" @update:open="showInviteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to Team</DialogTitle>
          <DialogDescription>Invite a user directly into this team workspace.</DialogDescription>
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

    <Dialog :open="showDeleteTeamDialog" @update:open="showDeleteTeamDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-red-600">Delete Team</DialogTitle>
          <DialogDescription>
            This permanently deletes the team and removes its workspace context.
          </DialogDescription>
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

export default {
  name: 'SettingsTeam',
  data() {
    return {
      session: null,
      currentTeam: null,
      activeOrganization: null,
      teamName: '',
      teamMembers: [],
      isLoading: true,
      isLoadingMembers: false,
      isSavingTeam: false,
      isCreatingTeam: false,
      isInviting: false,
      isDeletingTeam: false,
      showCreateTeamDialog: false,
      showInviteDialog: false,
      showDeleteTeamDialog: false,
      newTeamName: '',
      inviteEmail: '',
      deleteConfirmation: '',
    }
  },

  async mounted() {
    await this.initialize()
  },

  methods: {
    async initialize() {
      try {
        await $fetch('/api/teams/active')

        const { data: session } = authClient.useSession()
        this.session = session.value
        watch(session, (newSession) => {
          this.session = newSession || null
        })

        const { data: activeTeam } = authClient.useActiveTeam()
        this.currentTeam = activeTeam.value
        if (this.currentTeam?.name) {
          this.teamName = this.currentTeam.name
        }
        watch(activeTeam, async (newTeam) => {
          this.currentTeam = newTeam || null
          this.teamName = newTeam?.name || ''
          await this.loadTeamMembers()
        })

        const { data: activeOrganization } = authClient.useActiveOrganization()
        this.activeOrganization = activeOrganization.value
        watch(activeOrganization, (newOrg) => {
          this.activeOrganization = newOrg || null
        })

        await this.loadTeamMembers()
      } catch (error) {
        console.error('Error initializing team settings:', error)
        toast.error('Failed to load team settings')
      } finally {
        this.isLoading = false
      }
    },

    async loadTeamMembers() {
      if (!this.currentTeam?.id) {
        this.teamMembers = []
        return
      }

      try {
        this.isLoadingMembers = true
        const { data } = await authClient.organization.listTeamMembers({
          query: { teamId: this.currentTeam.id },
        })
        this.teamMembers = data || []
      } catch (error) {
        console.error('Error loading team members:', error)
        toast.error('Failed to load team members')
      } finally {
        this.isLoadingMembers = false
      }
    },

    async updateTeam() {
      if (!this.currentTeam?.id || !this.teamName.trim()) return
      try {
        this.isSavingTeam = true
        await authClient.organization.updateTeam({
          teamId: this.currentTeam.id,
          data: { name: this.teamName.trim() },
        })
        toast.success('Team updated')
      } catch (error) {
        console.error('Error updating team:', error)
        toast.error('Failed to update team')
      } finally {
        this.isSavingTeam = false
      }
    },

    async createTeam() {
      if (!this.activeOrganization?.id || !this.newTeamName.trim()) return
      try {
        this.isCreatingTeam = true
        const result = await authClient.organization.createTeam({
          name: this.newTeamName.trim(),
          organizationId: this.activeOrganization.id,
        })

        if (result?.data?.id) {
          await $fetch('/api/teams/active', {
            method: 'POST',
            body: { teamId: result.data.id },
          })
        }

        this.showCreateTeamDialog = false
        this.newTeamName = ''
        toast.success('Team created')
      } catch (error) {
        console.error('Error creating team:', error)
        toast.error('Failed to create team')
      } finally {
        this.isCreatingTeam = false
      }
    },

    async inviteToTeam() {
      if (!this.currentTeam?.id || !this.activeOrganization?.id || !this.inviteEmail.trim()) return
      try {
        this.isInviting = true
        await authClient.organization.inviteMember({
          organizationId: this.activeOrganization.id,
          email: this.inviteEmail.trim(),
          role: 'member',
          teamId: this.currentTeam.id,
        })
        this.showInviteDialog = false
        this.inviteEmail = ''
        toast.success('Invitation sent')
      } catch (error) {
        console.error('Error inviting team member:', error)
        toast.error('Failed to send invitation')
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
        await authClient.organization.removeTeam({ teamId: this.currentTeam.id })
        this.showDeleteTeamDialog = false
        this.deleteConfirmation = ''
        this.currentTeam = null
        this.teamMembers = []
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
