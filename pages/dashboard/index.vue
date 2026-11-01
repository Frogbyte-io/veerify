<template>
  <PageContainer>
    <PageHeader :title="headerTitle" :description="headerDescription" />

    <!-- Loading state: shaped like the workspace overview (needs you, numbers, projects) -->
    <OverviewSkeleton v-if="isLoading" key="loading" data-testid="dashboard-loading" />

    <!-- Personal Dashboard (no workspace) -->
    <div v-else-if="!hasOrganization" key="personal" class="flex flex-col gap-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left column: submissions summary -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Quick stats -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="bg-card p-5 rounded-lg border border-border">
              <div class="flex items-center gap-3">
                <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10">
                  <Icon name="lucide:message-square" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p class="text-sm text-muted-foreground">My Submissions</p>
                  <p class="text-2xl font-bold text-card-foreground">{{ submissionCount }}</p>
                </div>
              </div>
            </div>
            <div class="bg-card p-5 rounded-lg border border-border">
              <div class="flex items-center gap-3">
                <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-green-500/10">
                  <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p class="text-sm text-muted-foreground">Completed</p>
                  <p class="text-2xl font-bold text-card-foreground">{{ completedCount }}</p>
                </div>
              </div>
            </div>
            <div class="bg-card p-5 rounded-lg border border-border">
              <div class="flex items-center gap-3">
                <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10">
                  <Icon name="lucide:arrow-up" class="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p class="text-sm text-muted-foreground">Total Votes</p>
                  <p class="text-2xl font-bold text-card-foreground">{{ totalVotes }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent submissions -->
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle>Recent Submissions</CardTitle>
                  <CardDescription>Your latest feedback across all projects</CardDescription>
                </div>
                <Button
                  v-if="recentSubmissions.length > 0"
                  variant="outline"
                  size="sm"
                  @click="navigateTo('/submissions')"
                >
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div v-if="recentSubmissions.length === 0" class="text-center py-8">
                <div class="flex justify-center mb-4">
                  <div class="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                    <Icon name="lucide:message-square" class="w-6 h-6 text-muted-foreground" />
                  </div>
                </div>
                <p class="font-medium mb-1">No submissions yet</p>
                <p class="text-sm text-muted-foreground">Submit feedback on public boards to see your activity here.</p>
              </div>
              <div v-else class="space-y-3">
                <NuxtLink
                  v-for="item in recentSubmissions"
                  :key="item.id"
                  :to="`/feedback/${item.id}`"
                  prefetch-on="interaction"
                  class="flex items-center justify-between rounded-lg border p-3 hover:bg-muted transition-colors"
                >
                  <div class="min-w-0 flex-1">
                    <p class="font-medium truncate">{{ item.title }}</p>
                    <p class="text-xs text-muted-foreground">
                      {{ item.projectName || 'Unknown project' }} · {{ formatDate(item.createdAt) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 shrink-0 ml-3">
                    <Badge :variant="getStatusVariant(item.status)" class="text-xs">
                      {{ formatStatus(item.status) }}
                    </Badge>
                    <span class="text-xs text-muted-foreground flex items-center gap-1">
                      <Icon name="lucide:arrow-up" class="w-3 h-3" />
                      {{ item.voteCount }}
                    </span>
                  </div>
                </NuxtLink>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Right column: CTA + quick actions -->
        <div class="space-y-6">
          <!-- Create workspace CTA -->
          <Card class="border-primary/20 bg-primary/5">
            <CardHeader>
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-2">
                <Icon name="lucide:building-2" class="w-5 h-5 text-primary" />
              </div>
              <CardTitle class="text-lg">Want to collect feedback?</CardTitle>
              <CardDescription>
                Create a workspace to set up your own feedback boards, manage projects, and collaborate with your
                colleagues.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button class="w-full" @click="navigateTo('/onboarding')">
                <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
                Create a workspace
              </Button>
            </CardContent>
          </Card>

          <!-- Quick links -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent class="space-y-2">
              <Button variant="outline" class="w-full justify-start" @click="navigateTo('/submissions')">
                <Icon name="lucide:list" class="w-4 h-4 mr-2" />
                View all submissions
              </Button>
              <Button variant="outline" class="w-full justify-start" @click="navigateTo('/settings')">
                <Icon name="lucide:settings" class="w-4 h-4 mr-2" />
                Account settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <!-- Workspace Overview (has organization) -->
    <div v-else key="workspace" class="flex flex-col gap-6" data-testid="dashboard-overview">
      <ProjectScopeChips
        v-if="allProjects"
        :model-value="selectedIds"
        :projects="scopeList"
        page="overview"
        @update:model-value="onSelectionChange"
      />

      <div
        v-if="overviewError"
        key="error"
        class="rounded-xl border bg-card p-6 text-center"
        data-testid="overview-error"
      >
        <Icon name="lucide:circle-alert" class="mx-auto mb-2 h-6 w-6 text-destructive" />
        <p class="text-sm font-medium">{{ overviewError }}</p>
        <div class="mt-3 flex justify-center gap-2">
          <Button v-if="noProject" size="sm" @click="navigateTo('/onboarding')">Create a project</Button>
          <Button v-else size="sm" variant="outline" data-testid="overview-retry" @click="loadOverview">
            <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>

      <OverviewSkeleton v-else-if="!overview" key="overview-loading" :projects-table="allProjects" />

      <div
        v-else
        key="overview"
        :class="['flex flex-col gap-6 transition-opacity', overviewLoading ? 'opacity-60' : '']"
        :aria-busy="overviewLoading"
      >
        <OverviewNeedsYou
          :todos="todos"
          :projects="scopeList"
          :all-projects="allProjects"
          :busy-key="busyKey"
          @action="handleTodoAction"
        />
        <OverviewWeek v-if="overview.week" :week="overview.week" :projects-in-view="projectsInView" />
        <OverviewProjectsTable
          v-if="showProjectsTable"
          :rows="overview.projects"
          :projects="scopeList"
          @select="switchToProject"
        />
      </div>
    </div>
  </PageContainer>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { loadActiveProject } from '~/lib/active-project'
import {
  clearDashboardBootstrapCache,
  fetchDashboardBootstrap,
  getCachedDashboardBootstrap,
} from '~/lib/dashboard-bootstrap-client'
import { buildTodos } from '~/lib/overview'
import {
  findScopeProject,
  isAllProjects,
  parseProjectFilter,
  projectFilterParam,
  readRememberedProjectFilter,
  scopeProjects,
} from '~/lib/project-scope'

export default {
  name: 'DashboardPage',

  data() {
    return {
      isLoading: true,
      hasOrganization: false,
      userName: '',
      recentSubmissions: [],
      submissionCount: 0,
      completedCount: 0,
      totalVotes: 0,
      // The active project context (scope, projects with identity and tools)
      context: null,
      selectedIds: [],
      overview: null,
      overviewLoading: false,
      overviewError: '',
      noProject: false,
      busyKey: '',
      overviewRequest: 0,
    }
  },

  computed: {
    allProjects() {
      return isAllProjects(this.context)
    },
    // Every project in the scope (not narrowed by the chips)
    scopeList() {
      return scopeProjects(this.context)
    },
    // The projects the numbers cover, in the order the server returned them
    projectsInView() {
      const rows = this.overview?.projects || []
      return rows.map((row) => findScopeProject(this.context, row.project.id) || row.project)
    },
    showProjectsTable() {
      return this.allProjects && this.projectsInView.length > 1
    },
    todos() {
      if (!this.overview) return []
      return buildTodos(this.overview.needsYou, {
        allProjects: this.allProjects,
      })
    },
    scopeName() {
      if (!this.allProjects) return this.context?.project?.name || 'this project'
      if (this.selectedIds.length === 0 || this.selectedIds.length === this.scopeList.length) {
        return `your ${this.scopeList.length} projects`
      }
      return this.scopeList
        .filter((p) => this.selectedIds.includes(p.id))
        .map((p) => p.name)
        .join(', ')
    },
    headerTitle() {
      if (this.isLoading) return 'Dashboard'
      if (!this.hasOrganization) return `Welcome, ${this.userName}`
      return 'Overview'
    },
    headerDescription() {
      if (!this.isLoading && !this.hasOrganization) {
        return 'This is your personal dashboard. Track your feedback submissions and manage your account.'
      }
      if (!this.context) return ''
      return `What needs attention in ${this.scopeName}, and how the last 7 days went.`
    },
  },

  created() {
    useHead({ title: 'Dashboard' })
    // Warm navigation: render the page from the bootstrap cache on the first paint
    if (import.meta.client) {
      const cached = getCachedDashboardBootstrap()
      if (cached) {
        this.applyBootstrap(cached)
        this.isLoading = false
      }
    }
  },

  async mounted() {
    if (import.meta.client) window.addEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
    await this.initialize()
  },

  beforeUnmount() {
    if (import.meta.client) window.removeEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
  },

  methods: {
    async initialize() {
      try {
        this.scheduleAnonymousMerge()

        const bootstrap = await fetchDashboardBootstrap()
        this.applyBootstrap(bootstrap)
      } catch (error) {
        console.error('Dashboard initialization error:', error)
      } finally {
        this.isLoading = false
      }
      if (this.hasOrganization) await this.loadOverview()
    },

    applyBootstrap(bootstrap) {
      const session = bootstrap?.session
      this.userName = session?.user?.name || 'there'

      this.hasOrganization = Boolean(bootstrap?.projectContext?.activeOrganization)
      if (this.hasOrganization) {
        this.applyContext(bootstrap?.projectContext?.activeProject || null)
      } else {
        const personal = bootstrap?.personal || {}
        this.recentSubmissions = personal.recentSubmissions || []
        this.submissionCount = personal.submissionCount || 0
        this.completedCount = personal.completedCount || 0
        this.totalVotes = personal.totalVotes || 0
      }
    },

    applyContext(context) {
      this.context = context
      this.selectedIds = this.initialSelection(context)
    },

    // The chips' selection (URL first, then the one remembered for this page), so the first request
    // already covers the right projects and the chips have nothing to correct.
    initialSelection(context) {
      if (!isAllProjects(context)) return []
      const known = (context.projects || []).map((p) => p.id)
      const valid = (ids) => ids.filter((id) => known.includes(id))
      const fromUrl = valid(parseProjectFilter(this.$route.query.projects))
      const ids =
        fromUrl.length > 0
          ? fromUrl
          : valid(readRememberedProjectFilter('overview', context.projects?.[0]?.organizationId))
      return ids.length === known.length ? [] : ids
    },

    async onActiveProjectChanged() {
      try {
        this.applyContext(await loadActiveProject({ force: true }))
      } catch (error) {
        console.error('Dashboard context reload error:', error)
      }
      await this.loadOverview()
    },

    onSelectionChange(ids) {
      this.selectedIds = ids
      this.loadOverview()
    },

    async loadOverview() {
      const request = ++this.overviewRequest
      // Never show the previous scope's numbers under the new selection.
      this.overview = null
      this.overviewLoading = true
      this.overviewError = ''
      this.noProject = false
      try {
        const response = await $fetch('/api/dashboard/overview', {
          query: { projects: projectFilterParam(this.selectedIds) },
        })
        if (request !== this.overviewRequest) return
        this.overview = response?.data || null
      } catch (error) {
        if (request !== this.overviewRequest) return
        this.overview = null
        this.noProject = apiErrorStatus(error) === 409
        this.overviewError = this.noProject
          ? 'You have no project yet. Create one to see its overview.'
          : apiErrorMessage(error, 'Failed to load the overview')
      } finally {
        if (request === this.overviewRequest) this.overviewLoading = false
      }
    },

    // A "Needs you" button. Every target works in All projects, so this only navigates.
    async handleTodoAction(todo) {
      this.busyKey = todo.key
      try {
        await navigateTo(todo.action.to)
      } catch (error) {
        this.overviewError = apiErrorMessage(error, 'Could not open that')
      } finally {
        this.busyKey = ''
      }
    },

    // A Projects table row: leave All projects and work in that project.
    async switchToProject(projectId) {
      try {
        await $fetch('/api/projects/active', { method: 'POST', body: { projectId } })
        this.announceProjectChange(projectId)
      } catch (error) {
        this.overviewError = apiErrorMessage(error, 'Failed to switch project')
      }
    },

    announceProjectChange(projectId) {
      clearDashboardBootstrapCache()
      window.dispatchEvent(new CustomEvent('veerify:active-project-changed', { detail: { projectId } }))
    },

    scheduleAnonymousMerge() {
      if (!import.meta.client) return

      try {
        if (sessionStorage.getItem('veerify:anonymous-merge-scheduled') === '1') return
        sessionStorage.setItem('veerify:anonymous-merge-scheduled', '1')
      } catch {
        // Ignore storage failures and still schedule the best-effort merge.
      }

      const merge = () => {
        $fetch('/api/auth/merge-anonymous', { method: 'POST' }).catch(() => {})
      }

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(merge, { timeout: 3000 })
        return
      }

      window.setTimeout(merge, 1500)
    },

    async loadSubmissions() {
      try {
        const response = await $fetch('/api/user/submissions', {
          params: { limit: 5 },
        })
        this.recentSubmissions = response?.data || []
        this.submissionCount = response?.pagination?.totalCount || 0

        // Calculate stats from the full list
        this.completedCount = this.recentSubmissions.filter((s) => s.status === 'completed').length
        this.totalVotes = this.recentSubmissions.reduce((sum, s) => sum + (s.voteCount || 0), 0)

        // If we have more items than the preview, fetch full stats
        if (this.submissionCount > 5) {
          const fullResponse = await $fetch('/api/user/submissions', {
            params: { limit: 50 },
          })
          const allItems = fullResponse?.data || []
          this.completedCount = allItems.filter((s) => s.status === 'completed').length
          this.totalVotes = allItems.reduce((sum, s) => sum + (s.voteCount || 0), 0)
        }
      } catch {
        // Submissions loading is non-critical
      }
    },

    formatDate(date) {
      if (!date) return ''
      const d = new Date(date)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      return d.toLocaleDateString()
    },

    formatStatus(status) {
      const labels = {
        open: 'Open',
        in_progress: 'In Progress',
        planned: 'Planned',
        completed: 'Completed',
        closed: 'Closed',
        declined: 'Declined',
      }
      return labels[status] || status
    },

    getStatusVariant(status) {
      if (status === 'completed') return 'default'
      if (status === 'in_progress' || status === 'planned') return 'secondary'
      if (status === 'declined' || status === 'closed') return 'outline'
      return 'secondary'
    },
  },
}
</script>
