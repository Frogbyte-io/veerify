<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <!-- Loading state -->
      <SidebarMenuButton
        v-if="isLoading"
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

      <!-- Has active workspace, or an error to retry -->
      <DropdownMenu v-else-if="activeOrganization || loadError">
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            data-testid="project-switcher-trigger"
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1 group-data-[collapsible=icon]:justify-center"
          >
            <div
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
            >
              <Icon name="lucide:folder-kanban" class="size-4" />
            </div>
            <div class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <template v-if="activeOrganization">
                <span data-testid="project-switcher-active-name" class="truncate font-semibold">
                  {{ activeProject ? activeProject.name : 'No project' }}
                </span>
                <span data-testid="project-switcher-active-org" class="truncate text-xs text-muted-foreground">
                  {{ subtitle }}
                </span>
              </template>
              <template v-else>
                <span class="truncate font-semibold text-red-500">Error loading</span>
                <span class="truncate text-xs text-red-400">Please retry</span>
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
          <div v-if="loadError" class="p-2">
            <div class="flex items-center gap-2 text-red-500">
              <Icon name="lucide:alert-circle" class="size-4" />
              <span class="text-sm">{{ loadError }}</span>
            </div>
            <DropdownMenuItem class="gap-2 p-2 mt-2" @click="retry">
              <Icon name="lucide:refresh-cw" class="size-4" />
              <span class="text-sm">Retry</span>
            </DropdownMenuItem>
          </div>
          <template v-else>
            <DropdownMenuLabel class="text-xs text-muted-foreground">
              Projects in {{ activeOrganization?.name || 'workspace' }}
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="project in projects"
              :key="project.id"
              class="gap-2 p-2"
              :disabled="isSwitching"
              @click="selectProject(project)"
            >
              <div class="flex size-6 items-center justify-center rounded-sm border">
                <Icon name="lucide:folder" class="size-4 shrink-0" />
              </div>
              <span :data-testid="`project-switcher-item-${project.id}`" class="flex-1 truncate">
                {{ project.name }}
              </span>
              <Badge variant="outline" class="text-[10px]">{{ project.isPublic ? 'Public' : 'Private' }}</Badge>
              <Icon v-if="activeProject?.id === project.id" name="lucide:check" class="size-4 text-primary" />
            </DropdownMenuItem>
            <p v-if="projects.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
              No projects yet.
              <template v-if="!canCreateProject">Ask a workspace admin to create one.</template>
            </p>
            <DropdownMenuItem
              v-if="canCreateProject"
              data-testid="project-switcher-create"
              class="gap-2 p-2"
              @click="openCreateDialog"
            >
              <div class="flex size-6 items-center justify-center rounded-md border bg-background">
                <Icon name="lucide:plus" class="size-4" />
              </div>
              <div class="font-medium text-muted-foreground">New project</div>
            </DropdownMenuItem>

            <template v-if="otherOrganizations.length > 0">
              <DropdownMenuSeparator />
              <DropdownMenuLabel class="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="org in organizations"
                :key="org.id"
                class="gap-2 p-2"
                :disabled="isSwitching"
                @click="switchOrganization(org)"
              >
                <div class="flex size-6 items-center justify-center rounded-sm border">
                  <Icon name="lucide:building-2" class="size-4 shrink-0" />
                </div>
                <span :data-testid="`org-switcher-item-${org.id}`" class="flex-1 truncate">{{ org.name }}</span>
                <Icon v-if="activeOrganization?.id === org.id" name="lucide:check" class="size-4 text-primary" />
              </DropdownMenuItem>
            </template>

            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="org-switcher-create" class="gap-2 p-2" @click="goToCreateOrganization">
              <div class="flex size-6 items-center justify-center rounded-md border bg-background">
                <Icon name="lucide:building-2" class="size-4" />
              </div>
              <div class="font-medium text-muted-foreground">Create workspace</div>
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="project-switcher-manage" class="gap-2 p-2" @click="goToWorkspaceSettings">
              <div class="flex size-6 items-center justify-center rounded-md border bg-background">
                <Icon name="lucide:settings" class="size-4" />
              </div>
              <div class="font-medium text-muted-foreground">Workspace settings</div>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Personal account, no workspace — show Veerify logo -->
      <SidebarMenuButton
        v-else
        size="lg"
        as-child
        class="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1"
      >
        <NuxtLink to="/dashboard" prefetch-on="interaction">
          <div class="flex aspect-square size-8 items-center justify-center rounded-lg">
            <img src="/veerify.svg" alt="Veerify" class="size-8" >
          </div>
          <span class="text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">Veerify</span>
        </NuxtLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>

  <Dialog v-model:open="createDialogOpen">
    <DialogContent class="sm:max-w-md" data-testid="project-create-dialog">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          A project is a brand or product line with its own feedback, tools and public site.
        </DialogDescription>
      </DialogHeader>
      <form class="space-y-3" @submit.prevent="createProject">
        <div class="space-y-1.5">
          <Label for="new-project-name">Project name</Label>
          <Input
            id="new-project-name"
            v-model="newProjectName"
            data-testid="project-create-name"
            placeholder="e.g. Acme"
            maxlength="80"
            :disabled="isCreating"
          />
        </div>
        <p v-if="createError" class="text-sm text-red-500" data-testid="project-create-error">{{ createError }}</p>
        <DialogFooter>
          <Button type="button" variant="outline" :disabled="isCreating" @click="createDialogOpen = false">
            Cancel
          </Button>
          <Button type="submit" data-testid="project-create-submit" :disabled="isCreating || !newProjectName.trim()">
            <Icon v-if="isCreating" name="lucide:loader-2" class="mr-2 size-4 animate-spin" />
            Create project
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import { shouldLeaveRouteOnOrgSwitch } from '~/lib/org-switch'
import {
  clearDashboardBootstrapCache,
  fetchDashboardBootstrap,
  getCachedDashboardBootstrap,
} from '~/lib/dashboard-bootstrap-client'

