<template>
  <div class="space-y-6">
    <!-- Team Information Section -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:users" class="h-5 w-5" />
          Team Settings
        </CardTitle>
        <CardDescription>
          Manage your team settings and basic information.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoadingOrganizations || isLoading" class="space-y-4">
          <Skeleton class="h-4 w-48" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
        <div v-else-if="currentTeam" class="space-y-4">
          <div>
            <Label class="pb-2" for="team-name">Team Name</Label>
            <Input
              id="team-name"
              v-model="teamName"
              :disabled="!canManageTeam"
              placeholder="Enter team name"
            />
          </div>
          <div>
            <Label class="pb-2" for="team-slug">Team Slug</Label>
            <Input
              id="team-slug"
              v-model="teamSlug"
              :disabled="!canManageTeam"
              placeholder="team-slug"
            />
          </div>
          <div class="flex justify-end">
            <Button 
              @click="updateTeam" 
              :disabled="!canManageTeam || isUpdating"
            >
              <Icon v-if="isUpdating" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
              Save Changes
            </Button>
          </div>
        </div>
        <div v-else class="text-center py-6">
          <Icon name="lucide:users-x" class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p class="text-muted-foreground">No team found. Create a team to get started.</p>
          <Button @click="showCreateTeamDialog = true" class="mt-4">
            <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
            Create Team
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Team Members Section -->
    <Card v-if="currentTeam">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:user-plus" class="h-5 w-5" />
          Team Members
        </CardTitle>
        <CardDescription>
          Manage team members and their roles.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex justify-between items-center mb-4">
          <p class="text-sm text-muted-foreground">
            {{ members.length }} of {{ membershipLimit }} members
          </p>
          <Button 
            @click="showInviteDialog = true" 
            :disabled="!canInviteUsers"
            size="sm"
          >
            <Icon name="lucide:user-plus" class="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        </div>
        
        <div v-if="isLoadingMembers" class="space-y-3">
          <div v-for="n in 3" :key="n" class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex items-center gap-3">
              <Skeleton class="h-8 w-8 rounded-full" />
              <div class="space-y-1">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-3 w-24" />
              </div>
            </div>
            <Skeleton class="h-8 w-20" />
          </div>
        </div>
        
        <div v-else class="space-y-3">
          <div 
            v-for="member in members" 
            :key="member.id"
            class="flex items-center justify-between p-3 border rounded-lg"
          >
            <div class="flex items-center gap-3">
              <Avatar class="h-8 w-8">
                <AvatarImage :src="member.user?.image" :alt="member.user?.name" />
                <AvatarFallback>
                  {{ getInitials(member.user?.name || member.user?.email) }}
                </AvatarFallback>
              </Avatar>
              <div>
                <p class="font-medium">{{ member.user?.name || member.user?.email }}</p>
                <p class="text-sm text-muted-foreground">{{ member.user?.email }}</p>
              </div>
              <Badge v-if="member.role === 'owner'" variant="default">
                <Icon name="lucide:crown" class="h-3 w-3 mr-1" />
                Owner
              </Badge>
              <Badge v-else-if="member.role === 'admin'" variant="secondary">
                Admin
              </Badge>
              <Badge v-else variant="outline">
                Member
              </Badge>
            </div>
            <DropdownMenu v-if="canManageMember(member)">
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="sm">
                  <Icon name="lucide:more-horizontal" class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  v-if="member.role !== 'owner' && canPromoteToAdmin(member)"
                  @click="updateMemberRole(member.id, 'admin')"
                >
                  <Icon name="lucide:user-check" class="h-4 w-4 mr-2" />
                  Make Admin
                </DropdownMenuItem>
                <DropdownMenuItem 
                  v-if="member.role === 'admin' && canDemoteFromAdmin(member)"
                  @click="updateMemberRole(member.id, 'member')"
                >
                  <Icon name="lucide:user-minus" class="h-4 w-4 mr-2" />
                  Remove Admin
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="canRemoveMember(member)" />
                <DropdownMenuItem 
                  v-if="canRemoveMember(member)"
                  @click="removeMember(member.id)"
                  class="text-red-600"
                >
                  <Icon name="lucide:user-x" class="h-4 w-4 mr-2" />
                  Remove Member
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Pending Invitations Section -->
    <Card v-if="currentTeam && pendingInvitations.length > 0">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:mail" class="h-5 w-5" />
          Pending Invitations
        </CardTitle>
        <CardDescription>
          Team invitations waiting for responses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div 
            v-for="invitation in pendingInvitations" 
            :key="invitation.id"
            class="flex items-center justify-between p-3 border rounded-lg bg-yellow-50 border-yellow-200"
          >
            <div class="flex items-center gap-3">
              <Icon name="lucide:mail" class="h-4 w-4 text-yellow-600" />
              <div>
                <p class="font-medium">{{ invitation.email }}</p>
                <p class="text-sm text-muted-foreground">
                  Invited as {{ invitation.role }} • {{ formatDate(invitation.createdAt) }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                @click="resendInvitation(invitation.id)"
              >
                <Icon name="lucide:send" class="h-4 w-4 mr-2" />
                Resend
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                @click="cancelInvitation(invitation.id)"
                class="text-red-600 hover:text-red-700"
              >
                <Icon name="lucide:x" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Danger Zone -->
    <Card v-if="currentTeam && userRole === 'owner'" class="border-red-200">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-red-600">
          <Icon name="lucide:alert-triangle" class="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Irreversible and destructive actions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div class="flex items-center justify-between p-4 border border-red-200 rounded-lg bg-red-50">
            <div>
              <h4 class="font-medium text-red-900">Delete Team</h4>
              <p class="text-sm text-red-700">
                Permanently delete this team and all associated data.
              </p>
            </div>
            <Button 
              variant="destructive"
              @click="showDeleteTeamDialog = true"
            >
              Delete Team
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Create Team Dialog -->
    <Dialog :open="showCreateTeamDialog" @update:open="showCreateTeamDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Team</DialogTitle>
          <DialogDescription>
            Create a new team to collaborate with others.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div>
            <Label class="pb-2" for="new-team-name">Team Name</Label>
            <Input
              id="new-team-name"
              v-model="newTeamName"
              placeholder="Enter team name"
            />
          </div>
          <div>
            <Label class="pb-2" for="new-team-slug">Team Slug</Label>
            <Input
              id="new-team-slug"
              v-model="newTeamSlug"
              placeholder="team-slug"
            />
          </div>
        </div>
        <DialogFooter>
          <Button @click="showCreateTeamDialog = false" variant="outline">
            Cancel
          </Button>
          <Button @click="createTeam" :disabled="isCreatingTeam">
            <Icon v-if="isCreatingTeam" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Create Team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Invite Member Dialog -->
    <Dialog :open="showInviteDialog" @update:open="showInviteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Send an invitation to join your team.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div>
            <Label class="pb-2" for="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              v-model="inviteEmail"
              type="email"
              placeholder="colleague@example.com"
            />
          </div>
          <div>
            <Label class="pb-2" for="invite-role">Role</Label>
            <select
              id="invite-role"
              v-model="inviteRole"
              class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button @click="showInviteDialog = false" variant="outline">
            Cancel
          </Button>
          <Button @click="inviteMember" :disabled="isInviting">
            <Icon v-if="isInviting" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Team Confirmation Dialog -->
    <Dialog :open="showDeleteTeamDialog" @update:open="showDeleteTeamDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-red-600">Delete Team</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the team and all associated data.
          </DialogDescription>
        </DialogHeader>
        <div class="py-4">
          <div class="p-4 border border-red-200 rounded-lg bg-red-50">
            <p class="text-sm text-red-700 mb-2">
              Please type <strong>{{ currentTeam?.name }}</strong> to confirm deletion:
            </p>
            <Input
              v-model="deleteConfirmation"
              placeholder="Team name"
              class="border-red-300 focus:border-red-500 focus:ring-red-500"
            />
          </div>
        </div>
        <DialogFooter>
          <Button @click="showDeleteTeamDialog = false" variant="outline">
            Cancel
          </Button>
          <Button 
            @click="deleteTeam" 
            variant="destructive"
            :disabled="deleteConfirmation !== currentTeam?.name || isDeleting"
          >
            <Icon v-if="isDeleting" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
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
  setup() {
    // Use the organizations composable
    const organizations = authClient.useListOrganizations()
    const activeOrganization = authClient.useActiveOrganization()
    
    return { 
      organizations,
      activeOrganization
    }
  },
  data() {
    return {
      // Current team data
      currentTeam: null,
      members: [],
      pendingInvitations: [],
      userRole: null,
      membershipLimit: 50,
      
      // Loading states
      isLoading: true,
      isLoadingMembers: false,
      isUpdating: false,
      isCreatingTeam: false,
      isInviting: false,
      isDeleting: false,
      
      // Form data
      teamName: '',
      teamSlug: '',
      newTeamName: '',
      newTeamSlug: '',
      inviteEmail: '',
      inviteRole: 'member',
      deleteConfirmation: '',
      
      // Dialog states
      showCreateTeamDialog: false,
      showInviteDialog: false,
      showDeleteTeamDialog: false,
    }
  },
  
  computed: {
    // Loading states from composables
    isLoadingOrganizations() {
      return this.organizations.isPending || this.activeOrganization.isPending
    },
    
    // Get current team from active organization
    currentTeamFromComposable() {
      return this.activeOrganization.data || null
    },
    
    // Check if user has organizations
    hasOrganizations() {
      return this.organizations.data && this.organizations.data.length > 0
    },
    
    canManageTeam() {
      return this.userRole === 'owner' || this.userRole === 'admin'
    },
    
    canInviteUsers() {
      return this.canManageTeam && this.members.length < this.membershipLimit
    },
    
    canManageMember() {
      return (member) => {
        if (this.userRole === 'owner') return member.role !== 'owner'
        if (this.userRole === 'admin') return member.role === 'member'
        return false
      }
    },
    
    canPromoteToAdmin() {
      return (member) => this.userRole === 'owner' && member.role === 'member'
    },
    
    canDemoteFromAdmin() {
      return (member) => this.userRole === 'owner' && member.role === 'admin'
    },
    
    canRemoveMember() {
      return (member) => {
        if (member.role === 'owner') return false
        if (this.userRole === 'owner') return true
        if (this.userRole === 'admin') return member.role === 'member'
        return false
      }
    }
  },
  
  watch: {
    // Watch for changes in active organization from composable
    'activeOrganization.data': {
      handler(newOrg, oldOrg) {
        if (newOrg !== oldOrg && !this.activeOrganization.isPending) {
          this.currentTeam = newOrg
          if (newOrg) {
            this.teamName = newOrg.name
            this.teamSlug = newOrg.slug
            this.loadTeamDetails()
          }
        }
      },
      immediate: true
    }
  },
  
  methods: {
    async loadTeamDetails() {
      if (!this.currentTeam) return
      
      try {
        // Get user's role in the organization
        const { data: membership } = await authClient.organization.getMembership({
          organizationId: this.currentTeam.id
        })
        this.userRole = membership?.role
        
        await this.loadMembers()
        await this.loadPendingInvitations()
      } catch (error) {
        console.error('Error loading team details:', error)
        toast.error('Failed to load team details')
      }
    },
    
    async loadTeamData() {
      try {
        this.isLoading = true
        
        // Wait for organizations to load
        while (this.organizations.isPending || this.activeOrganization.isPending) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        
        // Get current team from composable
        this.currentTeam = this.currentTeamFromComposable
        
        if (this.currentTeam) {
          this.teamName = this.currentTeam.name
          this.teamSlug = this.currentTeam.slug
          await this.loadTeamDetails()
        }
      } catch (error) {
        console.error('Error loading team data:', error)
        toast.error('Failed to load team data')
      } finally {
        this.isLoading = false
      }
    },
    
    async loadMembers() {
      if (!this.currentTeam) return
      
      try {
        this.isLoadingMembers = true
        const { data: members } = await authClient.organization.listMembers({
          organizationId: this.currentTeam.id
        })
        this.members = members || []
      } catch (error) {
        console.error('Error loading members:', error)
        toast.error('Failed to load team members')
      } finally {
        this.isLoadingMembers = false
      }
    },
    
    async loadPendingInvitations() {
      if (!this.currentTeam) return
      
      try {
        const { data: invitations } = await authClient.organization.listInvitations({
          organizationId: this.currentTeam.id
        })
        this.pendingInvitations = invitations?.filter(inv => inv.status === 'pending') || []
      } catch (error) {
        console.error('Error loading invitations:', error)
      }
    },
    
    async createTeam() {
      if (!this.newTeamName.trim()) {
        toast.error('Team name is required')
        return
      }
      
      try {
        this.isCreatingTeam = true
        const newTeam = await authClient.organization.create({
          name: this.newTeamName,
          slug: this.newTeamSlug || this.newTeamName.toLowerCase().replace(/\s+/g, '-')
        })
        
        // Set the new team as active
        if (newTeam.data) {
          await authClient.organization.setActive({ organizationId: newTeam.data.id })
        }
        
        toast.success('Team created successfully')
        this.showCreateTeamDialog = false
        this.newTeamName = ''
        this.newTeamSlug = ''
        
        // Refresh organizations list
        await this.organizations.refresh?.()
        await this.activeOrganization.refresh?.()
      } catch (error) {
        console.error('Error creating team:', error)
        toast.error('Failed to create team')
      } finally {
        this.isCreatingTeam = false
      }
    },
    
    async updateTeam() {
      if (!this.currentTeam) return
      
      try {
        this.isUpdating = true
        await authClient.organization.update({
          organizationId: this.currentTeam.id,
          name: this.teamName,
          slug: this.teamSlug
        })
        
        toast.success('Team updated successfully')
        
        // Refresh organizations to reflect the changes
        await this.organizations.refresh?.()
        await this.activeOrganization.refresh?.()
      } catch (error) {
        console.error('Error updating team:', error)
        toast.error('Failed to update team')
      } finally {
        this.isUpdating = false
      }
    },
    
    async inviteMember() {
      if (!this.inviteEmail.trim()) {
        toast.error('Email address is required')
        return
      }
      
      try {
        this.isInviting = true
        await authClient.organization.inviteMember({
          organizationId: this.currentTeam.id,
          email: this.inviteEmail,
          role: this.inviteRole
        })
        
        toast.success('Invitation sent successfully')
        this.showInviteDialog = false
        this.inviteEmail = ''
        this.inviteRole = 'member'
        await this.loadPendingInvitations()
      } catch (error) {
        console.error('Error inviting member:', error)
        toast.error('Failed to send invitation')
      } finally {
        this.isInviting = false
      }
    },
    
    async updateMemberRole(memberId, newRole) {
      try {
        await authClient.organization.updateMemberRole({
          organizationId: this.currentTeam.id,
          memberId,
          role: newRole
        })
        
        toast.success('Member role updated successfully')
        await this.loadMembers()
      } catch (error) {
        console.error('Error updating member role:', error)
        toast.error('Failed to update member role')
      }
    },
    
    async removeMember(memberId) {
      try {
        await authClient.organization.removeMember({
          organizationId: this.currentTeam.id,
          memberId
        })
        
        toast.success('Member removed successfully')
        await this.loadMembers()
      } catch (error) {
        console.error('Error removing member:', error)
        toast.error('Failed to remove member')
      }
    },
    
    async resendInvitation(invitationId) {
      try {
        await authClient.organization.resendInvitation({
          invitationId
        })
        
        toast.success('Invitation resent successfully')
      } catch (error) {
        console.error('Error resending invitation:', error)
        toast.error('Failed to resend invitation')
      }
    },
    
    async cancelInvitation(invitationId) {
      try {
        await authClient.organization.cancelInvitation({
          invitationId
        })
        
        toast.success('Invitation cancelled')
        await this.loadPendingInvitations()
      } catch (error) {
        console.error('Error cancelling invitation:', error)
        toast.error('Failed to cancel invitation')
      }
    },
    
    async deleteTeam() {
      if (!this.currentTeam) return
      
      try {
        this.isDeleting = true
        await authClient.organization.delete({
          organizationId: this.currentTeam.id
        })
        
        toast.success('Team deleted successfully')
        this.showDeleteTeamDialog = false
        this.deleteConfirmation = ''
        
        // Refresh organizations list
        await this.organizations.refresh?.()
        await this.activeOrganization.refresh?.()
        
        // Wait a moment for the data to update
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Navigate to dashboard if no teams left
        if (!this.organizations.data || this.organizations.data.length === 0) {
          await navigateTo('/dashboard')
        }
      } catch (error) {
        console.error('Error deleting team:', error)
        toast.error('Failed to delete team')
      } finally {
        this.isDeleting = false
      }
    },
    
    getInitials(name) {
      if (!name) return '?'
      return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
    
    formatDate(date) {
      return new Date(date).toLocaleDateString()
    }
  },
  
  mounted() {
    // The watcher will handle loading when organizations are ready
    // Set initial loading state
    this.isLoading = this.isLoadingOrganizations
  }
}
</script> 