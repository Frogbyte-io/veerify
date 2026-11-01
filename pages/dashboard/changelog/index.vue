<template>
  <PageContainer data-testid="changelog-page">
    <PageHeader title="Changelog" description="Tell your users what shipped">
      <template #actions>
        <ChangelogProductPicker v-if="!isAll" @change="onProductChange" />
        <Button v-if="canCreate && isAll" data-testid="changelog-new-entry" @click="showNewEntry = true">
          <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
          New entry
        </Button>
        <Button v-else-if="canCreate" as-child data-testid="changelog-new-entry">
          <NuxtLink :to="newEntryLink">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            New entry
          </NuxtLink>
        </Button>
        <Button v-else disabled data-testid="changelog-new-entry">
          <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
          New entry
        </Button>
      </template>
    </PageHeader>

    <ProjectScopeChips
      v-if="showChips"
      v-model="selectedIds"
      :projects="scopeProjectList"
      page="changelog"
      module="changelogEnabled"
      :counts="chipCounts"
      class="mb-4"
      @update:model-value="onSelectionChange"
    />

    <Card v-if="disabledMessage !== null" data-testid="changelog-disabled">
      <CardContent class="py-10 text-center space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon name="lucide:newspaper" class="w-6 h-6 text-muted-foreground" />
        </div>
        <div class="space-y-1">
          <p class="font-medium">Changelog is switched off</p>
          <p v-if="isAll" class="text-sm text-muted-foreground max-w-md mx-auto">
            No project has the changelog on. Pick a project in the switcher and switch it on under Project settings,
            Tools.
          </p>
          <p v-else class="text-sm text-muted-foreground max-w-md mx-auto">
            {{
              isAdmin ? 'Switch it on under Project settings, Tools.' : 'Project admins can switch the changelog on.'
            }}
          </p>
        </div>
        <div v-if="isAdmin && !isAll" class="flex flex-wrap items-center justify-center gap-2">
          <Button as-child variant="outline">
            <NuxtLink to="/project/settings?tab=tools">Project settings: Tools</NuxtLink>
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="contextError">
      <CardContent class="text-center py-8">
        <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
        <p class="font-medium mb-2">Failed to load the active project</p>
        <p class="text-sm text-muted-foreground mb-4">{{ contextError }}</p>
        <Button variant="outline" @click="bootstrap">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <div v-else-if="!contextReady || isLoading" class="space-y-3" data-testid="changelog-loading">
      <template v-if="isAll">
        <div v-for="n in 4" :key="n" class="flex gap-4">
          <Skeleton class="mt-1 h-3 w-3 shrink-0 rounded-full" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-4 w-48" />
            <Skeleton class="h-5 w-2/3" />
            <Skeleton class="h-4 w-full" />
          </div>
        </div>
      </template>
      <template v-else>
        <Skeleton v-for="n in 4" :key="n" class="h-[92px] w-full rounded-xl" />
      </template>
    </div>

    <Card v-else-if="error">
      <CardContent class="text-center py-8">
        <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
        <p class="font-medium mb-2">Failed to load the changelog</p>
        <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
        <Button variant="outline" @click="reload">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <Card v-else-if="entries.length === 0">
      <CardContent class="py-10 text-center">
        <Icon name="lucide:newspaper" class="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p class="font-medium mb-1">No entries yet</p>
        <p class="text-sm text-muted-foreground">Write your first release note with "New entry".</p>
      </CardContent>
    </Card>

    <div v-else-if="isAll" class="space-y-1" data-testid="changelog-timeline">
      <NuxtLink
        v-for="entry in entries"
        :key="entry.id"
        :to="entryLink(entry)"
        class="group relative block border-l-2 pb-6 pl-6"
        :style="{ borderColor: projectColor(entry) }"
        :data-testid="`changelog-entry-${entry.slug}`"
      >
        <span
          class="absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-background"
          :style="{ backgroundColor: projectColor(entry) }"
        />
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{{ entryDate(entry) }}</span>
          <ProjectTag
            v-if="scopeProjectOf(entry)"
            :project="scopeProjectOf(entry)"
            :suffix="entryProductSuffix(entry)"
            :data-testid="`changelog-project-tag-${entry.slug}`"
          />
          <Badge v-if="entry.status !== 'published'" variant="outline" class="capitalize">{{ entry.status }}</Badge>
        </div>
        <p class="mt-1 font-medium group-hover:underline">{{ entry.title }}</p>
        <p v-if="entry.summary" class="mt-0.5 text-sm text-muted-foreground line-clamp-2">{{ entry.summary }}</p>
        <div v-if="entry.labels.length > 0" class="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge v-for="label in entry.labels" :key="label" variant="secondary" class="capitalize">{{ label }}</Badge>
        </div>
      </NuxtLink>

      <div v-if="nextCursor" class="text-center pt-2">
        <Button variant="outline" :disabled="isLoadingMore" @click="loadMore">
          {{ isLoadingMore ? 'Loading...' : 'Load more' }}
        </Button>
        <p v-if="loadMoreError" class="text-sm text-destructive mt-2">{{ loadMoreError }}</p>
      </div>
    </div>

    <div v-else class="space-y-3">
      <NuxtLink
        v-for="entry in entries"
        :key="entry.id"
        :to="entryLink(entry)"
        class="block"
        :data-testid="`changelog-entry-${entry.slug}`"
      >
        <Card class="hover:bg-accent/40 transition-colors">
          <CardContent class="py-4 flex items-start justify-between gap-4">
            <div class="min-w-0 space-y-1">
              <p class="font-medium truncate">{{ entry.title }}</p>
              <p v-if="entry.summary" class="text-sm text-muted-foreground line-clamp-2">{{ entry.summary }}</p>
              <div class="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge v-if="showProductBadges" variant="outline" data-testid="changelog-entry-products">
                  {{ entryProductLabel(entry) }}
                </Badge>
                <Badge v-for="label in entry.labels" :key="label" variant="secondary" class="capitalize">
                  {{ label }}
                </Badge>
              </div>
            </div>
            <div class="shrink-0 text-right space-y-1">
              <Badge :variant="entry.status === 'published' ? 'default' : 'outline'" class="capitalize">
                {{ entry.status }}
              </Badge>
              <p class="text-xs text-muted-foreground">
                {{
                  entry.status === 'published'
                    ? formatDate(entry.publishedAt)
                    : 'Updated ' + formatDate(entry.updatedAt)
                }}
              </p>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>

      <div v-if="nextCursor" class="text-center pt-2">
        <Button variant="outline" :disabled="isLoadingMore" @click="loadMore">
          {{ isLoadingMore ? 'Loading...' : 'Load more' }}
        </Button>
        <p v-if="loadMoreError" class="text-sm text-destructive mt-2">{{ loadMoreError }}</p>
      </div>
    </div>

    <ChangelogNewEntryDialog
      v-if="isAll"
      v-model:open="showNewEntry"
      :projects="creatableProjects"
      :active-project-id="project?.id || ''"
      :organization-id="organizationId"
      @create="startNewEntry"
    />
  </PageContainer>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { cachedActiveProject, loadActiveProject } from '~/lib/active-project'