const ACTIVE_PROJECT_CHANGED_EVENT = 'veerify:active-project-changed'
const CACHE_MAX_AGE_MS = 5 * 60 * 1000
const LAST_PROJECT_STORAGE_PREFIX = 'veerify:last-project:'

function readLastProjectId(organizationId) {
  if (!import.meta.client || !organizationId) return null
  try {
    return window.localStorage.getItem(`${LAST_PROJECT_STORAGE_PREFIX}${organizationId}`)
  } catch {
    return null
  }
}

function writeLastProjectId(organizationId, projectId) {
  if (!import.meta.client || !organizationId || !projectId) return
  try {
    window.localStorage.setItem(`${LAST_PROJECT_STORAGE_PREFIX}${organizationId}`, projectId)
  } catch {
    // Storage unavailable (private mode / quota) — last-used is only a hint.
  }
}

const switcherCache = {
  projects: [],
  organizations: [],
  activeProject: null,
  activeOrganization: null,
  orgRole: null,
  loadedAt: 0,
  pendingRequest: null,
}

function hasCachedContext() {
  return import.meta.client && switcherCache.loadedAt > 0
}

function isCacheFresh() {
  return hasCachedContext() && Date.now() - switcherCache.loadedAt < CACHE_MAX_AGE_MS
}

function clearSwitcherCache() {
  switcherCache.projects = []
  switcherCache.organizations = []
  switcherCache.activeProject = null
  switcherCache.activeOrganization = null
  switcherCache.orgRole = null
  switcherCache.loadedAt = 0
}

function unwrapList(response) {
  return Array.isArray(response) ? response : response?.data || []
}

