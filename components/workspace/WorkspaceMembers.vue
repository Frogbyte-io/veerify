<template>
  <div class="space-y-6">
    <!-- Members -->
    <Card data-testid="workspace-members">
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:users" class="h-5 w-5" />
              Members
            </CardTitle>
            <CardDescription
              >Manage workspace members and their roles. Project access is set per project.</CardDescription
            >
          </div>
          <Button v-if="canManageMembers" size="sm" @click="showInviteDialog = true">
            <Icon name="lucide:user-plus" class="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p v-if="!canManageMembers" class="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon name="lucide:lock" class="h-3.5 w-3.5" />
          Only workspace owners and admins can change this.
        </p>
        <p data-testid="organization-members-count" class="text-sm text-muted-foreground mb-4">
          {{ members.length }} member{{ members.length !== 1 ? 's' : '' }}
        </p>

        <div v-if="isLoadingMembers" class="space-y-2">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <div v-else class="space-y-2">
          <div v-for="m in members" :key="m.id" class="flex items-center justify-between rounded-lg border p-3">
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
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <!-- Role dropdown for users with permission -->
              <template v-if="canChangeRole(m)">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" size="sm" class="capitalize" :disabled="updatingRoleMemberId === m.id">
                      <Icon
                        v-if="updatingRoleMemberId === m.id"
                        name="lucide:loader-2"
                        class="h-3 w-3 mr-1 animate-spin"
                      />
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
                @click="openRemoveMemberDialog(m)"
              >
                <Icon name="lucide:user-minus" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Pending Invitations -->
    <Card v-if="canManageMembers && pendingInvitations.length > 0">
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
                Invited as <span class="capitalize">{{ inv.role }}</span> &middot; Sent
                {{ formatDate(inv.createdAt) }} &middot; Expires {{ formatDate(inv.expiresAt) }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                :disabled="resendingInvitationId === inv.id || cancellingInvitationId === inv.id"
                @click="resendInvitation(inv)"
              >
                <Icon v-if="resendingInvitationId === inv.id" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
                <span v-else>Send reminder</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-red-600 hover:text-red-700"
                :disabled="cancellingInvitationId === inv.id || resendingInvitationId === inv.id"
                @click="cancelInvitation(inv.id)"
              >
                <Icon v-if="cancellingInvitationId === inv.id" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
                <span v-else>Revoke</span>
              </Button>
            </div>
          </div>
        </div>
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
          <Button variant="outline" @click="closeRemoveMemberDialog">Cancel</Button>
          <Button variant="destructive" :disabled="isRemovingMember" @click="confirmRemoveMember">
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
          <Button :disabled="isInviting || !isValidInviteEmail" @click="inviteMember">
            <Icon v-if="isInviting" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            Send Invitation
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
  name: 'WorkspaceMembers',

  props: {
    /** Workspace details from `/api/orgs/[slug]` (includes `currentUserRole`). */
    organization: { type: Object, required: true },
  },

  data() {
    return {
      session: null,
      members: [],
      pendingInvitations: [],
      isLoadingMembers: true,

      updatingRoleMemberId: null,

      showRemoveMemberDialog: false,
      memberToRemove: null,
      isRemovingMember: false,

      showInviteDialog: false,
      inviteEmail: '',
      inviteRole: 'member',
      isInviting: false,

      cancellingInvitationId: null,
      resendingInvitationId: null,
    }
  },

  computed: {
    canManageMembers() {
      return ['owner', 'admin'].includes(this.organization?.currentUserRole || '')
    },

    isOwner() {
      return this.organization?.currentUserRole === 'owner'
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
  },

  async mounted() {
    const sessionResult = await authClient.useSession(useFetch)
    this.session = sessionResult.data.value
    await Promise.all([this.loadMembers(), this.loadPendingInvitations()])
  },

  methods: {
    getInitials(name) {
      if (!name) return '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },

    async loadMembers() {
      try {
        this.isLoadingMembers = true
        const response = await $fetch(`/api/orgs/${this.organization.slug}/members`)
        this.members = response?.data || []
      } catch (_error) {
        this.members = this.organization?.members || []
      } finally {
        this.isLoadingMembers = false
      }
    },

    async loadPendingInvitations() {
      if (!this.organization?.slug || !this.canManageMembers) return
      try {
        const response = await $fetch(`/api/orgs/${this.organization.slug}/invitations`)
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
      if (this.organization?.currentUserRole === 'admin') {
        return m.role === 'member'
      }
      return false
    },

    openRemoveMemberDialog(member) {
      this.memberToRemove = member
      this.showRemoveMemberDialog = true
    },

    closeRemoveMemberDialog() {
      this.showRemoveMemberDialog = false
      this.memberToRemove = null
    },

    getAvailableRoles() {
      if (this.isOwner) return ['owner', 'admin', 'member']
      return ['admin', 'member']
    },

    async updateMemberRole(memberId, newRole) {
      if (!this.organization?.id) return
      try {
        this.updatingRoleMemberId = memberId
        await authClient.organization.updateMemberRole({
          organizationId: this.organization.id,
          memberId,
          role: newRole,
        })
        const member = this.members.find((m) => m.id === memberId)
        if (member) member.role = newRole
        toast.success('Member role updated')
      } catch (error) {
        console.error('Error updating member role:', error)
        toast.error(error?.data?.error?.message || 'Failed to update member role')
      } finally {
        this.updatingRoleMemberId = null
      }
    },

    async confirmRemoveMember() {
      if (!this.memberToRemove || !this.organization?.id) return
      try {
        this.isRemovingMember = true
        await authClient.organization.removeMember({
          organizationId: this.organization.id,
          memberIdOrEmail: this.memberToRemove.id,
        })
        this.members = this.members.filter((m) => m.id !== this.memberToRemove.id)
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
      if (!this.inviteEmail.trim() || !this.organization?.id) return
      try {
        this.isInviting = true
        await $fetch('/api/organizations/invite', {
          method: 'POST',
          body: {
            organizationId: this.organization.id,
            email: this.inviteEmail.trim(),
            role: this.inviteRole,
          },
        })
        this.showInviteDialog = false
        this.inviteEmail = ''
        this.inviteRole = 'member'
        await this.loadPendingInvitations()
        toast.success('Invitation sent')
      } catch (error) {
        console.error('Error inviting member:', error)
        const message =
          error?.statusMessage ||
          error?.data?.statusMessage ||
          error?.data?.error?.message ||
          'Failed to send invitation'
        const steps = error?.data?.data?.recommendedSteps
        const hint = steps ? `\n${steps[0]}` : ''
        toast.error(message + hint)
      } finally {
        this.isInviting = false
      }
    },

    async cancelInvitation(invitationId) {
      try {
        this.cancellingInvitationId = invitationId
        await authClient.organization.cancelInvitation({ invitationId })
        this.pendingInvitations = this.pendingInvitations.filter((inv) => inv.id !== invitationId)
        toast.success('Invitation revoked')
      } catch (error) {
        console.error('Error cancelling invitation:', error)
        toast.error('Failed to cancel invitation')
      } finally {
        this.cancellingInvitationId = null
      }
    },

    async resendInvitation(invitation) {
      if (!this.organization?.id) return
      try {
        this.resendingInvitationId = invitation.id
        await $fetch('/api/organizations/invite', {
          method: 'POST',
          body: {
            organizationId: this.organization.id,
            email: invitation.email,
            role: invitation.role,
            resend: true,
          },
        })
        await this.loadPendingInvitations()
        toast.success('Invitation reminder sent')
      } catch (error) {
        console.error('Error resending invitation:', error)
        const message =
          error?.statusMessage ||
          error?.data?.statusMessage ||
          error?.data?.error?.message ||
          'Failed to resend invitation'
        toast.error(message)
      } finally {
        this.resendingInvitationId = null
      }
    },

    formatDate(date) {
      return new Date(date).toLocaleDateString()
    },
  },
}
</script>
