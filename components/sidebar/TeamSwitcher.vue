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
              <span :data-testid="`team-switcher-item-${team.id}`" class="flex-1">{{ team.name }}</span>
              <Icon v-if="activeTeam?.id === team.id" name="lucide:check" class="size-4 text-primary" />
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
import { authClient } from '~/lib/auth-client'

const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'
const TEAM_SWITCHER_CACHE_MAX_AGE_MS = 5 * 60 * 1000

const teamSwitcherCache = {
  teams: [],
  activeTeam: null,
  activeOrganization: null,
  loadedAt: 0,
  pendingRequest: null,
}

function hasCachedTeamContext() {
  return import.meta.client && teamSwitcherCache.loadedAt > 0
}

function isTeamContextCacheFresh() {
  return hasCachedTeamContext() && Date.now() - teamSwitcherCache.loadedAt < TEAM_SWITCHER_CACHE_MAX_AGE_MS
}

function clearTeamContextCache() {
  teamSwitcherCache.teams = []
  teamSwitcherCache.activeTeam = null
  teamSwitcherCache.activeOrganization = null
  teamSwitcherCache.loadedAt = 0
}

export default {
  name: 'TeamSwitcher',

  data() {
    const hasCachedData = hasCachedTeamContext()
    return {
      teams: hasCachedData ? teamSwitcherCache.teams : [],
      activeTeam: hasCachedData ? teamSwitcherCache.activeTeam : null,
      activeOrganization: hasCachedData ? teamSwitcherCache.activeOrganization : null,
      isLoadingTeams: !hasCachedData,
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
    applyTeamContextFromCache() {
      this.teams = teamSwitcherCache.teams
      this.activeTeam = teamSwitcherCache.activeTeam
      this.activeOrganization = teamSwitcherCache.activeOrganization
      this.isLoadingTeams = false
    },

    async fetchTeamContext() {
      const [activeTeamResponse, teamsResponse, activeOrganizationResponse] = await Promise.all([
        $fetch('/api/teams/active'),
        $fetch('/api/auth/organization/list-user-teams'),
        $fetch('/api/auth/organization/get-full-organization').catch(() => null),
      ])

      return {
        activeTeam: activeTeamResponse?.data || null,
        teams: Array.isArray(teamsResponse) ? teamsResponse : teamsResponse?.data || [],
        activeOrganization: activeOrganizationResponse || null,
      }
    },

    async fetchAndCacheTeamContext() {
      if (!teamSwitcherCache.pendingRequest) {
        teamSwitcherCache.pendingRequest = this.fetchTeamContext()
          .then((context) => {
            teamSwitcherCache.activeTeam = context.activeTeam
            teamSwitcherCache.teams = context.teams
            teamSwitcherCache.activeOrganization = context.activeOrganization
            teamSwitcherCache.loadedAt = Date.now()
            return context
          })
          .finally(() => {
            teamSwitcherCache.pendingRequest = null
          })
      }

      return teamSwitcherCache.pendingRequest
    },

    emitActiveTeamChanged() {
      if (!import.meta.client) return

      window.dispatchEvent(
        new CustomEvent(ACTIVE_TEAM_CHANGED_EVENT, {
          detail: { teamId: this.activeTeam?.id || null },
        })
      )
    },

    async initializeTeams(options = {}) {
      const { force = false, silent = false } = options
      const hasCachedData = hasCachedTeamContext()

      if (!force && hasCachedData) {
        this.applyTeamContextFromCache()
        this.teamsError = null

        if (!isTeamContextCacheFresh() && !teamSwitcherCache.pendingRequest) {
          // Revalidate stale cache in the background without showing loading UI.
          void this.initializeTeams({ force: true, silent: true })
        }
        return
      }

      try {
        if (!silent || !hasCachedData) {
          this.isLoadingTeams = true
        }
        this.teamsError = null
        await this.fetchAndCacheTeamContext()
        this.applyTeamContextFromCache()
        this.teamsError = null
        this.isLoadingTeams = false
      } catch (error) {
        if (!hasCachedData) {
          clearTeamContextCache()
          this.teamsError = 'Failed to load teams'
        }
        this.isLoadingTeams = false
        console.error('Error loading teams:', error)
      }
    },

    async setActiveTeam(team) {
      if (team.id === this.activeTeam?.id) return

      const previousActiveTeam = this.activeTeam
      const previousActiveOrganization = this.activeOrganization

      try {
        this.teamsError = null
        this.activeTeam = team
        teamSwitcherCache.activeTeam = team

        await $fetch('/api/teams/active', {
          method: 'POST',
          body: { teamId: team.id },
        })

        // Sync Better-Auth client-side organization context
        if (team.organizationId && team.organizationId !== previousActiveTeam?.organizationId) {
          await authClient.organization.setActive({
            organizationId: team.organizationId,
          })
        }

        clearTeamContextCache()
        this.emitActiveTeamChanged()
        await this.initializeTeams({ force: true, silent: true })
      } catch (error) {
        this.activeTeam = previousActiveTeam
        this.activeOrganization = previousActiveOrganization
        teamSwitcherCache.activeTeam = previousActiveTeam
        teamSwitcherCache.activeOrganization = previousActiveOrganization
        this.teamsError = 'Failed to switch team'
        console.error('Error setting active team:', error)
      }
    },

    async goToTeamSettings() {
      await navigateTo('/settings#team')
    },

    async refreshTeams() {
      this.teamsError = null
      await this.initializeTeams({ force: true, silent: false })
    },
  },
}
</script>
