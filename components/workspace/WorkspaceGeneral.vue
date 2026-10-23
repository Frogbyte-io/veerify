<template>
  <div class="space-y-6">
    <!-- Organization Details -->
    <Card data-testid="workspace-general">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:building-2" class="h-5 w-5" />
          <span data-testid="organization-title">General</span>
        </CardTitle>
        <CardDescription
          >Your workspace holds your projects and people. Its URL slug is also the subdomain of your public
          pages.</CardDescription
        >
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>

        <div v-else-if="!organization" class="flex flex-col items-center gap-4 py-8 text-center">
          <div class="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
            <Icon name="lucide:building-2" class="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p class="font-medium">No workspace yet</p>
            <p class="text-sm text-muted-foreground mt-1">
              Create a workspace to collect feedback, manage your roadmap, and collaborate with others.
            </p>
          </div>
          <Button as-child>
            <NuxtLink to="/get-started">
              <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
              Create a workspace
            </NuxtLink>
          </Button>
        </div>

        <template v-else>
          <div class="space-y-2">
            <Label for="organization-name">Workspace Name</Label>
            <Input
              id="organization-name"
              v-model="organizationName"
              data-testid="organization-name-input"
              :disabled="!canEditOrganization || isSaving"
              placeholder="Workspace name"
            />
          </div>

          <div class="space-y-2">
            <Label for="organization-slug">Workspace URL</Label>
            <Input
              id="organization-slug"
              v-model="organizationSlug"
              data-testid="organization-slug-input"
              :disabled="!canEditOrganization || isSaving"
              placeholder="workspace-slug"
            />
            <p v-if="publicHost" class="text-xs text-muted-foreground" data-testid="workspace-public-host">
              Public pages live at <span class="font-mono">{{ publicHost }}</span>
            </p>
            <p class="text-xs text-amber-600">Changing the slug changes the public subdomain of every project.</p>
          </div>

          <div class="space-y-2">
            <Label>Logo</Label>
            <div class="flex items-center gap-4">
              <button
                type="button"
                :disabled="!canEditOrganization || isSaving"
                class="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted transition-colors hover:border-primary hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-50"
                @click="$refs.logoFileInput.click()"
              >
                <img
                  v-if="logoPreviewUrl || (organizationLogo && !removeLogo)"
                  :src="logoPreviewUrl || organizationLogo"
                  alt="Organization logo"
                  class="h-full w-full object-cover"
                />
                <span v-else class="flex flex-col items-center gap-1 text-muted-foreground group-hover:text-primary">
                  <Icon name="lucide:image-plus" class="h-5 w-5" />
                </span>
                <div
                  class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Icon name="lucide:upload" class="h-4 w-4 text-white" />
                </div>
              </button>

              <input
                ref="logoFileInput"
                :key="logoInputKey"
                data-testid="organization-logo-upload-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                class="hidden"
                :disabled="!canEditOrganization || isSaving"
                @change="handleLogoFileSelect"
              />

              <div class="flex flex-col gap-1.5">
                <p class="text-sm font-medium">
                  <span v-if="logoFile">{{ logoFile.name }}</span>
                  <span v-else-if="organizationLogo && !removeLogo" class="text-muted-foreground">Logo uploaded</span>
                  <span v-else class="text-muted-foreground">No logo</span>
                </p>
                <p class="text-xs text-muted-foreground">JPEG, PNG, or WebP. Max 2 MB.</p>
                <div class="flex gap-2">
                  <Button
                    v-if="logoFile"
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="organization-logo-clear-selection"
                    @click="clearSelectedLogoFile"
                  >
                    Clear
                  </Button>
                  <Button
                    v-if="showLogoRemoveButton"
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="organization-logo-remove"
                    @click="markLogoForRemoval"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3">
            <p v-if="!canEditOrganization" class="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Icon name="lucide:lock" class="h-3.5 w-3.5" />
              Only workspace owners and admins can change this.
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

    <!-- Danger Zone -->
    <Card v-if="organization" class="border-red-200">
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

    <!-- Delete Organization Dialog -->
    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-red-600">Delete Workspace</DialogTitle>
          <DialogDescription>
            Type <strong>{{ organization?.slug }}</strong> to confirm permanent deletion.
          </DialogDescription>
        </DialogHeader>
        <div class="py-3">
          <Input
            v-model="deleteConfirmation"
            data-testid="organization-delete-confirm-input"
            placeholder="Enter workspace slug"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
          <Button
            data-testid="organization-delete-submit"
            variant="destructive"
            :disabled="deleteConfirmation !== organization?.slug || isDeleting"
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
import { toast } from 'vue-sonner'
import { clearDashboardBootstrapCache } from '~/lib/dashboard-bootstrap-client'

const LOGO_IMAGE_RULES = {
  maxBytes: 2 * 1024 * 1024,
}

