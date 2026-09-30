<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <!-- Loading state -->
      <SidebarMenuButton
        v-if="isLoadingTeams"
        size="lg"
        disabled
        class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1"
      >
        <Skeleton class="size-8 rounded-lg shrink-0" />
        <div class="grid flex-1 gap-1 group-data-[collapsible=icon]:hidden">
          <Skeleton class="h-3.5 w-24 rounded" />
          <Skeleton class="h-3 w-16 rounded" />
        </div>
      </SidebarMenuButton>

      <!-- Has active organization or error — show dropdown -->
      <DropdownMenu v-else-if="activeOrganization || teamsError">
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            data-testid="team-switcher-trigger"
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1 group-data-[collapsible=icon]:justify-center"
          >
            <div
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
            >
              <Icon name="lucide:building-2" class="size-4" />
            </div>
            <div class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <template v-if="activeOrganization">
                <span data-testid="team-switcher-active-name" class="truncate font-semibold">
                  {{ displayName }}
                </span>
                <span data-testid="team-switcher-active-org" class="truncate text-xs text-muted-foreground">
                  {{ displaySubtitle }}
                </span>
              </template>
              <template v-else>
                <span class="truncate font-semibold text-red-500">Error loading</span>
                <span class="truncate text-xs text-red-400">Please refresh</span>
              </template>
            </div>
            <Icon name="lucide:chevrons-up-down" class="ml-auto group-data-[collapsible=icon]:hidden" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-[--reka-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          align="start"
          :side="isMobile ? 'bottom' : 'right'"
          :side-offset="4"
        >
          <div v-if="teamsError" class="p-2">
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
            <DropdownMenuLabel class="text-xs text-muted-foreground">Workspace</DropdownMenuLabel>
            <DropdownMenuItem class="gap-2 p-2" @click="switchToDefaultTeam">
              <div class="flex size-6 items-center justify-center rounded-sm border">
                <Icon name="lucide:building-2" class="size-4 shrink-0" />
              </div>
              <span class="flex-1">{{ activeOrganization?.name || 'Workspace' }}</span>
              <Icon v-if="isOnDefaultTeam" name="lucide:check" class="size-4 text-primary" />
            </DropdownMenuItem>
            <template v-if="additionalTeams.length > 0">
              <DropdownMenuSeparator />
              <DropdownMenuLabel class="text-xs text-muted-foreground">Teams</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="team in additionalTeams"
                :key="team.id"
                class="gap-2 p-2"
                @click="setActiveTeam(team)"
              >
                <div class="flex size-6 items-center justify-center rounded-sm border">
                  <Icon name="lucide:users" class="size-4 shrink-0" />
                </div>
                <span :data-testid="`team-switcher-item-${team.id}`" class="flex-1">{{ team.name }}</span>
                <Icon v-if="activeTeam?.id === team.id" name="lucide:check" class="size-4 text-primary" />
              </DropdownMenuItem>
            </template>
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

      <!-- Personal account — show Veerify logo -->
      <SidebarMenuButton
        v-else
        size="lg"
        as-child
        class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1"
      >
        <NuxtLink to="/dashboard" prefetch-on="interaction">
          <div class="flex aspect-square size-8 items-center justify-center rounded-lg">
            <img src="/veerify.svg" alt="Veerify" class="size-8" />
          </div>
          <span class="text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">Veerify</span>
        </NuxtLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import {
  clearDashboardBootstrapCache,
  fetchDashboardBootstrap,
  getCachedDashboardBootstrap,
} from '~/lib/dashboard-bootstrap-client'

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

    additionalTeams() {
      return this.teams.filter((t) => t.name !== 'Default')
    },

    isOnDefaultTeam() {
      if (!this.activeTeam) return true
      return this.activeTeam.name === 'Default'
    },

    displayName() {
      if (!this.activeTeam || this.activeTeam.name === 'Default') {
        return this.activeOrganization?.name || 'Workspace'
      }
      return this.activeTeam.name
    },

    displaySubtitle() {
      if (!this.activeTeam || this.activeTeam.name === 'Default') {
        return this.additionalTeams.length > 0 ? 'All projects' : 'Workspace'
      }
      return this.activeOrganization?.name || ''
    },
  },

  async mounted() {
    await this.initializeTeams()

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
    async handleActiveTeamChanged() {
      clearTeamContextCache()
      await this.initializeTeams({ force: true, silent: true })
    },

    applyTeamContextFromCache() {
      this.teams = teamSwitcherCache.teams
      this.activeTeam = teamSwitcherCache.activeTeam
      this.activeOrganization = teamSwitcherCache.activeOrganization
      this.isLoadingTeams = false

      // Share org state with the sidebar and other components
      if (import.meta.client) {
        useState('hasActiveOrganization').value = !!this.activeOrganization
      }
    },

    async fetchTeamContext() {
      // Resolve the active team first — this may update session.activeOrganizationId
      // so that the subsequent get-full-organization call sees the correct session state.
      const activeTeamResponse = await $fetch('/api/teams/active').catch(() => null)

      const [teamsResponse, activeOrganizationResponse] = await Promise.all([
        $fetch('/api/teams/list-user'),
        $fetch('/api/auth/organization/get-full-organization').catch(() => null),
      ])

      return {
        activeTeam: activeTeamResponse?.data || null,
        teams: Array.isArray(teamsResponse) ? teamsResponse : teamsResponse?.data || [],
        activeOrganization: activeOrganizationResponse || null,
      }
    },

    async fetchTeamContextFromBootstrap() {
      const bootstrap = getCachedDashboardBootstrap() || (await fetchDashboardBootstrap())
      if (!bootstrap?.teamContext) return null

      return {
        activeTeam: bootstrap.teamContext.activeTeam || null,
        teams: bootstrap.teamContext.teams || [],
        activeOrganization: bootstrap.teamContext.activeOrganization || null,
      }
    },

    async fetchAndCacheTeamContext(options = {}) {
      if (!teamSwitcherCache.pendingRequest) {
        const { preferBootstrap = true } = options
        teamSwitcherCache.pendingRequest = (
          preferBootstrap
            ? this.fetchTeamContextFromBootstrap().then((context) => context || this.fetchTeamContext())
            : this.fetchTeamContext()
        )
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
        await this.fetchAndCacheTeamContext({ preferBootstrap: !force })
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

    async switchToDefaultTeam() {
      let defaultTeam = this.teams.find((t) => t.name === 'Default')
      if (!defaultTeam) {
        const organizationTeamsResponse = await $fetch('/api/teams/list-organization').catch(() => null)
        const organizationTeams = Array.isArray(organizationTeamsResponse)
          ? organizationTeamsResponse
          : organizationTeamsResponse?.data || []

        defaultTeam =
          organizationTeams.find(
            (team) =>
              team.name === 'Default' &&
              (!this.activeOrganization?.id || team.organizationId === this.activeOrganization.id)
          ) || organizationTeams.find((team) => team.name === 'Default')

        if (defaultTeam && !this.teams.some((team) => team.id === defaultTeam.id)) {
          this.teams = [defaultTeam, ...this.teams]
          teamSwitcherCache.teams = this.teams
        }
      }

      if (!defaultTeam || defaultTeam.id === this.activeTeam?.id) return
      await this.setActiveTeam(defaultTeam)
    },

    async setActiveTeam(team) {
      if (team.id === this.activeTeam?.id) {
        const activeTeamResponse = await $fetch('/api/teams/active').catch(() => null)
        if (activeTeamResponse?.data?.id === team.id) return
      }

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
        clearDashboardBootstrapCache()
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