import { isModuleOffMessage } from '~/lib/changelog-editor'
import { changelogEntryPath, rememberLastChangelogProject } from '~/lib/changelog-combined'
import {
  findScopeProject,
  isAllProjects,
  parseProjectFilter,
  projectFilterParam,
  readRememberedProjectFilter,
  scopeProjects,
  scopeProjectsWithModule,
} from '~/lib/project-scope'

export default {
  name: 'ChangelogPage',

  data() {
    return {
      contextReady: false,
      contextError: null,
      context: null,
      // All projects: chip selection (empty = every project), per-project data from the combined endpoint
      selectedIds: [],
      combinedProducts: [],
      combinedCounts: {},
      showNewEntry: false,
      requestId: 0,
      project: null,
      products: [],
      productId: '',
      entries: [],
      nextCursor: null,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      loadMoreError: null,
      disabledMessage: null,
    }
  },

  computed: {
    newEntryLink() {
      return this.productId
        ? `/dashboard/changelog/new?productId=${encodeURIComponent(this.productId)}`
        : '/dashboard/changelog/new'
    },
    canCreate() {
      return this.contextReady && !!this.project && this.disabledMessage === null
    },
    isAdmin() {
      return this.project?.role === 'admin'
    },
    isAll() {
      return isAllProjects(this.context)
    },
    // Every scope project (chips show the ones with the changelog off greyed out)
    scopeProjectList() {
      return scopeProjects(this.context)
    },
    creatableProjects() {
      return scopeProjectsWithModule(this.context, 'changelogEnabled')
    },
    organizationId() {
      return this.context?.organization?.id || this.scopeProjectList[0]?.organizationId || ''
    },
    showChips() {
      return this.isAll && this.contextReady && !this.contextError && this.scopeProjectList.length > 0
    },
    chipCounts() {
      return this.isAll && Object.keys(this.combinedCounts).length > 0 ? this.combinedCounts : null
    },
    // Product tags only matter when there is more than one product
    showProductBadges() {
      return this.products.length > 1
    },
  },

  created() {
    useHead({ title: 'Changelog' })
    // Warm navigation: render and start the data fetch at once from the cache
    if (import.meta.client) {
      const cached = cachedActiveProject()
      if (cached !== undefined) this.onProductChange(cached, this.productFromRoute(cached))
    }
  },

  async mounted() {
    if (import.meta.client) window.addEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
    await this.bootstrap()
  },

  beforeUnmount() {
    if (import.meta.client) window.removeEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
  },

  methods: {
    // The product picker reloads single-project switches itself; this covers every switch from or to All projects.
    async onActiveProjectChanged() {
      try {
        const context = (await loadActiveProject()) || null
        if (this.isAll || isAllProjects(context)) await this.onProductChange(context, this.productFromRoute(context))
      } catch (err) {
        this.contextError = apiErrorMessage(err, 'Failed to load the active project')
      }
    },

    scopeProjectOf(entry) {
      return findScopeProject(this.context, entry.projectId)
    },

    projectColor(entry) {
      return this.scopeProjectOf(entry)?.identity?.color || 'transparent'
    },

    entryDate(entry) {
      return entry.status === 'published'
        ? this.formatDate(entry.publishedAt)
        : 'Updated ' + this.formatDate(entry.updatedAt)
    },

    // "Product" next to the project, only for projects with several products
    entryProductSuffix(entry) {
      const products = this.combinedProducts.filter((p) => p.projectId === entry.projectId)
      if (products.length < 2) return ''
      const ids = entry.productIds || []
      if (ids.length === 0) return 'All products'
      return ids
        .map((id) => products.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ')
    },

    initialSelection(context) {
      const selectable = scopeProjectsWithModule(context, 'changelogEnabled')
      const valid = (ids) => ids.filter((id) => selectable.some((p) => p.id === id))
      const fromUrl = valid(parseProjectFilter(this.$route.query.projects))
      if (fromUrl.length > 0) return fromUrl
      return valid(readRememberedProjectFilter('changelog', (context.projects ?? [])[0]?.organizationId))
    },

    async onSelectionChange(ids) {
      if (!this.isAll) return
      this.selectedIds = ids
      await this.loadCombined()
    },

    // Remember the choice, then open the editor for a new entry of that project
    async startNewEntry(projectId) {
      rememberLastChangelogProject(this.organizationId, projectId)
      this.showNewEntry = false
      await navigateTo(changelogEntryPath('new', projectId))
    },

    productFromRoute(context) {
      const products = context?.products || []
      const wanted = this.$route.query.productId
      return products.length > 1 && products.some((p) => p.id === wanted) ? wanted : ''
    },

    // Resolve the active project (cache first, in parallel with the picker) and load the list
    async bootstrap() {
      this.contextError = null
      try {
        const context = (await loadActiveProject()) || null
        const unchanged =
          this.contextReady &&
          isAllProjects(context) === this.isAll &&
          (context?.project?.id || null) === (this.project?.id || null) &&
          (isAllProjects(context)
            ? scopeProjectsWithModule(context, 'changelogEnabled').length > 0
            : context?.modules?.changelogEnabled === true) ===
            (this.disabledMessage === null)
        if (!unchanged) await this.onProductChange(context, this.productFromRoute(context))
      } catch (err) {
        this.contextError = apiErrorMessage(err, 'Failed to load the active project')
      }
    },

    entryLink(entry) {
      return this.isAll ? changelogEntryPath(entry.id, entry.projectId) : `/dashboard/changelog/${entry.id}`
    },

    entryProductLabel(entry) {
      const ids = entry.productIds || []
      if (ids.length === 0) return 'All products'
      return ids
        .map((id) => this.products.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ')
    },

    formatDate(value) {
      if (!value) return ''
      return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    },

    async onProductChange(context, productId) {
      this.contextReady = true
      this.contextError = null
      this.context = context
      this.project = context?.project || null
      this.products = context?.products || []
      this.productId = productId || ''
      this.entries = []
      this.nextCursor = null
      this.disabledMessage = null
      this.error = null
      this.combinedProducts = []
      this.combinedCounts = {}
      if (!this.project) return
      if (isAllProjects(context)) {
        this.products = []
        this.productId = ''
        this.selectedIds = this.initialSelection(context)
        if (scopeProjectsWithModule(context, 'changelogEnabled').length === 0) {
          this.disabledMessage = ''
          return
        }
        await this.loadCombined()
        return
      }
      if (context.modules?.changelogEnabled !== true) {
        this.disabledMessage = ''
        return
      }
      await this.load()
    },

    // All projects: one timeline of the selected projects
    async loadCombined() {
      const requestId = ++this.requestId
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch('/api/changelog/combined', {
          query: { projects: projectFilterParam(this.selectedIds) },
        })
        if (this.requestId !== requestId) return
        this.entries = response?.data?.entries || []
        this.nextCursor = response?.data?.nextCursor || null
        this.combinedProducts = response?.data?.products || []
        this.combinedCounts = response?.data?.counts || {}
      } catch (err) {
        if (this.requestId !== requestId) return
        this.error = apiErrorMessage(err, 'Failed to load the changelog')
      } finally {
        if (this.requestId === requestId) this.isLoading = false
      }
    },

    // Retry for the error card, in either mode
    async reload() {
      if (this.isAll) await this.loadCombined()
      else await this.load()
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      const productId = this.productId
      const isCurrent = () => this.project?.id === projectId && this.productId === productId
      this.isLoading = true
      this.error = null
      this.disabledMessage = null
      try {
        const response = await $fetch(`/api/changelog/projects/${projectId}/entries`, {
          query: productId ? { productId } : {},
        })
        if (!isCurrent()) return
        this.entries = response?.data?.entries || []
        this.nextCursor = response?.data?.nextCursor || null
      } catch (err) {
        if (!isCurrent()) return
        const message = apiErrorMessage(err, '')
        // 403 means either "module switched off" (explained below) or "no access
        // to this project": only the first one gets the enable-it card.
        if (apiErrorStatus(err) === 403 && isModuleOffMessage(message)) {
          this.disabledMessage = message
        } else if (apiErrorStatus(err) === 403) {
          this.error = message || 'You do not have access to this project'
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the changelog')
        }
      } finally {
        if (isCurrent()) this.isLoading = false
      }
    },

    async loadMoreCombined() {
      const requestId = this.requestId
      this.isLoadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch('/api/changelog/combined', {
          query: { cursor: this.nextCursor, projects: projectFilterParam(this.selectedIds) },
        })
        if (this.requestId !== requestId) return
        this.entries = [...this.entries, ...(response?.data?.entries || [])]
        this.nextCursor = response?.data?.nextCursor || null
      } catch (err) {
        this.loadMoreError = apiErrorMessage(err, 'Failed to load more entries')
      } finally {
        this.isLoadingMore = false
      }
    },

    async loadMore() {
      if (this.isAll) return this.loadMoreCombined()
      if (!this.project || !this.nextCursor) return
      const projectId = this.project.id
      const productId = this.productId
      this.isLoadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch(`/api/changelog/projects/${projectId}/entries`, {
          query: { cursor: this.nextCursor, ...(productId ? { productId } : {}) },
        })
        if (this.project?.id !== projectId || this.productId !== productId) return
        this.entries = [...this.entries, ...(response?.data?.entries || [])]
        this.nextCursor = response?.data?.nextCursor || null
      } catch (err) {
        this.loadMoreError = apiErrorMessage(err, 'Failed to load more entries')
      } finally {
        this.isLoadingMore = false
      }
    },
  },
}
</script>
