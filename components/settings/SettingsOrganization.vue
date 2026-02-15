<template>
  <div class="space-y-6">
    <!-- Organization Details -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:building-2" class="h-5 w-5" />
          <span data-testid="organization-title">Workspace Settings</span>
        </CardTitle>
        <CardDescription>Manage your workspace profile and URL namespace. Your workspace is the shared space where your team collaborates.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>

        <div v-else-if="!organizationDetails" class="text-sm text-muted-foreground">
          No active workspace context is available.
        </div>

        <template v-else>
          <div class="space-y-2">
            <Label for="organization-name">Workspace Name</Label>
            <Input
              id="organization-name"
              data-testid="organization-name-input"
              v-model="organizationName"
              :disabled="!canEditOrganization || isSaving"
              placeholder="Organization name"
            />
          </div>

          <div class="space-y-2">
            <Label for="organization-slug">Workspace URL</Label>
            <Input
              id="organization-slug"
              data-testid="organization-slug-input"
              v-model="organizationSlug"
              :disabled="!canEditOrganization || isSaving"
              placeholder="organization-slug"
            />
            <p class="text-xs text-amber-600">
              Changing the slug updates the public URL namespace for this organization.
            </p>
          </div>

          <div class="space-y-2">
            <Label for="organization-logo">Logo URL</Label>
            <Input
              id="organization-logo"
              data-testid="organization-logo-input"
              v-model="organizationLogo"
              :disabled="!canEditOrganization || isSaving"
              placeholder="https://example.com/logo.png"
            />
          </div>

          <div class="flex items-center justify-between gap-3">
            <p v-if="!canEditOrganization" class="text-sm text-muted-foreground">
              Only owners and admins can update workspace details.
            </p>
            <div class="ml-auto">
              <Button
                data-testid="organization-save"
                :disabled="!canEditOrganization || !hasChanges || isSaving"
                @click="updateOrganization"
              >
                <Icon v-if="isSaving" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
                Save Changes
              </Button>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Members -->
    <Card v-if="organizationDetails">
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:users" class="h-5 w-5" />
              Members
            </CardTitle>
            <CardDescription>Manage workspace members and their roles. All members have access to shared projects.</CardDescription>
          </div>
          <Button v-if="canManageMembers" size="sm" @click="showInviteDialog = true">
            <Icon name="lucide:user-plus" class="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p data-testid="organization-members-count" class="text-sm text-muted-foreground mb-4">
          {{ organizationDetails.memberCount }} member{{ organizationDetails.memberCount !== 1 ? 's' : '' }}
        </p>

        <div v-if="isLoadingMembers" class="space-y-2">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="m in membersWithTeams"
            :key="m.id"
            class="flex items-center justify-between rounded-lg border p-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <Avatar class="h-8 w-8 shrink-0">
                <AvatarImage v-if="m.image" :src="m.image" :alt="m.name" />
                <AvatarFallback>{{ getInitials(m.name) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <p class="font-medium truncate">
                  {{ m.name || m.email }}
                  <span v-if="m.userId === currentUserId" class="text-xs text-muted-foreground">(you)</span>
                </p>
                <p class="text-xs text-muted-foreground truncate">{{ m.email }}</p>
                <div v-if="nonDefaultTeams(m.teams).length > 0" class="flex flex-wrap gap-1 mt-1">
                  <Badge
                    v-for="t in nonDefaultTeams(m.teams)"
                    :key="t.id"
                    variant="outline"
                    class="text-xs"
                  >
                    {{ t.name }}
                  </Badge>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <!-- Role dropdown for users with permission -->
              <template v-if="canChangeRole(m)">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" size="sm" class="capitalize" :disabled="updatingRoleMemberId === m.id">
                      <Icon v-if="updatingRoleMemberId === m.id" name="lucide:loader-2" class="h-3 w-3 mr-1 animate-spin" />
                      {{ m.role }}
                      <Icon name="lucide:chevron-down" class="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Change Role</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      v-for="role in getAvailableRoles()"
                      :key="role"
                      class="capitalize"
                      :class="{ 'bg-accent': m.role === role }"
                      @click="role !== m.role && updateMemberRole(m.id, role)"
                    >
                      {{ role }}
                      <Icon v-if="m.role === role" name="lucide:check" class="h-4 w-4 ml-auto" />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </template>
              <!-- Static badge for others -->
              <template v-else>
                <Badge data-testid="organization-member-role" variant="secondary" class="uppercase tracking-wide">
                  {{ m.role }}
                </Badge>
              </template>

              <!-- Remove button -->
              <Button
                v-if="canRemoveMember(m)"
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                @click="memberToRemove = m; showRemoveMemberDialog = true"
              >
                <Icon name="lucide:user-minus" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Pending Invitations -->
    <Card v-if="organizationDetails && canManageMembers && pendingInvitations.length > 0">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:mail" class="h-5 w-5" />
          Pending Invitations
        </CardTitle>
        <CardDescription>Outstanding invitations that have not yet been accepted.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <div
            v-for="inv in pendingInvitations"
            :key="inv.id"
            class="flex items-center justify-between rounded-lg border p-3"
          >
            <div class="min-w-0">
              <p class="font-medium truncate">{{ inv.email }}</p>
              <p class="text-xs text-muted-foreground">
                Invited as <span class="capitalize">{{ inv.role }}</span>
                <span v-if="inv.teamName"> to {{ inv.teamName }}</span>
                &middot; Expires {{ formatDate(inv.expiresAt) }}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="text-red-600 hover:text-red-700 shrink-0"
              :disabled="cancellingInvitationId === inv.id"
              @click="cancelInvitation(inv.id)"
            >
              <Icon v-if="cancellingInvitationId === inv.id" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
              <span v-else>Cancel</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Danger Zone -->
    <Card v-if="organizationDetails" class="border-red-200">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-red-600">
          <Icon name="lucide:alert-triangle" class="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>Permanently delete this workspace and all related data.</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="!canDeleteOrganization" class="text-sm text-muted-foreground mb-3">
          Only workspace owners can delete the workspace.
        </p>
        <Button
          data-testid="organization-open-delete-dialog"
          variant="destructive"
          :disabled="!canDeleteOrganization"
          @click="showDeleteDialog = true"
        >
          Delete Workspace
        </Button>
      </CardContent>
    </Card>

    <!-- Remove Member Dialog -->
    <Dialog :open="showRemoveMemberDialog" @update:open="showRemoveMemberDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove
            <strong>{{ memberToRemove?.name || memberToRemove?.email }}</strong>
            from this workspace? They will lose access to all workspace resources.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showRemoveMemberDialog = false; memberToRemove = null">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="isRemovingMember"
            @click="confirmRemoveMember"
          >
            <Icon v-if="isRemovingMember" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Remove Member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Invite Member Dialog -->
    <Dialog :open="showInviteDialog" @update:open="showInviteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>Send an invitation to join this workspace.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="invite-email">Email Address</Label>
            <Input id="invite-email" v-model="inviteEmail" type="email" placeholder="user@example.com" />
          </div>
          <div class="space-y-2">
            <Label>Role</Label>
            <div class="flex gap-2">
              <Button
                v-for="role in inviteRoleOptions"
                :key="role"
                :variant="inviteRole === role ? 'default' : 'outline'"
                size="sm"
                class="capitalize"
                @click="inviteRole = role"
              >
                {{ role }}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showInviteDialog = false">Cancel</Button>
          <Button
            :disabled="isInviting || !isValidInviteEmail"
            @click="inviteMember"
          >
            <Icon v-if="isInviting" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Organization Dialog -->
    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-red-600">Delete Workspace</DialogTitle>
          <DialogDescription>
            Type <strong>{{ organizationDetails?.slug }}</strong> to confirm permanent deletion.
          </DialogDescription>
        </DialogHeader>
        <div class="py-3">
          <Input
            data-testid="organization-delete-confirm-input"
            v-model="deleteConfirmation"
            placeholder="Enter organization slug"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
          <Button
            data-testid="organization-delete-submit"
            variant="destructive"
            :disabled="deleteConfirmation !== organizationDetails?.slug || isDeleting"
            @click="deleteOrganization"
          >
            <Icon v-if="isDeleting" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Delete Workspace
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
  name: 'SettingsOrganization',

  data() {
    return {
      session: null,
      organizationDetails: null,
      organizationName: '',
      organizationSlug: '',
      organizationLogo: '',
      membersWithTeams: [],
      pendingInvitations: [],
      isLoading: true,
      isLoadingMembers: false,
      isSaving: false,
      isDeleting: false,
      showDeleteDialog: false,
      deleteConfirmation: '',

      // Role change
      updatingRoleMemberId: null,

      // Remove member
      showRemoveMemberDialog: false,
      memberToRemove: null,
      isRemovingMember: false,

      // Invite
      showInviteDialog: false,
      inviteEmail: '',
      inviteRole: 'member',
      isInviting: false,

      // Cancel invitation
      cancellingInvitationId: null,
    }
  },

  computed: {
    canEditOrganization() {
      return ['owner', 'admin'].includes(this.organizationDetails?.currentUserRole || '')
    },

    canDeleteOrganization() {
      return this.organizationDetails?.currentUserRole === 'owner'
    },

    canManageMembers() {
      return ['owner', 'admin'].includes(this.organizationDetails?.currentUserRole || '')
    },

    isOwner() {
      return this.organizationDetails?.currentUserRole === 'owner'
    },

    currentUserId() {
      return this.session?.user?.id || null
    },

    isValidInviteEmail() {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.inviteEmail.trim())
    },

    inviteRoleOptions() {
      if (this.isOwner) return ['member', 'admin', 'owner']
      return ['member', 'admin']
    },

    hasChanges() {
      if (!this.organizationDetails) return false
      return (
        this.organizationName.trim() !== this.organizationDetails.name ||
        this.organizationSlug.trim() !== this.organizationDetails.slug ||
        (this.organizationLogo.trim() || null) !== this.organizationDetails.logo
      )
    },
  },

  async mounted() {
    await this.initialize()
  },

  methods: {
    async initialize() {
      try {
        const sessionResult = await authClient.useSession(useFetch)
        this.session = sessionResult.data.value

        await $fetch('/api/teams/active').catch(() => null)
        await this.loadOrganizationDetails()

        if (this.organizationDetails?.slug) {
          await Promise.all([this.loadMembersWithTeams(), this.loadPendingInvitations()])
        }
      } catch (error) {
        console.error('Error loading organization settings:', error)
        toast.error('Failed to load workspace settings')
      } finally {
        this.isLoading = false
      }
    },

    setFormValues() {
      if (!this.organizationDetails) return
      this.organizationName = this.organizationDetails.name || ''
      this.organizationSlug = this.organizationDetails.slug || ''
      this.organizationLogo = this.organizationDetails.logo || ''
    },

    nonDefaultTeams(teams) {
      if (!teams || !Array.isArray(teams)) return []
      return teams.filter((t) => t.name !== 'Default')
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

    async loadOrganizationDetails() {
      let activeOrg = null
      for (let attempt = 0; attempt < 5; attempt++) {
        activeOrg = await $fetch('/api/auth/organization/get-full-organization').catch(() => null)
        if (activeOrg?.id || activeOrg?.name) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      if (!activeOrg?.id && !activeOrg?.name) {
        this.organizationDetails = null
        return
      }

      let activeSlug = activeOrg?.slug || null
      if (!activeSlug) {
        const listedOrgs = await $fetch('/api/auth/organization/list').catch(() => null)
        const organizations = Array.isArray(listedOrgs) ? listedOrgs : listedOrgs?.data || []
        const matched = organizations.find((org) => org.id === activeOrg.id)
        activeSlug = matched?.slug || null
      }

      if (!activeSlug) {
        this.organizationDetails = {
          id: activeOrg.id || '',
          name: activeOrg.name || '',
          slug: '',
          logo: activeOrg.logo || null,
          memberCount: 0,
          currentUserRole: 'member',
          members: [],
        }
        this.setFormValues()
        return
      }

      const response = await $fetch(`/api/orgs/${activeSlug}`).catch(() => null)
      if (!response?.data) {
        this.organizationDetails = null
        return
      }
      this.organizationDetails = response.data
      this.setFormValues()
    },

    async loadMembersWithTeams() {
      if (!this.organizationDetails?.slug) return
      try {
        this.isLoadingMembers = true
        const response = await $fetch(`/api/orgs/${this.organizationDetails.slug}/members`)
        this.membersWithTeams = response?.data || []
      } catch (_error) {
        this.membersWithTeams = (this.organizationDetails?.members || []).map((m) => ({ ...m, teams: [] }))
      } finally {
        this.isLoadingMembers = false
      }
    },

    async loadPendingInvitations() {
      if (!this.organizationDetails?.slug || !this.canManageMembers) return
      try {
        const response = await $fetch(`/api/orgs/${this.organizationDetails.slug}/invitations`)
        this.pendingInvitations = response?.data || []
      } catch (_error) {
        this.pendingInvitations = []
      }
    },

    canChangeRole(m) {
      if (!this.canManageMembers) return false
      if (m.userId === this.currentUserId) return false
      if (this.isOwner) return true
      return m.role === 'member'
    },

    canRemoveMember(m) {
      if (m.userId === this.currentUserId) return false
      if (this.isOwner) return true
      if (this.organizationDetails?.currentUserRole === 'admin') {
        return m.role === 'member'
      }
      return false
    },

    getAvailableRoles() {
      if (this.isOwner) return ['owner', 'admin', 'member']
      return ['admin', 'member']
    },

    async updateMemberRole(memberId, newRole) {
      if (!this.organizationDetails?.id) return
      try {
        this.updatingRoleMemberId = memberId
        await authClient.organization.updateMemberRole({
          organizationId: this.organizationDetails.id,
          memberId,
          role: newRole,
        })
        const member = this.membersWithTeams.find((m) => m.id === memberId)
        if (member) member.role = newRole
        const orgMember = this.organizationDetails.members.find((m) => m.id === memberId)
        if (orgMember) orgMember.role = newRole
        toast.success('Member role updated')
      } catch (error) {
        console.error('Error updating member role:', error)
        toast.error(error?.data?.error?.message || 'Failed to update member role')
      } finally {
        this.updatingRoleMemberId = null
      }
    },

    async confirmRemoveMember() {
      if (!this.memberToRemove || !this.organizationDetails?.id) return
      try {
        this.isRemovingMember = true
        await authClient.organization.removeMember({
          organizationId: this.organizationDetails.id,
          memberIdOrEmail: this.memberToRemove.id,
        })
        this.membersWithTeams = this.membersWithTeams.filter((m) => m.id !== this.memberToRemove.id)
        this.organizationDetails.members = this.organizationDetails.members.filter(
          (m) => m.id !== this.memberToRemove.id
        )
        this.organizationDetails.memberCount--
        this.showRemoveMemberDialog = false
        this.memberToRemove = null
        toast.success('Member removed from workspace')
      } catch (error) {
        console.error('Error removing member:', error)
        toast.error(error?.data?.error?.message || 'Failed to remove member')
      } finally {
        this.isRemovingMember = false
      }
    },

    async inviteMember() {
      if (!this.inviteEmail.trim() || !this.organizationDetails?.id) return
      try {
        this.isInviting = true
        await authClient.organization.inviteMember({
          organizationId: this.organizationDetails.id,
          email: this.inviteEmail.trim(),
          role: this.inviteRole,
        })
        this.showInviteDialog = false
        this.inviteEmail = ''
        this.inviteRole = 'member'
        await this.loadPendingInvitations()
        toast.success('Invitation sent')
      } catch (error) {
        console.error('Error inviting member:', error)
        toast.error(error?.data?.error?.message || 'Failed to send invitation')
      } finally {
        this.isInviting = false
      }
    },

    async cancelInvitation(invitationId) {
      try {
        this.cancellingInvitationId = invitationId
        await authClient.organization.cancelInvitation({ invitationId })
        this.pendingInvitations = this.pendingInvitations.filter((inv) => inv.id !== invitationId)
        toast.success('Invitation cancelled')
      } catch (error) {
        console.error('Error cancelling invitation:', error)
        toast.error('Failed to cancel invitation')
      } finally {
        this.cancellingInvitationId = null
      }
    },

    async updateOrganization() {
      if (!this.organizationDetails?.slug || !this.canEditOrganization) return

      try {
        this.isSaving = true
        const response = await $fetch(`/api/orgs/${this.organizationDetails.slug}`, {
          method: 'PUT',
          body: {
            name: this.organizationName.trim(),
            slug: this.organizationSlug.trim(),
            logo: this.organizationLogo.trim() || null,
          },
        })
        this.organizationDetails = response.data
        this.setFormValues()
        toast.success('Workspace updated')
      } catch (error) {
        console.error('Error updating organization:', error)
        toast.error(error?.data?.error?.message || error?.statusMessage || 'Failed to update workspace')
      } finally {
        this.isSaving = false
      }
    },

    async deleteOrganization() {
      if (!this.organizationDetails?.slug || !this.canDeleteOrganization) return
      try {
        this.isDeleting = true
        await $fetch(`/api/orgs/${this.organizationDetails.slug}`, {
          method: 'DELETE',
          body: {
            confirmSlug: this.deleteConfirmation.trim(),
          },
        })
        this.showDeleteDialog = false
        this.deleteConfirmation = ''
        this.organizationDetails = null
        toast.success('Workspace deleted')
        await navigateTo('/settings#team')
      } catch (error) {
        console.error('Error deleting organization:', error)
        toast.error(error?.data?.error?.message || error?.statusMessage || 'Failed to delete workspace')
      } finally {
        this.isDeleting = false
      }
    },

    formatDate(date) {
      return new Date(date).toLocaleDateString()
    },
  },
}
</script>
