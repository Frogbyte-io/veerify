<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:github" class="h-5 w-5" />
          GitHub Integration
        </CardTitle>
        <CardDescription>
          Connect your GitHub account, pick a repository, and sync feedback with issues.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>

        <div v-else-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p class="text-sm text-destructive">{{ error }}</p>
          <Button variant="outline" size="sm" class="mt-3" @click="loadIntegration">
            Try Again
          </Button>
        </div>

        <template v-else>
          <div class="rounded-md border p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium">GitHub account connection</p>
                <p class="text-xs text-muted-foreground">
                  Use OAuth to authorize repository access for this project.
                </p>
              </div>
              <Button
                variant="outline"
                data-testid="github-connect"
                :disabled="isConnecting"
                @click="connectGithub"
              >
                <Icon v-if="isConnecting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                <Icon v-else name="lucide:link" class="mr-2 h-4 w-4" />
                Connect GitHub
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            <Label for="github-repo-select">Repository</Label>
            <select
              id="github-repo-select"
              v-model="form.repoFullName"
              data-testid="github-repo-select"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :disabled="isLoadingRepos || repos.length === 0"
            >
              <option value="" disabled>
                {{ repoPlaceholder }}
              </option>
              <option v-for="repo in repos" :key="repo.id" :value="repo.fullName">
                {{ repo.fullName }}
              </option>
            </select>
            <p class="text-xs text-muted-foreground">
              Pick the repository where Veerify should create and sync issues.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex items-center justify-between rounded-md border p-3">
              <div>
                <p class="text-sm font-medium">Sync enabled</p>
                <p class="text-xs text-muted-foreground">Enable GitHub synchronization features.</p>
              </div>
              <Switch v-model="form.syncEnabled" data-testid="github-sync-enabled" />
            </div>
            <div class="flex items-center justify-between rounded-md border p-3">
              <div>
                <p class="text-sm font-medium">Auto-create issues</p>
                <p class="text-xs text-muted-foreground">Create GitHub issues automatically for new feedback.</p>
              </div>
              <Switch v-model="form.autoCreateIssues" data-testid="github-auto-create-issues" />
            </div>
          </div>

          <div class="flex items-center justify-between rounded-md border p-3">
            <div>
              <p class="text-sm font-medium">Auto-sync issue status</p>
              <p class="text-xs text-muted-foreground">Use webhook updates to sync feedback status.</p>
            </div>
            <Switch v-model="form.autoSyncStatus" data-testid="github-auto-sync-status" />
          </div>

          <div class="flex justify-end">
            <Button :disabled="isSaving || !canSave || !hasChanges" data-testid="github-save-settings" @click="save">
              <Icon v-if="isSaving" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
              Save GitHub Settings
            </Button>
          </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsGithub',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['updated'],
  data() {
    return {
      isLoading: true,
      isSaving: false,
      isLoadingRepos: false,
      isConnecting: false,
      error: null,
      integration: null,
      repos: [],
      form: {
        repoFullName: '',
        syncEnabled: true,
        autoCreateIssues: false,
        autoSyncStatus: true,
      },
    }
  },
  computed: {
    canSave() {
      return Boolean(this.form.repoFullName)
    },
    repoPlaceholder() {
      if (this.isLoadingRepos) return 'Loading repositories...'
      if (this.repos.length === 0) return 'Connect GitHub to load repositories'
      return 'Select a repository'
    },
    hasChanges() {
      const current = this.integration
      if (!current) return this.canSave

      return (
        this.form.repoFullName !== (current.repoFullName || '') ||
        this.form.syncEnabled !== Boolean(current.syncEnabled) ||
        this.form.autoCreateIssues !== Boolean(current.autoCreateIssues) ||
        this.form.autoSyncStatus !== Boolean(current.autoSyncStatus)
      )
    },
  },
  async mounted() {
    await this.loadIntegration()

    if (this.$route.query.githubConnected === '1') {
      toast.success('GitHub connected successfully. Select a repository to finish setup.')
      await this.loadRepos()
      const query = { ...this.$route.query }
      delete query.githubConnected
      this.$router.replace({ query, hash: '#github' })
    }
  },
  methods: {
    normalizeIntegration(integration) {
      if (!integration) return null

      return {
        id: integration.id,
        owner: integration.owner || '',
        repo: integration.repo || '',
        repoFullName: integration.repoFullName || '',
        hasAccessToken: integration.hasAccessToken === true,
        syncEnabled: integration.syncEnabled !== false,
        autoCreateIssues: integration.autoCreateIssues === true,
        autoSyncStatus: integration.autoSyncStatus !== false,
        updatedAt: integration.updatedAt || null,
      }
    },
    populateForm(integration) {
      this.form.repoFullName = integration?.repoFullName || ''
      this.form.syncEnabled = integration?.syncEnabled !== false
      this.form.autoCreateIssues = integration?.autoCreateIssues === true
      this.form.autoSyncStatus = integration?.autoSyncStatus !== false
    },
    async loadIntegration() {
      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/github`)
        this.integration = this.normalizeIntegration(response?.data || null)
        this.populateForm(this.integration)

        if (this.integration?.hasAccessToken) {
          await this.loadRepos()
        }
      } catch (err) {
        console.error('Failed to load GitHub integration:', err)
        this.error = err?.data?.error?.message || 'Failed to load GitHub integration settings'
      } finally {
        this.isLoading = false
      }
    },
    async loadRepos() {
      this.isLoadingRepos = true

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/github/repos`)
        this.repos = Array.isArray(response?.data) ? response.data : []
      } catch (err) {
        console.error('Failed to load GitHub repos:', err)
        toast.error(err?.data?.error?.message || 'Failed to load repositories from GitHub')
        this.repos = []
      } finally {
        this.isLoadingRepos = false
      }
    },
    async connectGithub() {
      this.isConnecting = true

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/github/connect`)
        const authorizationUrl = response?.data?.authorizationUrl

        if (!authorizationUrl) {
          throw new Error('Missing authorization URL')
        }

        window.location.href = authorizationUrl
      } catch (err) {
        console.error('Failed to start GitHub OAuth:', err)
        toast.error(err?.data?.error?.message || 'Failed to connect GitHub')
        this.isConnecting = false
      }
    },
    async save() {
      if (this.isSaving || !this.canSave || !this.hasChanges) return
      this.isSaving = true

      try {
        const payload = {
          repoFullName: this.form.repoFullName,
          syncEnabled: this.form.syncEnabled,
          autoCreateIssues: this.form.autoCreateIssues,
          autoSyncStatus: this.form.autoSyncStatus,
        }

        const response = await $fetch(`/api/projects/${this.project.slug}/github`, {
          method: 'PUT',
          body: payload,
        })

        this.integration = this.normalizeIntegration(response?.data || null)
        this.populateForm(this.integration)
        await this.loadRepos()
        toast.success('GitHub settings saved')
        this.$emit('updated', this.project)
      } catch (err) {
        console.error('Failed to save GitHub integration:', err)
        toast.error(err?.data?.error?.message || 'Failed to save GitHub settings')
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>
