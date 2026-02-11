<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            data-testid="team-switcher-trigger"
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            :disabled="isLoadingTeams"
          >
            <div
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
            >
              <Icon v-if="isLoadingTeams" name="lucide:loader-2" class="size-4 animate-spin" />
              <Icon v-else name="lucide:users" class="size-4" />
            </div>

            <div class="grid flex-1 text-left text-sm leading-tight">
              <template v-if="isLoadingTeams">
                <span class="truncate">Loading teams...</span>
                <span class="truncate text-xs text-muted-foreground">Please wait</span>
              </template>

              <template v-else-if="activeTeam">
                <span data-testid="team-switcher-active-name" class="truncate font-semibold">{{ activeTeam.name }}</span>
                <span data-testid="team-switcher-active-org" class="truncate text-xs text-muted-foreground">
                  {{ activeOrganization?.name || 'No governance context' }}
                </span>
              </template>

              <template v-else-if="teamsError">
                <span class="truncate font-semibold text-red-500"> Error loading teams </span>
                <span class="truncate text-xs text-red-400">Please refresh</span>
              </template>

              <template v-else>
                <span class="truncate font-semibold"> Select team </span>
                <span class="truncate text-xs text-muted-foreground">No team active</span>
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
          <DropdownMenuLabel class="text-xs text-muted-foreground"> Teams </DropdownMenuLabel>

          <div v-if="isLoadingTeams" class="p-2">
            <div class="flex items-center gap-2 text-muted-foreground">
              <Icon name="lucide:loader-2" class="size-4 animate-spin" />
              <span class="text-sm">Loading teams...</span>
            </div>
          </div>

          <div v-else-if="teamsError" class="p-2">
            <div class="flex items-center gap-2 text-red-500">
              <Icon name="lucide:alert-circle" class="size-4" />
              <span class="text-sm">{{ teamsError }}</span>
            </div>
            <DropdownMenuItem class="gap-2 p-2 mt-2" @click="refreshTeams">
              <Icon name="lucide:refresh-cw" class="size-4" />
              <span class="text-sm">Retry</span>
            </DropdownMenuItem>
          </div>

          <template v-else>
            <DropdownMenuItem v-for="team in teams" :key="team.id" class="gap-2 p-2" @click="setActiveTeam(team)">
              <div class="flex size-6 items-center justify-center rounded-sm border">
                <Icon name="lucide:users" class="size-4 shrink-0" />
              </div>
              <span :data-testid="`team-switcher-item-${team.id}`">{{ team.name }}</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="team-switcher-manage" class="gap-2 p-2" @click="goToTeamSettings">
              <div class="flex size-6 items-center justify-center rounded-md border bg-background">
                <Icon name="lucide:settings" class="size-4" />
              </div>
              <div class="font-medium text-muted-foreground">Manage teams</div>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script>
const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'TeamSwitcher',

  data() {
    return {
      teams: [],
      activeTeam: null,
      activeOrganization: null,
      isLoadingTeams: true,
      teamsError: null,
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
    await this.initializeTeams()
  },

  methods: {
    emitActiveTeamChanged() {
      if (!import.meta.client) return

      window.dispatchEvent(
        new CustomEvent(ACTIVE_TEAM_CHANGED_EVENT, {
          detail: { teamId: this.activeTeam?.id || null },
        })
      )
    },

    async loadActiveTeam() {
      const response = await $fetch('/api/teams/active')
      this.activeTeam = response?.data || null
      return this.activeTeam
    },

    async loadTeams() {
      const response = await $fetch('/api/auth/organization/list-user-teams')
      this.teams = Array.isArray(response) ? response : response?.data || []
      return this.teams
    },

    async loadActiveOrganization() {
      try {
        const response = await $fetch('/api/auth/organization/get-full-organization')
        this.activeOrganization = response || null
      } catch {
        this.activeOrganization = null
      }
      return this.activeOrganization
    },

    async initializeTeams() {
      try {
        await this.loadActiveTeam()
        await this.loadTeams()
        await this.loadActiveOrganization()

        this.isLoadingTeams = false
        this.teamsError = null
      } catch (error) {
        console.error('Error loading teams:', error)
        this.teamsError = 'Failed to load teams'
        this.isLoadingTeams = false
      }
    },

    async setActiveTeam(team) {
      try {
        await $fetch('/api/teams/active', {
          method: 'POST',
          body: { teamId: team.id },
        })
        await this.initializeTeams()
        this.emitActiveTeamChanged()
      } catch (error) {
        console.error('Error setting active team:', error)
        this.teamsError = 'Failed to switch team'
      }
    },

    async goToTeamSettings() {
      await navigateTo('/settings#team')
    },

    async refreshTeams() {
      this.teamsError = null
      this.isLoadingTeams = true
      await this.initializeTeams()
    },
  },
}
</script>