export default {
  name: 'WorkspaceGeneral',

  props: {
    /** Workspace details from `/api/orgs/[slug]` (includes `currentUserRole`); null = no workspace. */
    organization: { type: Object, default: null },
    isLoading: { type: Boolean, default: false },
  },

  emits: ['updated'],

  data() {
    return {
      organizationName: '',
      organizationSlug: '',
      organizationLogo: '',
      logoFile: null,
      logoPreviewUrl: '',
      removeLogo: false,
      logoInputKey: 0,
      isSaving: false,
      isDeleting: false,
      showDeleteDialog: false,
      deleteConfirmation: '',
    }
  },

  computed: {
    canEditOrganization() {
      return ['owner', 'admin'].includes(this.organization?.currentUserRole || '')
    },

    canDeleteOrganization() {
      return this.organization?.currentUserRole === 'owner'
    },

    // Default public subdomain: <slug>.<appDomain>
    publicHost() {
      const slug = this.organizationSlug.trim()
      const appDomain = useRuntimeConfig().public.appDomain
      if (!slug || !appDomain) return ''
      return `${slug}.${appDomain}`
    },

    hasChanges() {
      if (!this.organization) return false
      return (
        this.organizationName.trim() !== this.organization.name ||
        this.organizationSlug.trim() !== this.organization.slug ||
        (this.organizationLogo.trim() || null) !== this.organization.logo ||
        Boolean(this.logoFile) ||
        (this.removeLogo && Boolean(this.organization.logo))
      )
    },

    showLogoRemoveButton() {
      return (this.organization?.logo || this.logoPreviewUrl) && !this.removeLogo
    },
  },

  watch: {
    organization: {
      immediate: true,
      handler() {
        this.setFormValues()
      },
    },
  },

  beforeUnmount() {
    this.revokeLogoPreview()
  },

  methods: {
    setFormValues() {
      if (!this.organization) return
      this.organizationName = this.organization.name || ''
      this.organizationSlug = this.organization.slug || ''
      this.organizationLogo = this.organization.logo || ''
      this.resetLogoSelection()
    },

    resetLogoSelection() {
      this.revokeLogoPreview()
      this.logoFile = null
      this.removeLogo = false
      this.clearLogoFileInput()
    },

    revokeLogoPreview() {
      if (!import.meta.client) return
      if (this.logoPreviewUrl) {
        URL.revokeObjectURL(this.logoPreviewUrl)
        this.logoPreviewUrl = ''
      }
    },

    clearLogoFileInput() {
      this.logoInputKey += 1
    },

    validateLogoFile(file) {
      if (!file) return false

      const contentType = (file.type || '').toLowerCase()
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        toast.error('Only JPEG, PNG, and WebP files are supported')
        return false
      }

      if (file.size > LOGO_IMAGE_RULES.maxBytes) {
        toast.error('Selected logo file exceeds 2 MB')
        return false
      }

      return true
    },

    handleLogoFileSelect(event) {
      const file = event?.target?.files?.[0]
      if (!file) return
      if (!this.validateLogoFile(file)) {
        this.clearLogoFileInput()
        return
      }

      this.revokeLogoPreview()
      this.logoFile = file
      this.logoPreviewUrl = import.meta.client ? URL.createObjectURL(file) : ''
      this.removeLogo = false
    },

    clearSelectedLogoFile() {
      this.revokeLogoPreview()
      this.logoFile = null
      this.clearLogoFileInput()
    },

    markLogoForRemoval() {
      this.clearSelectedLogoFile()
      this.removeLogo = true
      this.organizationLogo = ''
    },

    async uploadSelectedLogo(file) {
      const contentType = (file.type || '').toLowerCase()
      const presignResponse = await $fetch(`/api/orgs/${this.organization.slug}/assets/presign`, {
        method: 'POST',
        body: {
          kind: 'logo',
          filename: file.name || 'logo.webp',
          contentType,
          sizeBytes: file.size,
        },
      })

      const uploadTarget = presignResponse?.data
      if (!uploadTarget?.uploadId || !uploadTarget?.uploadUrl) {
        throw new Error('Upload target response is invalid')
      }

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: uploadTarget.method || 'PUT',
        headers: {
          ...(uploadTarget.headers || {}),
          'content-type': contentType,
        },
        body: file,
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed (${uploadResponse.status})`)
      }

      return uploadTarget.uploadId
    },

    async updateOrganization() {
      if (!this.organization?.slug || !this.canEditOrganization) return

      try {
        this.isSaving = true
        let logoUploadId = null
        if (this.logoFile) {
          logoUploadId = await this.uploadSelectedLogo(this.logoFile)
        }

        const response = await $fetch(`/api/orgs/${this.organization.slug}`, {
          method: 'PUT',
          body: {
            name: this.organizationName.trim(),
            slug: this.organizationSlug.trim(),
            logo: this.removeLogo ? null : this.organizationLogo.trim() || null,
            ...(logoUploadId ? { logoUploadId } : {}),
          },
        })
        this.$emit('updated', response.data)
        toast.success('Workspace updated')
      } catch (error) {
        console.error('Error updating organization:', error)
        toast.error(error?.data?.error?.message || error?.statusMessage || 'Failed to update workspace')
      } finally {
        this.isSaving = false
      }
    },

    async deleteOrganization() {
      if (!this.organization?.slug || !this.canDeleteOrganization) return
      try {
        this.isDeleting = true
        await $fetch(`/api/orgs/${this.organization.slug}`, {
          method: 'DELETE',
          body: {
            confirmSlug: this.deleteConfirmation.trim(),
          },
        })
        this.showDeleteDialog = false
        this.deleteConfirmation = ''
        toast.success('Workspace deleted')
        this.$emit('updated', null)
        // Another workspace may still be available: land in its active project instead of onboarding.
        clearDashboardBootstrapCache()
        const next = await $fetch('/api/projects/active').catch(() => null)
        if (import.meta.client) window.dispatchEvent(new CustomEvent('veerify:active-project-changed'))
        await navigateTo(next?.data?.project ? '/dashboard' : '/get-started')
      } catch (error) {
        console.error('Error deleting organization:', error)
        toast.error(error?.data?.error?.message || error?.statusMessage || 'Failed to delete workspace')
      } finally {
        this.isDeleting = false
      }
    },
  },
}
</script>