export default {
  name: 'ProjectSwitcher',

  data() {
    const hasCachedData = hasCachedContext()
    return {
      projects: hasCachedData ? switcherCache.projects : [],
      organizations: hasCachedData ? switcherCache.organizations : [],
      activeProject: hasCachedData ? switcherCache.activeProject : null,
      activeOrganization: hasCachedData ? switcherCache.activeOrganization : null,
      orgRole: hasCachedData ? switcherCache.orgRole : null,
      isLoading: !hasCachedData,
      isSwitching: false,
      loadError: null,
      createDialogOpen: false,
      newProjectName: '',
      isCreating: false,
      createError: null,
    }
  },

  computed: {
    isMobile() {
      return import.meta.client ? window.innerWidth < 768 : false
    },

    otherOrganizations() {
      return this.organizations.filter((org) => org.id !== this.activeOrganization?.id)
    },

    // Only org owners/admins can create projects. With no role information (no active project),
    // offer the action and let the server enforce it.
    canCreateProject() {
      return !this.orgRole || this.orgRole === 'owner' || this.orgRole === 'admin'
    },

    subtitle() {
      const orgName = this.activeOrganization?.name || 'Workspace'
      if (!this.activeProject) return orgName
      return `${orgName} · ${this.activeProject.isPublic ? 'Public' : 'Private'}`
    },
  },

  watch: {
    createDialogOpen(open) {
      if (!open) {
        this.newProjectName = ''
        this.createError = null
      }
    },
  },

  async mounted() {
    await this.initialize()

    if (import.meta.client) {
      window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, this.handleActiveProjectChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, this.handleActiveProjectChanged)
    }
  },

  methods: {
    async handleActiveProjectChanged() {
      // Our own switches refresh below; this catches switches made elsewhere (e.g. workspace Projects tab).
      clearSwitcherCache()
      await this.initialize({ force: true, silent: true })
    },

    applyFromCache() {
      this.projects = switcherCache.projects
      this.organizations = switcherCache.organizations
      this.activeProject = switcherCache.activeProject
      this.activeOrganization = switcherCache.activeOrganization
      this.orgRole = switcherCache.orgRole
      this.isLoading = false

      // Share workspace state with the sidebar and other components
      if (import.meta.client) {
        useState('hasActiveOrganization').value = !!this.activeOrganization
      }
    },

    async fetchContextDirect() {
      // Resolve the active project first — it may update session.activeOrganizationId.
      const active = await $fetch('/api/projects/active').catch((error) => {
        if (error?.statusCode === 409 || error?.status === 409) return { noProject: true }
        throw error
      })
      const [projectsResponse, organizationsResponse, orgResponse] = await Promise.all([
        $fetch('/api/projects').catch(() => null),
        $fetch('/api/organizations/list').catch(() => null),
        $fetch('/api/auth/organization/get-full-organization').catch(() => null),
      ])
      const context = active?.noProject ? null : active?.data || null
      return {
        activeProject: context,
        projects: unwrapList(projectsResponse),
        organizations: organizationsResponse?.data || [],
        activeOrganization: context?.organization || orgResponse || null,
      }
    },

    async fetchContextFromBootstrap() {
      const bootstrap = getCachedDashboardBootstrap() || (await fetchDashboardBootstrap())
      const projectContext = bootstrap?.projectContext
      if (!projectContext) return null

      return {
        activeProject: projectContext.activeProject || null,
        projects: projectContext.projects || [],
        organizations: projectContext.organizations || [],
        activeOrganization: projectContext.activeOrganization || projectContext.activeProject?.organization || null,
      }
    },

    async fetchAndCache(options = {}) {
      if (!switcherCache.pendingRequest) {
        const { preferBootstrap = true } = options
        switcherCache.pendingRequest = (
          preferBootstrap
            ? this.fetchContextFromBootstrap().then((context) => context || this.fetchContextDirect())
            : this.fetchContextDirect()
        )
          .then((context) => {
            switcherCache.activeProject = context.activeProject?.project || null
            switcherCache.orgRole = context.activeProject?.organization?.role || null
            switcherCache.projects = context.projects
            switcherCache.organizations = context.organizations || []
            switcherCache.activeOrganization = context.activeOrganization
            switcherCache.loadedAt = Date.now()
            return context
          })
          .finally(() => {
            switcherCache.pendingRequest = null
          })
      }

      return switcherCache.pendingRequest
    },

    async initialize(options = {}) {
      const { force = false, silent = false } = options
      const hasCachedData = hasCachedContext()

      if (!force && hasCachedData) {
        this.applyFromCache()
        this.loadError = null

        if (!isCacheFresh() && !switcherCache.pendingRequest) {
          // Revalidate stale cache in the background without showing loading UI.
          void this.initialize({ force: true, silent: true })
        }
        return
      }

      try {
        if (!silent || !hasCachedData) this.isLoading = true
        this.loadError = null
        const context = await this.fetchAndCache({ preferBootstrap: !force })
        this.applyFromCache()
        this.loadError = null
        this.isLoading = false
        this.rememberActive()

        // A workspace with no project at all: nothing to work in until one exists.
        if (context.activeOrganization && !context.activeProject && context.projects.length === 0) {
          if (import.meta.client && !String(this.$route.path).startsWith('/onboarding')) {
            await navigateTo('/onboarding')
          }
        }
      } catch (error) {
        if (!hasCachedData) {
          clearSwitcherCache()
          this.loadError = 'Failed to load projects'
        }
        this.isLoading = false
        console.error('Error loading projects:', error)
      }
    },

    rememberActive() {
      if (this.activeProject) {
        writeLastProjectId(this.activeProject.organizationId, this.activeProject.id)
      }
    },

    emitActiveProjectChanged() {
      if (!import.meta.client) return
      window.dispatchEvent(
        new CustomEvent(ACTIVE_PROJECT_CHANGED_EVENT, {
          detail: { projectId: this.activeProject?.id || null },
        })
      )
    },

    // Dispatching the event makes every listener (including this component) refetch.
    async refreshAfterChange() {
      clearSwitcherCache()
      clearDashboardBootstrapCache()
      this.emitActiveProjectChanged()
    },

    async selectProject(project) {
      if (this.isSwitching || project.id === this.activeProject?.id) return

      const previous = this.activeProject
      this.isSwitching = true
      try {
        this.loadError = null
        this.activeProject = project
        await $fetch('/api/projects/active', { method: 'POST', body: { projectId: project.id } })
        writeLastProjectId(project.organizationId, project.id)
        await this.refreshAfterChange()

        if (shouldLeaveRouteOnOrgSwitch(this.$route.path)) {
          await navigateTo('/dashboard')
        }
      } catch (error) {
        this.activeProject = previous
        if (error?.statusCode === 409 || error?.status === 409) {
          await navigateTo('/onboarding')
          return
        }
        this.loadError = 'Failed to switch project'
        console.error('Error switching project:', error)
      } finally {
        this.isSwitching = false
      }
    },

    // One server call sets the workspace and a project inside it together. The last-used project for
    // that workspace is sent as a hint; the server falls back to the first accessible one.
    async switchOrganization(org) {
      if (this.isSwitching || org.id === this.activeOrganization?.id) return

      this.isSwitching = true
      try {
        this.loadError = null
        const projectId = readLastProjectId(org.id)
        const response = await $fetch('/api/organizations/active', {
          method: 'POST',
          body: { organizationId: org.id, ...(projectId ? { projectId } : {}) },
        })
        // Keep the Better-Auth client session state in sync with the server-side change.
        await authClient.organization.setActive({ organizationId: org.id }).catch(() => null)
        writeLastProjectId(org.id, response?.data?.project?.id)

        await this.refreshAfterChange()

        if (!response?.data?.project) {
          await navigateTo('/onboarding')
        } else if (shouldLeaveRouteOnOrgSwitch(this.$route.path)) {
          await navigateTo('/dashboard')
        }
      } catch (error) {
        this.loadError = 'Failed to switch workspace'
        console.error('Error switching workspace:', error)
      } finally {
        this.isSwitching = false
      }
    },

    openCreateDialog() {
      this.createError = null
      this.createDialogOpen = true
    },

    async createProject() {
      const name = this.newProjectName.trim()
      if (!name || this.isCreating) return

      this.isCreating = true
      this.createError = null
      try {
        const response = await $fetch('/api/projects', { method: 'POST', body: { name } })
        const created = response?.data?.project
        if (created?.id) {
          await $fetch('/api/projects/active', { method: 'POST', body: { projectId: created.id } })
          writeLastProjectId(created.organizationId, created.id)
        }
        this.createDialogOpen = false
        await this.refreshAfterChange()
        if (shouldLeaveRouteOnOrgSwitch(this.$route.path)) {
          await navigateTo('/dashboard')
        }
      } catch (error) {
        this.createError =
          error?.data?.statusMessage || error?.statusMessage || error?.data?.message || 'Failed to create project'
      } finally {
        this.isCreating = false
      }
    },

    async goToCreateOrganization() {
      await navigateTo('/onboarding')
    },

    async goToWorkspaceSettings() {
      await navigateTo('/workspace')
    },

    async retry() {
      this.loadError = null
      await this.initialize({ force: true, silent: false })
    },
  },
}
</script>
