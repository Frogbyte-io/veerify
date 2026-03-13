<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <!-- Loading state -->
      <div v-if="isLoading" class="space-y-6">
        <Skeleton class="h-8 w-48" />
        <Skeleton class="h-4 w-64" />
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Skeleton class="h-24" />
          <Skeleton class="h-24" />
          <Skeleton class="h-24" />
          <Skeleton class="h-24" />
        </div>
      </div>

      <!-- Personal Dashboard (no workspace) -->
      <template v-else-if="!hasOrganization">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-foreground">Welcome, {{ userName }}</h1>
          <p class="text-muted-foreground">
            This is your personal dashboard. Track your feedback submissions and manage your account.
          </p>
        </div>

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
                  <p class="text-sm text-muted-foreground">
                    Submit feedback on public boards to see your activity here.
                  </p>
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
                  team.
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
      </template>

      <!-- Workspace Dashboard (has organization) -->
      <template v-else>
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-foreground">Dashboard</h1>
          <p class="text-muted-foreground">Overview of your team's feedback activity</p>
        </div>

        <!-- Stats loading -->
        <div v-if="statsLoading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Skeleton class="h-24" />
          <Skeleton class="h-24" />
          <Skeleton class="h-24" />
          <Skeleton class="h-24" />
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10 mr-4">
                <Icon name="lucide:message-square" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-muted-foreground">Total Feedback</p>
                <p class="text-2xl font-bold text-card-foreground">{{ stats.totalFeedback }}</p>
              </div>
            </div>
          </div>

          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-orange-500/10 mr-4">
                <Icon name="lucide:circle-dot" class="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-muted-foreground">Open</p>
                <p class="text-2xl font-bold text-card-foreground">{{ stats.openFeedback }}</p>
              </div>
            </div>
          </div>

          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10 mr-4">
                <Icon name="lucide:loader" class="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-muted-foreground">In Progress</p>
                <p class="text-2xl font-bold text-card-foreground">{{ stats.inProgressFeedback }}</p>
              </div>
            </div>
          </div>

          <div class="bg-card p-6 rounded-lg border border-border">
            <div class="flex items-center">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-green-500/10 mr-4">
                <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-muted-foreground">Completed</p>
                <p class="text-2xl font-bold text-card-foreground">{{ stats.completedFeedback }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom section: recent feedback + team info -->
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Recent Feedback -->
          <div class="lg:col-span-2">
            <Card>
              <CardHeader>
                <div class="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Feedback</CardTitle>
                    <CardDescription>Latest submissions across your projects</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" @click="navigateTo('/feedback')">View all</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div v-if="statsLoading" class="space-y-3">
                  <Skeleton class="h-12" />
                  <Skeleton class="h-12" />
                  <Skeleton class="h-12" />
                </div>
                <div v-else-if="stats.recentFeedback.length === 0" class="text-center py-8">
                  <div class="flex justify-center mb-4">
                    <div class="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                      <Icon name="lucide:inbox" class="w-6 h-6 text-muted-foreground" />
                    </div>
                  </div>
                  <p class="font-medium mb-1">No feedback yet</p>
                  <p class="text-sm text-muted-foreground">Feedback submitted to your projects will appear here.</p>
                </div>
                <div v-else class="space-y-2">
                  <NuxtLink
                    v-for="item in stats.recentFeedback"
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

          <!-- Team info -->
          <div class="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle class="text-base">Team Overview</CardTitle>
              </CardHeader>
              <CardContent class="space-y-4">
                <div v-if="statsLoading">
                  <Skeleton class="h-8 mb-2" />
                  <Skeleton class="h-8" />
                </div>
                <template v-else>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon name="lucide:folder" class="w-4 h-4" />
                      Projects
                    </div>
                    <span class="font-semibold">{{ stats.projectCount }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon name="lucide:users" class="w-4 h-4" />
                      Members
                    </div>
                    <span class="font-semibold">{{ stats.memberCount }}</span>
                  </div>
                </template>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle class="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent class="space-y-2">
                <Button variant="outline" class="w-full justify-start" @click="navigateTo('/feedback')">
                  <Icon name="lucide:message-square" class="w-4 h-4 mr-2" />
                  View feedback
                </Button>
                <Button variant="outline" class="w-full justify-start" @click="navigateTo('/settings')">
                  <Icon name="lucide:settings" class="w-4 h-4 mr-2" />
                  Team settings
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { authClient } from '~/lib/auth-client'

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
      statsLoading: true,
      stats: {
        totalFeedback: 0,
        openFeedback: 0,
        inProgressFeedback: 0,
        completedFeedback: 0,
        projectCount: 0,
        memberCount: 0,
        recentFeedback: [],
      },
    }
  },

  async mounted() {
    await this.initialize()
  },

  methods: {
    async initialize() {
      try {
        this.isLoading = true

        // Merge any anonymous feedback/votes into the authenticated account.
        // This covers the OAuth redirect flow where login/signup pages aren't involved.
        $fetch('/api/auth/merge-anonymous', { method: 'POST' }).catch(() => {})

        const [sessionResult, orgsResult] = await Promise.all([
          authClient.useSession(useFetch),
          authClient.organization.list().catch(() => ({ data: [] })),
        ])

        const session = sessionResult.data.value
        this.userName = session?.user?.name || 'there'

        const orgs = Array.isArray(orgsResult.data) ? orgsResult.data : []
        this.hasOrganization = orgs.length > 0

        // Load data for the relevant dashboard type
        if (this.hasOrganization) {
          await this.loadWorkspaceStats()
        } else {
          await this.loadSubmissions()
        }
      } catch (error) {
        console.error('Dashboard initialization error:', error)
      } finally {
        this.isLoading = false
      }
    },

    async loadWorkspaceStats() {
      try {
        this.statsLoading = true
        const response = await $fetch('/api/dashboard/stats')
        if (response?.data) {
          this.stats = response.data
        }
      } catch (_error) {
        // Non-critical
      } finally {
        this.statsLoading = false
      }
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
      } catch (_error) {
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
