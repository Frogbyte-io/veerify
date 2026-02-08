<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            :disabled="isLoadingOrganizations || !!organizationsError"
          >
            <!-- Loading state -->
            <div
              v-if="isLoadingOrganizations"
              class="flex aspect-square size-8 items-center justify-center rounded-lg"
            >
              <Skeleton class="size-8 rounded-lg" />
            </div>
            <!-- Active organization -->
            <div
              v-else-if="activeOrganization"
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
            >
              <Icon name="lucide:building" class="size-4" />
            </div>
            <!-- Error state -->
            <div
              v-else-if="organizationsError"
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-red-500 text-white"
            >
              <Icon name="lucide:alert-circle" class="size-4" />
            </div>
            <!-- No organization (valid state) -->
            <div
              v-else
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
            >
              <Icon name="lucide:building" class="size-4" />
            </div>

            <div class="grid flex-1 text-left text-sm leading-tight">
              <!-- Loading state -->
              <template v-if="isLoadingOrganizations">
                <span class="truncate">
                  <Skeleton class="h-4 w-20" />
                </span>
                <span class="truncate text-xs mt-1">
                  <Skeleton class="h-3 w-16" />
                </span>
              </template>

              <!-- Active organization -->
              <template v-else-if="activeOrganization">
                <span class="truncate font-semibold">
                  {{ activeOrganization.name }}
                </span>
                <span class="truncate text-xs">{{ activeOrganization.slug }}</span>
              </template>

              <!-- Error state -->
              <template v-else-if="organizationsError">
                <span class="truncate font-semibold text-red-500"> Error loading organizations </span>
                <span class="truncate text-xs text-red-400">Please refresh</span>
              </template>

              <!-- No organization selected (valid state) -->
              <template v-else>
                <span class="truncate font-semibold"> Select organization </span>
                <span class="truncate text-xs text-muted-foreground">No organization active</span>
              </template>
            </div>
            <Icon name="lucide:chevrons-up-down" class="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-[--reka-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          align="start"
          :side="isMobile ? 'bottom' : 'right'"
          :side-offset="4"
        >
          <DropdownMenuLabel class="text-xs text-muted-foreground"> Organizations </DropdownMenuLabel>

          <!-- Show loading state -->
          <div v-if="isLoadingOrganizations" class="p-2">
            <div class="flex items-center gap-2">
              <Skeleton class="size-6 rounded" />
              <Skeleton class="h-4 w-20" />
            </div>
          </div>

          <!-- Show error state -->
          <div v-else-if="organizationsError" class="p-2">
            <div class="flex items-center gap-2 text-red-500">
              <Icon name="lucide:alert-circle" class="size-4" />
              <span class="text-sm">{{ organizationsError }}</span>
            </div>
            <DropdownMenuItem class="gap-2 p-2 mt-2" @click="refreshOrganizations">
              <Icon name="lucide:refresh-cw" class="size-4" />
              <span class="text-sm">Retry</span>
            </DropdownMenuItem>
          </div>

          <!-- Show organizations -->
          <DropdownMenuItem
            v-for="(organization, index) in organizations"
            v-else
            :key="organization.id"
            class="gap-2 p-2"
            @click="setActiveOrganization(organization)"
          >
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Icon name="lucide:building" class="size-4 shrink-0" />
            </div>
            {{ organization.name }}
            <DropdownMenuShortcut>⌘{{ index + 1 }}</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuSeparator v-if="!organizationsError && !isLoadingOrganizations" />
          <DropdownMenuItem
            v-if="!organizationsError && !isLoadingOrganizations"
            class="gap-2 p-2"
            @click="createNewOrganization"
          >
            <div class="flex size-6 items-center justify-center rounded-md border bg-background">
              <Icon name="lucide:plus" class="size-4" />
            </div>
            <div class="font-medium text-muted-foreground">Add organization</div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'TeamSwitcher',

  data() {
    return {
      organizations: [],
      activeOrganization: null,
      isLoadingOrganizations: true,
      organizationsError: null,
    }
  },

  computed: {
    isMobile() {
      if (import.meta.client) {
        return window.innerWidth < 768
      }
      return false
    },
  },

  async mounted() {
    await this.initializeOrganizations()
  },

  methods: {
    async initializeOrganizations() {
      try {
        const { data: organizations } = authClient.useListOrganizations()
        this.organizations = organizations.value || []

        watch(organizations, (newOrganizations) => {
          this.organizations = newOrganizations || []
          this.isLoadingOrganizations = false
          this.organizationsError = null
        })

        const { data: activeOrganization } = authClient.useActiveOrganization()
        this.activeOrganization = activeOrganization.value

        watch(activeOrganization, (newActiveOrganization) => {
          this.activeOrganization = newActiveOrganization
        })

        this.isLoadingOrganizations = false
      } catch (error) {
        console.error('Error loading organizations:', error)
        this.organizationsError = 'Failed to load organizations'
        this.isLoadingOrganizations = false
      }
    },

    async setActiveOrganization(organization) {
      try {
        await authClient.organization.setActive({
          organizationId: organization.id,
        })
        console.log('Active organization set to:', organization.name)
      } catch (error) {
        console.error('Error setting active organization:', error)
      }
    },

    async createNewOrganization() {
      try {
        await navigateTo('/organization/create')
      } catch (_error) {
        alert('Organization creation coming soon!')
      }
    },

    async refreshOrganizations() {
      this.organizationsError = null
      this.isLoadingOrganizations = true
      await this.initializeOrganizations()
    },
  },
}
</script>
