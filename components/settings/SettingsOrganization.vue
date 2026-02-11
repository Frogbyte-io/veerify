<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:building-2" class="h-5 w-5" />
          <span data-testid="organization-title">Organization Settings</span>
        </CardTitle>
        <CardDescription>Manage your organization profile and URL namespace.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>

        <div v-else-if="!organizationDetails" class="text-sm text-muted-foreground">
          No active organization context is available.
        </div>

        <template v-else>
          <div class="space-y-2">
            <Label for="organization-name">Organization Name</Label>
            <Input
              id="organization-name"
              data-testid="organization-name-input"
              v-model="organizationName"
              :disabled="!canEditOrganization || isSaving"
              placeholder="Organization name"
            />
          </div>

          <div class="space-y-2">
            <Label for="organization-slug">Organization Slug</Label>
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
              Only owners and admins can update organization details.
            </p>
            <div class="ml-auto">
              <Button
                data-testid="organization-save"
                :disabled="!canEditOrganization || !hasChanges || isSaving"
                @click="updateOrganization"
              >
                <Icon v-if="isSaving" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
                Save Organization
              </Button>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <Card v-if="organizationDetails">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:users" class="h-5 w-5" />
          Members
        </CardTitle>
        <CardDescription>Read-only membership overview for this organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <p data-testid="organization-members-count" class="text-sm text-muted-foreground mb-4">
          {{ organizationDetails.memberCount }} members
        </p>

        <div class="space-y-2">
          <div
            v-for="member in organizationDetails.members"
            :key="member.id"
            class="flex items-center justify-between rounded-lg border p-3"
          >
            <div class="min-w-0">
              <p class="font-medium truncate">{{ member.name || member.email }}</p>
              <p class="text-xs text-muted-foreground truncate">{{ member.email }}</p>
            </div>
            <Badge data-testid="organization-member-role" variant="secondary" class="uppercase tracking-wide">
              {{ member.role }}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card v-if="organizationDetails" class="border-red-200">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-red-600">
          <Icon name="lucide:alert-triangle" class="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>Permanently delete this organization and all related data.</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="!canDeleteOrganization" class="text-sm text-muted-foreground mb-3">
          Only organization owners can delete the organization.
        </p>
        <Button
          data-testid="organization-open-delete-dialog"
          variant="destructive"
          :disabled="!canDeleteOrganization"
          @click="showDeleteDialog = true"
        >
          Delete Organization
        </Button>
      </CardContent>
    </Card>

    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-red-600">Delete Organization</DialogTitle>
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
            Delete Organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'SettingsOrganization',

  data() {
    return {
      organizationDetails: null,
      organizationName: '',
      organizationSlug: '',
      organizationLogo: '',
      isLoading: true,
      isSaving: false,
      isDeleting: false,
      showDeleteDialog: false,
      deleteConfirmation: '',
    }
  },

  computed: {
    canEditOrganization() {
      return ['owner', 'admin'].includes(this.organizationDetails?.currentUserRole || '')
    },

    canDeleteOrganization() {
      return this.organizationDetails?.currentUserRole === 'owner'
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
        await $fetch('/api/teams/active').catch(() => null)
        await this.loadOrganizationDetails()
      } catch (error) {
        console.error('Error loading organization settings:', error)
        toast.error('Failed to load organization settings')
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
        toast.success('Organization updated')
      } catch (error) {
        console.error('Error updating organization:', error)
        toast.error(error?.data?.error?.message || error?.statusMessage || 'Failed to update organization')
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
        toast.success('Organization deleted')
        await navigateTo('/settings#team')
      } catch (error) {
        console.error('Error deleting organization:', error)
        toast.error(error?.data?.error?.message || error?.statusMessage || 'Failed to delete organization')
      } finally {
        this.isDeleting = false
      }
    },
  },
}
</script>
