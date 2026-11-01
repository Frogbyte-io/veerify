<template>
  <PageContainer width="full" data-testid="roadmap-page">
    <PageHeader title="Roadmap" description="Drag feedback between columns to change its status">
      <template #actions>
        <RoadmapProductPicker v-if="!isAll" @change="onProductChange" />
        <DropdownMenu v-if="isAll && publicRoadmaps.length > 0">
          <DropdownMenuTrigger as-child>
            <Button variant="outline" data-testid="roadmap-public-links">
              <Icon name="lucide:external-link" class="w-4 h-4 mr-2" />
              Public roadmaps
              <Icon name="lucide:chevron-down" class="w-4 h-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-52">
            <DropdownMenuItem v-for="entry in publicRoadmaps" :key="entry.id" as-child>
              <a :href="entry.publicUrl" target="_blank" rel="noopener noreferrer" class="gap-2">
                <ProjectBadge :project="entry.scopeProject" size="xs" />
                {{ entry.name }}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button v-else-if="isAll" variant="outline" disabled data-testid="roadmap-public-links">
          <Icon name="lucide:external-link" class="w-4 h-4 mr-2" />
          Public roadmaps
        </Button>
        <Button v-else-if="publicUrl" as-child variant="outline" data-testid="roadmap-public-link">
          <a :href="publicUrl" target="_blank" rel="noopener noreferrer">
            <Icon name="lucide:external-link" class="w-4 h-4 mr-2" />
            View public roadmap
          </a>
        </Button>
        <Button v-else variant="outline" disabled data-testid="roadmap-public-link">
          <Icon name="lucide:external-link" class="w-4 h-4 mr-2" />
          View public roadmap
        </Button>
      </template>
    </PageHeader>

    <ProjectScopeChips
      v-if="showChips"
      v-model="selectedIds"
      :projects="scopeProjectList"
      page="roadmap"
      module="roadmapEnabled"
      :counts="chipCounts"
      class="mb-4"
      @update:model-value="onSelectionChange"
    />

    <Card v-if="disabledMessage !== null" data-testid="roadmap-disabled">
      <CardContent class="py-10 text-center space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon name="lucide:map" class="w-6 h-6 text-muted-foreground" />
        </div>
        <div class="space-y-1">
          <p class="font-medium">Roadmap is switched off</p>
          <p v-if="isAll" class="text-sm text-muted-foreground max-w-md mx-auto">
            No project has the roadmap on. Pick a project in the switcher and switch it on under Project settings,
            Tools.
          </p>
          <p v-else class="text-sm text-muted-foreground max-w-md mx-auto">
            {{ isAdmin ? 'Switch it on under Project settings, Tools.' : 'Project admins can switch the roadmap on.' }}
          </p>
        </div>
        <div v-if="isAdmin && !isAll" class="flex flex-wrap items-center justify-center gap-2">
          <Button as-child variant="outline">
            <NuxtLink to="/project/settings?tab=tools">Project settings: Tools</NuxtLink>
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="contextError" data-testid="roadmap-error">
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

    <!-- Same shape as the loaded page: filter row, then the columns -->
    <div v-else-if="!contextReady || isLoading" class="space-y-6" data-testid="roadmap-loading">
      <div class="flex items-center gap-4">
        <Skeleton class="h-9 w-44" />
        <Skeleton class="h-5 w-28" />
      </div>
      <div class="flex gap-4 overflow-x-auto">
        <div v-for="n in 4" :key="n" class="w-[300px] shrink-0 space-y-3">
          <Skeleton class="h-11 w-full rounded-xl" />
          <Skeleton v-for="m in 3" :key="m" class="h-24 w-full" />
        </div>
      </div>
    </div>

    <Card v-else-if="error" data-testid="roadmap-error">
      <CardContent class="text-center py-8">
        <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
        <p class="font-medium mb-2">Failed to load the roadmap</p>
        <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
        <Button variant="outline" @click="reload">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <template v-else>
      <div class="flex flex-wrap items-center gap-4" data-testid="roadmap-filters">
        <div class="flex items-center gap-2">
          <Icon name="lucide:tag" class="w-4 h-4 text-muted-foreground" />
          <select
            v-model="categoryFilter"
            class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="roadmap-category-filter"
            aria-label="Filter by category"
            @change="rebuildLists"
          >
            <option value="">All categories</option>
            <option v-for="category in categories" :key="category.key" :value="category.key">
              {{ category.name }}
            </option>
          </select>
        </div>
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <Switch :model-value="showHidden" data-testid="roadmap-show-hidden" @update:model-value="setShowHidden" />
          Show hidden
        </label>
      </div>

      <div class="overflow-x-auto pb-4" data-testid="roadmap-board">
        <div class="flex gap-4 min-w-max">
          <div
            v-for="column in columns"
            :key="column.value"
            :data-testid="`roadmap-column-${column.value}`"
            :data-column="column.value"
            :class="[
              'w-[300px] shrink-0 flex flex-col bg-muted/30 rounded-xl border transition-opacity',
              isBlockedColumn(column) ? 'opacity-50' : '',
            ]"
          >
            <div class="p-3 flex items-center justify-between border-b bg-card/50 rounded-t-xl">
              <div class="flex items-center gap-2 min-w-0">
                <span class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ backgroundColor: column.color }" />
                <h3 class="text-sm font-semibold truncate">{{ column.name }}</h3>
                <span
                  v-if="column.onlyProject"
                  class="text-xs text-muted-foreground truncate"
                  :data-testid="`roadmap-column-only-${column.value}`"
                >
                  · {{ column.onlyProject.name }} only
                </span>
              </div>
              <Badge variant="secondary" class="font-mono" :data-testid="`roadmap-count-${column.value}`">
                {{ lists[column.value]?.length ?? 0 }}
              </Badge>
            </div>
            <p
              v-if="isBlockedColumn(column)"
              class="px-3 pt-2 text-xs text-muted-foreground"
              :data-testid="`roadmap-column-blocked-${column.value}`"
            >
              {{ draggingProjectName }} has no "{{ column.name }}" status, so this item can't move here.
            </p>
            <VueDraggable
              v-model="lists[column.value]"
              :group="groupOptions"
              :animation="150"
              ghost-class="opacity-40"
              class="p-3 space-y-3 min-h-[200px] flex-1"
              :data-status="column.value"
              @start="onDragStart"
              @end="onDragEnd"
            >
              <NuxtLink
                v-for="item in lists[column.value]"
                :key="item.id"
                :to="`/feedback/${item.id}`"
                :data-id="item.id"
                :data-project-id="item.project?.id"
                :data-testid="`roadmap-card-${item.id}`"
                class="block"
                draggable="false"
              >
                <Card
                  :class="['hover:bg-accent/40 transition-colors', item.isHidden ? 'border-dashed' : '']"
                  :style="isAll ? { borderLeft: `3px solid ${projectColor(item.project)}` } : undefined"
                >
                  <CardContent class="p-3 space-y-2">
                    <p class="text-sm font-medium line-clamp-3">{{ item.title }}</p>
                    <ProjectTag
                      v-if="isAll && scopeProjectOf(item.project)"
                      :project="scopeProjectOf(item.project)"
                      :suffix="productSuffix(item)"
                      :data-testid="`roadmap-project-tag-${item.id}`"
                    />
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Badge
                        v-if="productName(item)"
                        variant="outline"
                        :data-testid="`roadmap-product-badge-${item.id}`"
                      >
                        {{ productName(item) }}
                      </Badge>
                      <Badge v-if="item.category" variant="secondary">{{ item.category.name }}</Badge>
                      <Badge v-if="item.isPinned" variant="outline" class="gap-1">
                        <Icon name="lucide:pin" class="w-3 h-3" />
                        Pinned
                      </Badge>
                      <Badge v-if="item.isHidden" variant="outline" class="gap-1">
                        <Icon name="lucide:eye-off" class="w-3 h-3" />
                        Hidden
                      </Badge>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-muted-foreground">
                      <span class="inline-flex items-center gap-1">
                        <Icon name="lucide:chevron-up" class="w-3.5 h-3.5" />
                        {{ item.voteCount }}
                      </span>
                      <span class="inline-flex items-center gap-1">
                        <Icon name="lucide:message-square" class="w-3.5 h-3.5" />
                        {{ item.commentCount }}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </NuxtLink>
            </VueDraggable>
          </div>
        </div>
      </div>
    </template>
  </PageContainer>
</template>

<script>
import { toast } from 'vue-sonner'
import { VueDraggable } from 'vue-draggable-plus'
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { cachedActiveProject, loadActiveProject } from '~/lib/active-project'
import {
  findScopeProject,
  isAllProjects,
  parseProjectFilter,
  projectFilterParam,
  readRememberedProjectFilter,
  scopeProjects,
  scopeProjectsWithModule,
} from '~/lib/project-scope'
import { canMoveToColumn, sortRoadmapItems } from '~/lib/roadmap-combined'

const HIDDEN_KEY = 'veerify_roadmap_show_hidden'

export default {
  name: 'DashboardRoadmapPage',

  created() {
    useHead({ title: 'Roadmap' })
    // Warm navigation: render and start the data fetch at once from the cache
    if (import.meta.client) {
      const cached = cachedActiveProject()
      if (cached !== undefined) this.onProductChange(cached, this.productFromRoute(cached))
    }
  },

  components: { VueDraggable },

  data() {
    return {
      contextReady: false,
      contextError: null,
      context: null,
      // All projects: chip selection (empty = every project), per-project data from the combined endpoint
      selectedIds: [],
      combinedProjects: [],
      combinedProducts: [],
      combinedCounts: {},
      draggingProjectId: '',
      project: null,
      products: [],
      productId: '',
      // Source of truth: columns as returned by the API (all items, incl. hidden)
      columns: [],
      // Filtered per-column views bound to the draggable lists
      lists: {},
      publicUrl: null,
      isLoading: false,
      error: null,
      disabledMessage: null,
      categoryFilter: '',
      showHidden: false,
      requestId: 0,
    }
  },

  computed: {
    isAdmin() {
      return this.project?.role === 'admin'
    },
    isAll() {
      return isAllProjects(this.context)
    },
    // Every scope project (chips show the ones with the roadmap off greyed out)
    scopeProjectList() {
      return scopeProjects(this.context)
    },
    showChips() {
      return this.isAll && this.contextReady && !this.contextError && this.scopeProjectList.length > 0
    },
    chipCounts() {
      // An empty map is a real answer (every project has zero items); only hide counts while loading.
      return this.isAll && !this.isLoading ? this.combinedCounts : null
    },
    publicRoadmaps() {
      return this.combinedProjects
        .filter((p) => p.publicUrl)
        .map((p) => ({ ...p, scopeProject: this.scopeProjectOf(p) }))
        .filter((p) => p.scopeProject)
    },
    draggingProjectName() {
      return this.combinedProjects.find((p) => p.id === this.draggingProjectId)?.name || 'This project'
    },
    // Items can only be dropped where their project has the status (All projects)
    groupOptions() {
      return {
        name: 'roadmap',
        pull: true,
        put: (to, from, dragEl) => this.canDropInto(to.el?.dataset?.status, dragEl?.dataset?.projectId),
      }
    },
    // Single project: by id. All projects: by name, since each project has its own categories.
    categories() {
      const seen = new Map()
      for (const column of this.columns) {
        for (const item of column.items) {
          const key = this.categoryKey(item.category)
          if (key && !seen.has(key)) seen.set(key, { key, name: item.category.name })
        }
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  },

  async mounted() {
    if (import.meta.client) {
      try {
        this.showHidden = localStorage.getItem(HIDDEN_KEY) === '1'
      } catch {
        // Ignore storage failures.
      }
      window.addEventListener('veerify:active-project-changed', this.onActiveProjectChanged)
    }
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

    scopeProjectOf(ref) {
      return findScopeProject(this.context, ref?.id)
    },

    projectColor(ref) {
      return this.scopeProjectOf(ref)?.identity?.color || 'transparent'
    },

    // "Product" next to the project, only for projects with several products
    productSuffix(item) {
      const products = this.combinedProducts.filter((p) => p.projectId === item.project?.id)
      if (products.length < 2) return ''
      return products.find((p) => p.id === item.productId)?.name || ''
    },

    categoryKey(category) {
      if (!category) return ''
      return this.isAll ? category.name.trim().toLowerCase() : category.id
    },

    canDropInto(status, projectId) {
      if (!this.isAll) return true
      const column = this.columns.find((c) => c.value === status)
      return !column || !projectId || canMoveToColumn(column, projectId)
    },

    isBlockedColumn(column) {
      return this.isAll && !!this.draggingProjectId && !canMoveToColumn(column, this.draggingProjectId)
    },

    // Sortable leaves a card in the last column that accepted it, so a release over a column its project
    // lacks would silently change the status to that other column. Find the column under the pointer.
    blockedColumnUnderPointer(evt) {
      const projectId = evt.item?.dataset?.projectId
      const pointer = evt.originalEvent
      if (!this.isAll || !projectId || typeof pointer?.clientX !== 'number') return null
      const value = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('[data-column]')
        ?.dataset?.column
      const column = this.columns.find((c) => c.value === value)
      return column && !canMoveToColumn(column, projectId) ? column : null
    },

    onDragStart(evt) {
      this.draggingProjectId = evt.item?.dataset?.projectId || ''
    },

    draggingProjectNameFor(evt) {
      return this.combinedProjects.find((p) => p.id === evt.item?.dataset?.projectId)?.name || 'This project'
    },

    initialSelection(context) {
      const selectable = scopeProjectsWithModule(context, 'roadmapEnabled')
      const valid = (ids) => ids.filter((id) => selectable.some((p) => p.id === id))
      const fromUrl = valid(parseProjectFilter(this.$route.query.projects))
      if (fromUrl.length > 0) return fromUrl
      return valid(readRememberedProjectFilter('roadmap', (context.projects ?? [])[0]?.organizationId))
    },

    async onSelectionChange(ids) {
      if (!this.isAll) return
      this.selectedIds = ids
      await this.loadCombined()
    },

    productFromRoute(context) {
      const products = context?.products || []
      const wanted = this.$route.query.productId
      return products.length > 1 && products.some((p) => p.id === wanted) ? wanted : ''
    },

    // Resolve the active project (cache first, in parallel with the picker) and load the board
    async bootstrap() {
      this.contextError = null
      try {
        const context = (await loadActiveProject()) || null
        const unchanged =
          this.contextReady &&
          isAllProjects(context) === this.isAll &&
          (context?.project?.id || null) === (this.project?.id || null) &&
          (isAllProjects(context)
            ? scopeProjectsWithModule(context, 'roadmapEnabled').length > 0
            : context?.modules?.roadmapEnabled === true) ===
            (this.disabledMessage === null)
        if (!unchanged) await this.onProductChange(context, this.productFromRoute(context))
      } catch (err) {
        this.contextError = apiErrorMessage(err, 'Failed to load the active project')
      }
    },

    setShowHidden(value) {
      this.showHidden = value === true
      if (import.meta.client) {
        try {
          localStorage.setItem(HIDDEN_KEY, this.showHidden ? '1' : '0')
        } catch {
          // Ignore storage failures.
        }
      }
      this.rebuildLists()
    },

    rebuildLists() {
      const lists = {}
      for (const column of this.columns) {
        lists[column.value] = column.items.filter(
          (item) =>
            (this.showHidden || !item.isHidden) &&
            (!this.categoryFilter || this.categoryKey(item.category) === this.categoryFilter)
        )
      }
      this.lists = lists
    },

    // Product tag on a card; only shown when the project has more than one product
    productName(item) {
      if (this.products.length < 2) return ''
      if (item.product?.name) return item.product.name
      return this.products.find((p) => p.id === item.productId)?.name || ''
    },

    async onProductChange(context, productId) {
      this.contextReady = true
      this.contextError = null
      this.context = context
      this.project = context?.project || null
      this.products = context?.products || []
      this.productId = productId || ''
      this.columns = []
      this.lists = {}
      this.publicUrl = null
      this.disabledMessage = null
      this.error = null
      this.categoryFilter = ''
      this.combinedProjects = []
      this.combinedProducts = []
      this.combinedCounts = {}
      if (!this.project) return
      if (isAllProjects(context)) {
        this.products = []
        this.productId = ''
        this.selectedIds = this.initialSelection(context)
        if (scopeProjectsWithModule(context, 'roadmapEnabled').length === 0) {
          this.disabledMessage = ''
          return
        }
        await this.loadCombined()
        return
      }
      if (context.modules?.roadmapEnabled !== true) {
        this.disabledMessage = ''
        return
      }
      await this.load()
    },

    // All projects: one request for the merged columns of the selected projects
    async loadCombined() {
      const requestId = ++this.requestId
      const isCurrent = () => this.requestId === requestId
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch('/api/roadmap/combined', {
          query: { projects: projectFilterParam(this.selectedIds) },
        })
        if (!isCurrent()) return
        this.columns = response?.data?.columns || []
        this.combinedProjects = response?.data?.projects || []
        this.combinedProducts = response?.data?.products || []
        this.combinedCounts = response?.data?.counts || {}
        this.categoryFilter = ''
        this.rebuildLists()
      } catch (err) {
        if (!isCurrent()) return
        this.error = apiErrorMessage(err, 'Failed to load the roadmap')
      } finally {
        if (isCurrent()) this.isLoading = false
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
      const requestId = ++this.requestId
      const isCurrent = () => this.requestId === requestId
      this.isLoading = true
      this.error = null
      this.disabledMessage = null
      try {
        const response = await $fetch(`/api/roadmap/projects/${projectId}`, {
          query: productId ? { productId } : {},
        })
        if (!isCurrent()) return
        this.columns = response?.data?.columns || []
        this.publicUrl = response?.data?.publicUrl || null
        if (response?.data?.products?.length) this.products = response.data.products
        this.rebuildLists()
      } catch (err) {
        if (!isCurrent()) return
        const message = apiErrorMessage(err, '')
        if (apiErrorStatus(err) === 403 && /^Roadmap is not enabled for this project$/.test(message)) {
          this.disabledMessage = message
        } else if (apiErrorStatus(err) === 403) {
          this.error = message || 'You do not have access to this project'
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the roadmap')
        }
      } finally {
        if (isCurrent()) this.isLoading = false
      }
    },

    /**
     * Moves the card in the source columns, then rebuilds the filtered lists
     * so they stay consistent with the data (filters make the list a subset).
     */
    moveItem(itemId, fromStatus, toStatus) {
      const from = this.columns.find((c) => c.value === fromStatus)
      const to = this.columns.find((c) => c.value === toStatus)
      if (!from || !to) return null
      const item = from.items.find((i) => i.id === itemId)
      if (!item) return null
      from.items = from.items.filter((i) => i.id !== itemId)
      item.status = toStatus
      to.items = sortRoadmapItems([...to.items, item])
      this.rebuildLists()
      return item
    },

    async onDragEnd(evt) {
      const blocked = this.blockedColumnUnderPointer(evt)
      this.draggingProjectId = ''
      if (blocked) {
        this.rebuildLists()
        toast.error(
          `${this.draggingProjectNameFor(evt)} has no "${blocked.name}" status, so this item can't move there`
        )
        return
      }
      const fromStatus = evt.from?.dataset?.status
      const toStatus = evt.to?.dataset?.status
      const itemId = evt.item?.dataset?.id
      if (!fromStatus || !toStatus || !itemId || fromStatus === toStatus) return

      const requestId = this.requestId
      // Optimistic move
      if (!this.moveItem(itemId, fromStatus, toStatus)) {
        this.rebuildLists()
        return
      }

      try {
        // Existing status endpoint: it fires subscriber notifications, GitHub sync and marketing hooks.
        await $fetch(`/api/feedback/${itemId}/status`, { method: 'PATCH', body: { status: toStatus } })
      } catch (err) {
        if (this.requestId === requestId) {
          this.moveItem(itemId, toStatus, fromStatus)
        }
        toast.error(apiErrorMessage(err, 'Failed to update the status'))
      }
    },
  },
}
</script>
