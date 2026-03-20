<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-7xl mx-auto space-y-8">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 data-testid="feedback-page-title" class="text-3xl font-bold tracking-tight text-foreground">Feedback</h1>
          <p class="text-muted-foreground mt-1">Manage and respond to user feedback and feature requests</p>
        </div>
        <div class="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                data-testid="feedback-products-filter-trigger"
                class="min-w-[200px] justify-between bg-background"
              >
                <span class="truncate">{{ selectedProductsLabel }}</span>
                <Icon name="lucide:chevrons-up-down" class="w-4 h-4 ml-2 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-[200px]">
              <DropdownMenuLabel>Products</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                data-testid="feedback-products-filter-all"
                :model-value="allProductsSelected"
                @select.prevent
                @update:model-value="toggleAllProducts"
              >
                All Products
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                v-for="p in products"
                :key="p.id"
                :data-testid="`feedback-products-filter-item-${p.id}`"
                :model-value="selectedProjectIds.includes(p.id)"
                @select.prevent
                @update:model-value="(checked) => toggleProjectSelection(p.id, checked)"
              >
                {{ p.name }}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            data-testid="feedback-export-button"
            :disabled="selectedProjectIds.length === 0 || isExporting"
            @click="exportCsv"
          >
            <Icon v-if="isExporting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            <Icon v-else name="lucide:download" class="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button data-testid="feedback-add-button" :disabled="!canCreateFeedback" @click="openCreateDialog()">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add Feedback
          </Button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" data-testid="feedback-loading" class="space-y-8">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card v-for="n in 4" :key="n">
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton class="h-4 w-24" />
              <Skeleton class="h-4 w-4 rounded-full" />
            </CardHeader>
            <CardContent>
              <Skeleton class="h-8 w-16" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <Skeleton class="h-6 w-40" />
          </CardHeader>
          <CardContent class="space-y-4">
            <div v-for="n in 3" :key="n" class="flex items-center space-x-4">
              <Skeleton class="h-12 w-12 rounded-full" />
              <div class="space-y-2">
                <Skeleton class="h-4 w-[250px]" />
                <Skeleton class="h-4 w-[200px]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Error State -->
      <Card v-else-if="error" data-testid="feedback-error" class="border-destructive/50 bg-destructive/10">
        <CardContent class="flex flex-col items-center justify-center py-12 text-center">
          <div class="rounded-full bg-destructive/20 p-3 mb-4">
            <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive" />
          </div>
          <h3 class="text-lg font-semibold mb-2">Failed to load feedback</h3>
          <p class="text-muted-foreground mb-6 max-w-md">{{ error }}</p>
          <Button variant="outline" @click="loadProducts">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </CardContent>
      </Card>

      <!-- No Products State -->
      <Card v-else-if="products.length === 0" class="border-dashed">
        <CardContent class="flex flex-col items-center justify-center py-16 text-center">
          <div class="rounded-full bg-muted p-4 mb-4">
            <Icon name="lucide:package" class="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 class="text-xl font-semibold mb-2">No products yet</h2>
          <p class="text-muted-foreground mb-6 max-w-sm">
            Create a product first to start collecting and managing feedback from your users.
          </p>
          <NuxtLink to="/products" prefetch-on="interaction">
            <Button>
              <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
              Create Product
            </Button>
          </NuxtLink>
        </CardContent>
      </Card>

      <!-- Main Content -->
      <div v-else class="space-y-6">
        <!-- Stats Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">Total Feedback</CardTitle>
              <Icon name="lucide:message-square" class="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div data-testid="feedback-stat-total" class="text-2xl font-bold">{{ pagination.total }}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">Open</CardTitle>
              <Icon name="lucide:clock" class="w-4 h-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">{{ statusCounts.open }}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">In Progress</CardTitle>
              <Icon name="lucide:play-circle" class="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">{{ statusCounts.in_progress }}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">Completed</CardTitle>
              <Icon name="lucide:check-circle-2" class="w-4 h-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">{{ statusCounts.completed }}</div>
            </CardContent>
          </Card>
        </div>

        <!-- Filters Toolbar -->
        <div
          class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card p-2 rounded-lg border shadow-sm"
        >
          <div class="flex items-center p-1 bg-muted/50 rounded-md border shrink-0">
            <Button
              data-testid="feedback-view-kanban"
              size="sm"
              :variant="viewMode === 'kanban' ? 'secondary' : 'ghost'"
              class="h-8 px-3"
              @click="onViewModeChange('kanban')"
            >
              <Icon name="lucide:kanban" class="w-4 h-4 mr-2" />
              Board
            </Button>
            <Button
              data-testid="feedback-view-table"
              size="sm"
              :variant="viewMode === 'table' ? 'secondary' : 'ghost'"
              class="h-8 px-3"
              @click="onViewModeChange('table')"
            >
              <Icon name="lucide:list" class="w-4 h-4 mr-2" />
              List
            </Button>
          </div>

          <div class="flex items-center gap-2 w-full sm:w-auto">
            <!-- Search — always visible in both views -->
            <div class="relative flex-1 sm:w-[200px]">
              <Icon
                name="lucide:search"
                class="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none"
              />
              <Input
                v-model="searchQuery"
                data-testid="feedback-search"
                placeholder="Search feedback…"
                class="pl-8 h-9 text-sm"
                @input="onSearchInput"
              />
            </div>
            <!-- Status + Sort — always rendered to preserve toolbar height; hidden in kanban view -->
            <div
              class="relative flex-1 sm:w-[180px]"
              :class="{ 'invisible pointer-events-none': viewMode === 'kanban' }"
            >
              <select
                v-model="statusFilter"
                data-testid="feedback-status-filter"
                class="w-full h-9 pl-3 pr-8 text-sm bg-background border rounded-md appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                @change="onFilterChange()"
              >
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="closed">Closed</option>
                <option value="declined">Declined</option>
              </select>
              <Icon
                name="lucide:chevron-down"
                class="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>
        </div>

        <!-- Feedback Loading -->
        <div v-if="isFeedbackLoading" class="space-y-4">
          <Card v-for="n in 3" :key="n">
            <CardContent class="p-6">
              <Skeleton class="h-5 w-1/3 mb-3" />
              <Skeleton class="h-4 w-full mb-2" />
              <Skeleton class="h-4 w-2/3" />
            </CardContent>
          </Card>
        </div>

        <!-- Feedback Error -->
        <Card v-else-if="feedbackError" class="border-destructive/50 bg-destructive/10">
          <CardContent class="flex flex-col items-center justify-center py-8 text-center">
            <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mb-3" />
            <p class="text-muted-foreground mb-4">{{ feedbackError }}</p>
            <Button variant="outline" size="sm" @click="loadFeedback">
              <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>

        <!-- Empty Feedback State -->
        <Card v-else-if="feedbackItems.length === 0" data-testid="feedback-empty" class="border-dashed">
          <CardContent class="flex flex-col items-center justify-center py-16 text-center">
            <div class="rounded-full bg-muted p-4 mb-4">
              <Icon name="lucide:message-square-plus" class="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 class="text-xl font-semibold mb-2">No feedback yet</h2>
            <p class="text-muted-foreground mb-6 max-w-sm">
              Get started by adding your first piece of feedback or feature request.
            </p>
            <Button @click="openCreateDialog()">
              <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
              Add Feedback
            </Button>
          </CardContent>
        </Card>

        <!-- Feedback Content -->
        <div v-else data-testid="feedback-list" class="space-y-4">
          <template v-if="viewMode === 'kanban'">
            <div data-testid="feedback-kanban" class="overflow-x-auto pb-4">
              <div class="flex gap-4 min-w-max">
                <div
                  v-for="column in kanbanColumns"
                  :key="column.value"
                  :data-testid="`feedback-kanban-column-${column.value}`"
                  class="w-[320px] shrink-0 flex flex-col bg-muted/30 rounded-xl border"
                >
                  <div class="p-3 flex items-center justify-between border-b bg-card/50 rounded-t-xl">
                    <div class="flex items-center gap-2">
                      <div :class="`p-1 rounded-md ${column.colorClass}`">
                        <Icon :name="column.icon" class="w-4 h-4" />
                      </div>
                      <h3 class="text-sm font-semibold">{{ column.label }}</h3>
                    </div>
                    <Badge variant="secondary" class="font-mono">{{ kanbanData[column.value]?.length ?? 0 }}</Badge>
                  </div>
                  <div class="relative flex-1 min-h-[500px]">
                    <VueDraggable
                      v-model="kanbanData[column.value]"
                      :group="{ name: 'kanban', pull: true, put: true }"
                      :animation="150"
                      ghost-class="opacity-40"
                      chosen-class="shadow-lg"
                      class="p-3 space-y-3 min-h-[500px]"
                      :data-status="column.value"
                      @end="onKanbanDragEnd"
                    >
                      <Card
                        v-for="item in kanbanData[column.value]"
                        :key="item.id"
                        class="group cursor-grab active:cursor-grabbing hover:border-primary/50 transition-all select-none"
                        @click="$router.push(`/feedback/${item.id}`)"
                        @pointerenter="prewarmFeedbackRoute(item.id)"
                      >
                        <CardContent class="p-4">
                          <div class="flex items-start justify-between gap-2 mb-2">
                            <h4 class="text-sm font-medium leading-tight line-clamp-2">{{ item.title }}</h4>
                            <DropdownMenu>
                              <DropdownMenuTrigger as-child @click.stop>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  class="h-6 w-6 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Icon name="lucide:more-vertical" class="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem class="text-destructive" @click.stop="confirmDelete(item)">
                                  <Icon name="lucide:trash-2" class="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <p v-if="item.body" class="text-xs text-muted-foreground mb-4 line-clamp-2">
                            {{ item.body }}
                          </p>
                          <div class="flex items-center justify-between mt-auto">
                            <div class="flex items-center gap-3 text-xs text-muted-foreground">
                              <div class="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded-md">
                                <Icon name="lucide:chevron-up" class="w-3 h-3" />
                                <span class="font-medium">{{ item.voteCount }}</span>
                              </div>
                              <div class="flex items-center gap-1">
                                <Icon name="lucide:message-circle" class="w-3 h-3" />
                                <span>{{ item.commentCount }}</span>
                              </div>
                            </div>
                            <Badge v-if="item.category" variant="outline" class="text-[10px] px-1.5 py-0 font-normal">
                              {{ item.category.name }}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </VueDraggable>
                    <div
                      v-if="!kanbanData[column.value]?.length"
                      class="absolute inset-0 pointer-events-none flex items-start justify-center pt-3"
                    >
                      <div
                        class="h-24 w-full border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm"
                      >
                        Drop here
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <Card data-testid="feedback-table-wrapper" class="overflow-hidden p-0">
              <div class="overflow-x-auto">
                <table data-testid="feedback-table" class="w-full text-sm text-left">
                  <thead class="bg-muted/50 text-muted-foreground border-b">
                    <tr>
                      <th
                        class="font-medium px-4 py-3 w-[40%] cursor-pointer select-none hover:text-foreground"
                        @click="onSortBy('title')"
                      >
                        <span class="flex items-center gap-1">
                          Feedback
                          <Icon
                            v-if="sortBy === 'title'"
                            :name="sortOrder === 'asc' ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                            class="w-3 h-3"
                          />
                          <Icon v-else name="lucide:chevrons-up-down" class="w-3 h-3 opacity-30" />
                        </span>
                      </th>
                      <th class="font-medium px-4 py-3">Product</th>
                      <th class="font-medium px-4 py-3">Status</th>
                      <th
                        class="font-medium px-4 py-3 text-right cursor-pointer select-none hover:text-foreground"
                        @click="onSortBy('voteCount')"
                      >
                        <span class="flex items-center justify-end gap-1">
                          Votes
                          <Icon
                            v-if="sortBy === 'voteCount'"
                            :name="sortOrder === 'asc' ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                            class="w-3 h-3"
                          />
                          <Icon v-else name="lucide:chevrons-up-down" class="w-3 h-3 opacity-30" />
                        </span>
                      </th>
                      <th class="font-medium px-4 py-3 text-right">Comments</th>
                      <th v-if="showGithubIssueColumn" class="font-medium px-4 py-3">GitHub</th>
                      <th
                        class="font-medium px-4 py-3 cursor-pointer select-none hover:text-foreground"
                        @click="onSortBy('updatedAt')"
                      >
                        <span class="flex items-center gap-1">
                          Updated
                          <Icon
                            v-if="sortBy === 'updatedAt'"
                            :name="sortOrder === 'asc' ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                            class="w-3 h-3"
                          />
                          <Icon v-else name="lucide:chevrons-up-down" class="w-3 h-3 opacity-30" />
                        </span>
                      </th>
                      <th class="font-medium px-4 py-3 text-right" />
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="item in feedbackItems"
                      :key="item.id"
                      :data-testid="`feedback-item-${item.id}`"
                      class="hover:bg-muted/30 transition-colors group cursor-pointer"
                      @click="$router.push(`/feedback/${item.id}`)"
                    >
                      <td class="px-4 py-3 align-top">
                        <NuxtLink
                          :to="`/feedback/${item.id}`"
                          prefetch-on="interaction"
                          class="font-medium text-foreground hover:text-primary transition-colors block"
                        >
                          {{ item.title }}
                        </NuxtLink>
                        <p v-if="item.body" class="text-xs text-muted-foreground mt-1 line-clamp-1">{{ item.body }}</p>
                      </td>
                      <td class="px-4 py-3 align-top">
                        <span class="text-muted-foreground">{{ item.project?.name || 'Unknown' }}</span>
                      </td>
                      <td class="px-4 py-3 align-top">
                        <Badge :variant="statusBadgeVariant(item.status)" class="font-normal">{{
                          formatStatus(item.status)
                        }}</Badge>
                      </td>
                      <td class="px-4 py-3 align-top text-right">
                        <div
                          class="inline-flex items-center justify-end gap-1 bg-muted/50 px-2 py-0.5 rounded-md text-xs font-medium"
                        >
                          <Icon name="lucide:chevron-up" class="w-3 h-3 text-muted-foreground" />
                          {{ item.voteCount }}
                        </div>
                      </td>
                      <td class="px-4 py-3 align-top text-right text-muted-foreground tabular-nums">
                        {{ item.commentCount }}
                      </td>
                      <td v-if="showGithubIssueColumn" class="px-4 py-3 align-top">
                        <a
                          v-if="item.githubIssue?.issueUrl"
                          :href="item.githubIssue.issueUrl"
                          class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline bg-primary/10 px-2 py-0.5 rounded-md"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Icon name="lucide:github" class="w-3 h-3" />
                          #{{ item.githubIssue.issueNumber }}
                        </a>
                        <Button
                          v-else-if="canCreateGithubIssue(item)"
                          size="sm"
                          variant="outline"
                          class="h-7 text-xs px-2"
                          :disabled="isCreatingGithubIssue(item.id)"
                          :data-testid="`feedback-table-create-issue-${item.id}`"
                          @click="createGithubIssue(item)"
                        >
                          <Icon
                            v-if="isCreatingGithubIssue(item.id)"
                            name="lucide:loader-2"
                            class="w-3 h-3 mr-1.5 animate-spin"
                          />
                          <Icon v-else name="lucide:plus" class="w-3 h-3 mr-1.5" />
                          Create Issue
                        </Button>
                        <span v-else class="text-muted-foreground text-xs">-</span>
                      </td>
                      <td class="px-4 py-3 align-top text-muted-foreground text-xs whitespace-nowrap">
                        {{ formatDate(item.updatedAt) }}
                      </td>
                      <td class="px-4 py-3 align-top text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          :data-testid="`feedback-item-delete-${item.id}`"
                          title="Delete feedback"
                          @click.stop="confirmDelete(item)"
                        >
                          <Icon name="lucide:trash-2" class="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </template>

          <!-- Pagination -->
          <div v-if="pagination.totalPages > 1" class="flex items-center justify-between pt-4">
            <div class="text-sm text-muted-foreground">
              Showing page <span class="font-medium text-foreground">{{ pagination.page }}</span> of
              <span class="font-medium text-foreground">{{ pagination.totalPages }}</span>
            </div>
            <div class="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="pagination.page <= 1"
                @click="goToPage(pagination.page - 1)"
              >
                <Icon name="lucide:chevron-left" class="w-4 h-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="pagination.page >= pagination.totalPages"
                @click="goToPage(pagination.page + 1)"
              >
                Next
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Create Feedback Dialog -->
      <Dialog
        :open="showCreateDialog"
        @update:open="
          (v) => {
            if (!v) closeCreateDialog()
          }
        "
      >
        <DialogContent class="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {{
                createDialogStep === 'select-project'
                  ? 'Select Product'
                  : createDialogStep === 'select-type'
                    ? 'Select Feedback Type'
                    : 'Add Feedback'
              }}
            </DialogTitle>
            <DialogDescription>
              {{
                createDialogStep === 'select-project'
                  ? 'Choose which product to submit feedback for.'
                  : createDialogStep === 'select-type'
                    ? 'Choose the feedback type first, then add details.'
                    : `Create a new feedback item for ${products.find((p) => p.id === createForm.projectId)?.name || 'this product'}.`
              }}
            </DialogDescription>
          </DialogHeader>

          <!-- Step 1: Project picker (multi-product only) -->
          <div v-if="createDialogStep === 'select-project'" class="py-2">
            <div class="max-h-[320px] overflow-y-auto space-y-2 pr-1">
              <button
                v-for="p in products.filter((prod) => selectedProjectIds.includes(prod.id))"
                :key="p.id"
                :data-testid="`feedback-create-project-${p.id}`"
                type="button"
                class="w-full text-left rounded-lg border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="selectDialogProject(p)"
              >
                <div class="flex items-center gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon name="lucide:package" class="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p class="text-sm font-medium leading-none">{{ p.name }}</p>
                    <p v-if="p.description" class="mt-1 text-xs text-muted-foreground line-clamp-1">
                      {{ p.description }}
                    </p>
                  </div>
                  <Icon name="lucide:chevron-right" class="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            </div>
          </div>

          <!-- Step 2: Feedback type picker -->
          <div v-else-if="createDialogStep === 'select-type'" class="py-2">
            <div class="space-y-2">
              <button
                v-for="type in feedbackTypeOptions"
                :key="type.value"
                :data-testid="`feedback-create-type-${type.value}`"
                type="button"
                class="w-full text-left rounded-lg border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="selectFeedbackType(type.value)"
              >
                <div class="flex items-start gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon :name="type.icon" class="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium leading-none">{{ type.label }}</p>
                    <p class="mt-1 text-xs text-muted-foreground">{{ type.description }}</p>
                  </div>
                  <Icon name="lucide:chevron-right" class="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            </div>
          </div>

          <!-- Step 3: Feedback form -->
          <div v-else class="space-y-4 py-4">
            <div
              v-if="selectedFeedbackType"
              class="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2"
            >
              <div class="flex items-center gap-2 text-sm">
                <Icon :name="selectedFeedbackType.icon" class="w-4 h-4 text-muted-foreground" />
                <span class="font-medium">{{ selectedFeedbackType.label }}</span>
              </div>
              <Button variant="ghost" size="sm" class="h-7 px-2" @click="createDialogStep = 'select-type'">
                Change
              </Button>
            </div>
            <div class="space-y-2">
              <Label for="feedback-title">Title</Label>
              <Input
                id="feedback-title"
                v-model="createForm.title"
                data-testid="feedback-create-title"
                placeholder="Brief summary of the feedback"
              />
            </div>
            <div class="space-y-2">
              <Label for="feedback-body">Description</Label>
              <textarea
                id="feedback-body"
                v-model="createForm.body"
                data-testid="feedback-create-body"
                placeholder="Provide details about the feedback"
                rows="4"
                class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div v-if="isLoadingDialogCategories" class="space-y-2">
              <Skeleton class="h-4 w-20" />
              <Skeleton class="h-10 w-full" />
            </div>
            <div v-else-if="dialogCategories.length > 0" class="space-y-2">
              <Label for="feedback-category">Category</Label>
              <select
                id="feedback-category"
                v-model="createForm.categoryId"
                data-testid="feedback-create-category"
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option :value="null">No category</option>
                <option v-for="cat in dialogCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              v-if="
                createDialogStep === 'fill-form' ||
                (createDialogStep === 'select-type' && selectedProjectIds.length > 1)
              "
              variant="ghost"
              class="mr-auto"
              @click="createDialogBack"
            >
              <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button variant="outline" @click="closeCreateDialog">Cancel</Button>
            <Button
              v-if="createDialogStep === 'fill-form'"
              data-testid="feedback-create-submit"
              :disabled="isCreating || !createForm.title || !createForm.body"
              @click="createFeedback"
            >
              <Icon v-if="isCreating" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Add Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Delete Confirmation Dialog -->
      <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
        <DialogContent class="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Feedback</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{{ feedbackToDelete?.title }}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
            <Button
              data-testid="feedback-delete-confirm"
              variant="destructive"
              :disabled="isDeleting"
              @click="deleteFeedback"
            >
              <Icon v-if="isDeleting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </NuxtLayout>
</template>

<script>
import { VueDraggable } from 'vue-draggable-plus'

const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'FeedbackPage',

  components: { VueDraggable },

  data() {
    return {
      products: [],
      selectedProjectIds: [],
      activeTeamId: '',
      activeOrgSlug: '',

      feedbackItems: [],
      categories: [],
      dialogCategories: [],
      githubIntegrationsByProjectId: {},
      creatingGithubIssueFeedbackIds: [],
      statusCounts: { open: 0, in_progress: 0, completed: 0 },

      isLoading: true,
      isFeedbackLoading: false,
      error: null,
      feedbackError: null,

      showCreateDialog: false,
      isCreating: false,
      createDialogStep: 'select-project',
      isLoadingDialogCategories: false,
      feedbackTypeOptions: [
        {
          value: 'feature_request',
          label: 'Feature request',
          icon: 'lucide:lightbulb',
          description: 'Suggest a new feature or enhancement.',
        },
        {
          value: 'bug_report',
          label: 'Bug report',
          icon: 'lucide:bug',
          description: 'Report something that is broken or not working as expected.',
        },
        {
          value: 'improvement',
          label: 'Improvement',
          icon: 'lucide:wrench',
          description: 'Propose improvements to an existing workflow.',
        },
        {
          value: 'question',
          label: 'Question',
          icon: 'lucide:circle-help',
          description: 'Ask for clarification or request additional guidance.',
        },
        {
          value: 'other',
          label: 'Other',
          icon: 'lucide:message-square',
          description: 'Share feedback that does not fit a specific type.',
        },
      ],
      createForm: { title: '', body: '', categoryId: null, projectId: '', feedbackType: '' },

      isExporting: false,

      showDeleteDialog: false,
      isDeleting: false,
      feedbackToDelete: null,

      viewMode: (import.meta.client && localStorage.getItem('feedback:viewMode')) || 'kanban',
      statusFilter: '',
      sortBy: 'voteCount',
      sortOrder: 'desc',
      searchQuery: '',
      searchTimer: null,
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

      kanbanData: {
        open: [],
        in_progress: [],
        planned: [],
        completed: [],
        closed: [],
        declined: [],
      },
      prewarmedFeedbackRoutes: {},
    }
  },

  computed: {
    selectedProjectId() {
      return this.selectedProjectIds.length === 1 ? this.selectedProjectIds[0] : ''
    },
    selectedProject() {
      return this.products.find((p) => p.id === this.selectedProjectId) || null
    },
    allProductsSelected() {
      return this.products.length > 0 && this.selectedProjectIds.length === this.products.length
    },
    selectedProductsLabel() {
      if (this.products.length === 0) return 'No products'
      if (this.allProductsSelected) return 'ALL products'
      if (this.selectedProjectIds.length === 1) {
        return this.selectedProject?.name || '1 product selected'
      }
      return `${this.selectedProjectIds.length} products selected`
    },
    canCreateFeedback() {
      return this.selectedProjectIds.length > 0
    },
    showGithubIssueColumn() {
      return this.selectedProjectIds.some((projectId) => this.hasGithubIntegration(projectId))
    },
    selectedFeedbackType() {
      return this.feedbackTypeOptions.find((type) => type.value === this.createForm.feedbackType) || null
    },
    kanbanColumns() {
      return [
        { value: 'open', label: 'Open', icon: 'lucide:clock-3', colorClass: 'bg-orange-500/10 text-orange-500' },
        {
          value: 'in_progress',
          label: 'In Progress',
          icon: 'lucide:play-circle',
          colorClass: 'bg-blue-500/10 text-blue-500',
        },
        {
          value: 'planned',
          label: 'Planned',
          icon: 'lucide:calendar-range',
          colorClass: 'bg-purple-500/10 text-purple-500',
        },
        {
          value: 'completed',
          label: 'Completed',
          icon: 'lucide:check-circle-2',
          colorClass: 'bg-green-500/10 text-green-500',
        },
        { value: 'closed', label: 'Closed', icon: 'lucide:archive', colorClass: 'bg-gray-500/10 text-gray-500' },
        { value: 'declined', label: 'Declined', icon: 'lucide:x-circle', colorClass: 'bg-red-500/10 text-red-500' },
      ]
    },
  },

  async mounted() {
    await this.initTeamContext()

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
      await this.initTeamContext()
    },

    async initTeamContext() {
      this.isLoading = true
      this.error = null

      try {
        const teamResponse = await $fetch('/api/teams/active')
        const activeTeamData = teamResponse?.data

        if (!activeTeamData?.id) {
          this.error = 'No active team found'
          this.isLoading = false
          return
        }

        this.activeTeamId = activeTeamData.id

        // Extract organization slug from the response
        if (activeTeamData.organization?.slug) {
          this.activeOrgSlug = activeTeamData.organization.slug
        }

        await this.loadProducts()
      } catch (err) {
        console.error('Error initializing team context:', err)
        this.error = err?.data?.message || 'Failed to load team context'
        this.isLoading = false
      }
    },

    async loadProducts() {
      if (!this.activeTeamId) return

      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/teams/${this.activeTeamId}/projects`)
        this.products = response?.data || []

        if (this.products.length > 0) {
          this.selectedProjectIds = this.resolveInitialProjectSelection()
          await this.onProjectChange()
        } else {
          this.selectedProjectIds = []
          this.feedbackItems = []
          this.categories = []
          this.githubIntegrationsByProjectId = {}
          this.updateStatusCounts()
        }
      } catch (err) {
        console.error('Error loading products:', err)
        this.error = 'Failed to load products. Please try again.'
      } finally {
        this.isLoading = false
      }
    },

    resolveInitialProjectSelection() {
      const validIds = new Set(this.products.map((product) => product.id))
      const rawProjectIds = this.$route.query.projectIds
      const rawProjectId = this.$route.query.projectId

      const requestedIdsFromList = []
      if (typeof rawProjectIds === 'string') {
        requestedIdsFromList.push(...rawProjectIds.split(','))
      } else if (Array.isArray(rawProjectIds)) {
        for (const value of rawProjectIds) {
          requestedIdsFromList.push(...String(value).split(','))
        }
      }

      const requestedIds = requestedIdsFromList
        .map((id) => id.trim())
        .filter(Boolean)
        .filter((id) => validIds.has(id))

      if (requestedIds.length > 0) {
        return this.sortProjectIdsByProductOrder(requestedIds)
      }

      if (typeof rawProjectId === 'string' && validIds.has(rawProjectId)) {
        return [rawProjectId]
      }

      return this.products.map((product) => product.id)
    },

    sortProjectIdsByProductOrder(projectIds) {
      const uniqueIds = [...new Set(projectIds)]
      const productOrder = new Map(this.products.map((product, index) => [product.id, index]))
      return uniqueIds.sort((a, b) => (productOrder.get(a) ?? Infinity) - (productOrder.get(b) ?? Infinity))
    },

    syncProjectQuery() {
      if (!import.meta.client) return

      const query = { ...this.$route.query }
      delete query.projectId
      delete query.projectIds

      if (this.selectedProjectIds.length === 1) {
        query.projectId = this.selectedProjectIds[0]
      } else if (this.selectedProjectIds.length > 1 && !this.allProductsSelected) {
        query.projectIds = this.selectedProjectIds.join(',')
      }

      this.$router.replace({ query }).catch(() => {})
    },

    async toggleAllProducts(checked) {
      if (checked === true) {
        this.selectedProjectIds = this.products.map((product) => product.id)
      } else if (this.products.length > 0) {
        this.selectedProjectIds = [this.products[0].id]
      }
      await this.onProjectChange()
    },

    async toggleProjectSelection(projectId, checked) {
      const selected = new Set(this.selectedProjectIds)

      if (checked === true) {
        selected.add(projectId)
      } else if (selected.size > 1) {
        selected.delete(projectId)
      }

      this.selectedProjectIds = this.sortProjectIdsByProductOrder([...selected])
      await this.onProjectChange()
    },

    async onProjectChange() {
      if (this.selectedProjectIds.length === 0 && this.products.length > 0) {
        this.selectedProjectIds = [this.products[0].id]
      }
      this.selectedProjectIds = this.sortProjectIdsByProductOrder(this.selectedProjectIds)
      this.syncProjectQuery()
      this.pagination.page = 1
      await Promise.all([this.loadFeedback(), this.loadCategories(), this.loadGithubIntegrations()])
    },

    async loadFeedback() {
      if (this.selectedProjectIds.length === 0) {
        this.feedbackItems = []
        this.pagination = { ...this.pagination, page: 1, total: 0, totalPages: 0 }
        this.buildKanbanData()
        this.updateStatusCounts()
        return
      }

      this.isFeedbackLoading = true
      this.feedbackError = null

      try {
        const params = new URLSearchParams({
          projectIds: this.selectedProjectIds.join(','),
          page: String(this.pagination.page),
          limit: String(this.pagination.limit),
        })
        if (this.searchQuery.trim()) params.set('search', this.searchQuery.trim())
        if (this.viewMode === 'table') {
          params.set('sortBy', this.sortBy)
          params.set('sortOrder', this.sortOrder)
          if (this.statusFilter) params.set('status', this.statusFilter)
        } else {
          params.set('sortBy', 'updatedAt')
          params.set('sortOrder', 'desc')
        }

        const response = await $fetch(`/api/feedback?${params}`)
        this.feedbackItems = (response?.data?.items || []).map((item) => ({
          ...item,
          githubIssue: item.githubIssue || null,
        }))
        this.pagination = response?.data?.pagination || this.pagination
        this.buildKanbanData()
        this.updateStatusCounts()
      } catch (err) {
        console.error('Error loading feedback:', err)
        this.feedbackError = 'Failed to load feedback. Please try again.'
      } finally {
        this.isFeedbackLoading = false
      }
    },

    async loadCategories() {
      const proj = this.selectedProject
      if (!proj?.slug) {
        this.categories = []
        this.createForm.categoryId = null
        return
      }

      try {
        const response = await $fetch(`/api/projects/${proj.slug}/categories`)
        this.categories = response?.data || []
        if (
          this.createForm.categoryId &&
          !this.categories.find((category) => category.id === this.createForm.categoryId)
        ) {
          this.createForm.categoryId = null
        }
      } catch (err) {
        console.error('Error loading categories:', err)
      }
    },

    async loadGithubIntegrations() {
      if (this.selectedProjectIds.length === 0) {
        this.githubIntegrationsByProjectId = {}
        return
      }

      const integrations = {}
      await Promise.all(
        this.selectedProjectIds.map(async (projectId) => {
          const project = this.products.find((p) => p.id === projectId)
          if (!project?.slug) {
            integrations[projectId] = null
            return
          }

          try {
            const response = await $fetch(`/api/projects/${project.slug}/github`)
            integrations[projectId] = response?.data || null
          } catch (err) {
            console.error(`Error loading GitHub integration for project ${project.slug}:`, err)
            integrations[projectId] = null
          }
        })
      )

      this.githubIntegrationsByProjectId = integrations
    },

    openCreateDialog() {
      if (this.selectedProjectIds.length === 0) return
      this.createForm = { title: '', body: '', categoryId: null, projectId: '', feedbackType: '' }
      if (this.selectedProjectIds.length === 1) {
        this.createForm.projectId = this.selectedProjectIds[0]
        this.createDialogStep = 'select-type'
      } else {
        this.createDialogStep = 'select-project'
      }
      this.showCreateDialog = true
    },

    selectDialogProject(project) {
      this.createForm.projectId = project.id
      this.createForm.categoryId = null
      this.createForm.feedbackType = ''
      this.createDialogStep = 'select-type'
    },

    async selectFeedbackType(type) {
      this.createForm.feedbackType = type
      this.createDialogStep = 'fill-form'
      await this.loadDialogCategories()
    },

    createDialogBack() {
      if (this.createDialogStep === 'fill-form') {
        this.createDialogStep = 'select-type'
        return
      }

      if (this.createDialogStep === 'select-type' && this.selectedProjectIds.length > 1) {
        this.createDialogStep = 'select-project'
      }
    },

    syncCategoryWithFeedbackType() {
      if (!this.createForm.feedbackType || this.dialogCategories.length === 0 || this.createForm.categoryId) return

      const keywordMap = {
        bug_report: ['bug'],
        feature_request: ['feature', 'request'],
        improvement: ['improvement', 'enhancement'],
        question: ['question', 'support'],
      }

      const keywords = keywordMap[this.createForm.feedbackType] || []
      const matchedCategory = this.dialogCategories.find((category) => {
        const categoryName = String(category.name || '').toLowerCase()
        return keywords.some((keyword) => categoryName.includes(keyword))
      })

      if (matchedCategory) {
        this.createForm.categoryId = matchedCategory.id
      }
    },

    async loadDialogCategories() {
      const project = this.products.find((p) => p.id === this.createForm.projectId)
      if (!project?.slug) {
        this.dialogCategories = []
        return
      }
      this.isLoadingDialogCategories = true
      try {
        const response = await $fetch(`/api/projects/${project.slug}/categories`)
        this.dialogCategories = response?.data || []
        this.syncCategoryWithFeedbackType()
      } catch (err) {
        console.error('Error loading categories for dialog:', err)
        this.dialogCategories = []
      } finally {
        this.isLoadingDialogCategories = false
      }
    },

    closeCreateDialog() {
      this.showCreateDialog = false
      this.createDialogStep = 'select-project'
      this.isLoadingDialogCategories = false
      this.dialogCategories = []
      this.createForm = { title: '', body: '', categoryId: null, projectId: '', feedbackType: '' }
    },

    hasGithubIntegration(projectId) {
      const integration = this.githubIntegrationsByProjectId[projectId]
      return Boolean(integration?.repoFullName && integration?.hasAccessToken)
    },

    canCreateGithubIssue(item) {
      return !item.githubIssue && this.hasGithubIntegration(item.projectId)
    },

    isCreatingGithubIssue(feedbackId) {
      return this.creatingGithubIssueFeedbackIds.includes(feedbackId)
    },

    async createGithubIssue(item) {
      if (!this.canCreateGithubIssue(item) || this.isCreatingGithubIssue(item.id)) return

      const integration = this.githubIntegrationsByProjectId[item.projectId]
      const repo = integration?.repoFullName
      if (!repo) return

      this.creatingGithubIssueFeedbackIds = [...this.creatingGithubIssueFeedbackIds, item.id]
      try {
        const response = await $fetch('/api/github/issues', {
          method: 'POST',
          body: {
            feedbackId: item.id,
            repo,
          },
        })

        const issue = response?.data?.issue
        if (issue) {
          item.githubIssue = {
            issueNumber: issue.number,
            issueUrl: issue.html_url,
            issueState: issue.state,
          }
        }

        const updatedFeedback = response?.data?.feedback
        if (updatedFeedback) {
          item.status = updatedFeedback.status
          item.updatedAt = updatedFeedback.updatedAt
        }

        this.updateStatusCounts()
      } catch (err) {
        console.error('Error creating GitHub issue:', err)
        alert(err?.data?.error?.message || 'Failed to create GitHub issue')
      } finally {
        this.creatingGithubIssueFeedbackIds = this.creatingGithubIssueFeedbackIds.filter(
          (feedbackId) => feedbackId !== item.id
        )
      }
    },

    updateStatusCounts() {
      const counts = { open: 0, in_progress: 0, completed: 0 }
      for (const item of this.feedbackItems) {
        if (item.status in counts) {
          counts[item.status]++
        }
      }
      this.statusCounts = counts
    },

    onSearchInput() {
      if (this.searchTimer) clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(async () => {
        this.pagination.page = 1
        await this.loadFeedback()
      }, 300)
    },

    async onFilterChange() {
      if (this.viewMode !== 'table') return
      this.pagination.page = 1
      await this.loadFeedback()
    },

    async onSortBy(field) {
      if (this.sortBy === field) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'
      } else {
        this.sortBy = field
        this.sortOrder = 'desc'
      }
      this.pagination.page = 1
      await this.loadFeedback()
    },

    async onViewModeChange(mode) {
      if (this.viewMode === mode) return

      this.viewMode = mode
      if (import.meta.client) localStorage.setItem('feedback:viewMode', mode)
      this.pagination.page = 1
      if (mode === 'kanban') {
        this.statusFilter = ''
      }
      await this.loadFeedback()
    },

    async goToPage(page) {
      this.pagination.page = page
      await this.loadFeedback()
    },

    async createFeedback() {
      if (!this.createForm.projectId || !this.createForm.title || !this.createForm.body) return
      if (!this.createForm.feedbackType) return

      this.isCreating = true

      try {
        await $fetch('/api/feedback', {
          method: 'POST',
          body: {
            projectId: this.createForm.projectId,
            title: this.createForm.title,
            body: this.createForm.body,
            categoryId: this.createForm.categoryId || null,
            feedbackType: this.createForm.feedbackType,
          },
        })

        this.showCreateDialog = false
        this.createForm = { title: '', body: '', categoryId: null, projectId: '', feedbackType: '' }
        await this.loadFeedback()
      } catch (err) {
        console.error('Error creating feedback:', err)
        alert(err?.data?.error?.message || 'Failed to create feedback')
      } finally {
        this.isCreating = false
      }
    },

    confirmDelete(item) {
      this.feedbackToDelete = item
      this.showDeleteDialog = true
    },

    async deleteFeedback() {
      if (!this.feedbackToDelete) return

      this.isDeleting = true

      try {
        await $fetch(`/api/feedback/${this.feedbackToDelete.id}`, { method: 'DELETE' })
        this.showDeleteDialog = false
        this.feedbackToDelete = null
        await this.loadFeedback()
      } catch (err) {
        console.error('Error deleting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to delete feedback')
      } finally {
        this.isDeleting = false
      }
    },

    async exportCsv() {
      if (this.selectedProjectIds.length === 0) return

      this.isExporting = true
      try {
        const params = new URLSearchParams({
          projectIds: this.selectedProjectIds.join(','),
        })
        if (this.searchQuery.trim()) params.set('search', this.searchQuery.trim())
        if (this.statusFilter) params.set('status', this.statusFilter)
        params.set('sortBy', this.sortBy)
        params.set('sortOrder', this.sortOrder)

        const csv = await $fetch(`/api/feedback/export?${params}`, { responseType: 'text' })
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `feedback-export-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        console.error('Error exporting feedback:', err)
        alert('Failed to export feedback. Please try again.')
      } finally {
        this.isExporting = false
      }
    },

    prewarmFeedbackRoute(feedbackId) {
      if (!import.meta.client || !feedbackId) return

      const route = `/feedback/${feedbackId}`
      if (this.prewarmedFeedbackRoutes[route]) return

      this.prewarmedFeedbackRoutes = {
        ...this.prewarmedFeedbackRoutes,
        [route]: true,
      }
      preloadRouteComponents(route).catch(() => {})
    },

    buildKanbanData() {
      const grouped = { open: [], in_progress: [], planned: [], completed: [], closed: [], declined: [] }
      for (const item of this.feedbackItems) {
        if (grouped[item.status]) {
          grouped[item.status].push(item)
        } else {
          grouped.open.push(item)
        }
      }
      this.kanbanData = grouped
    },

    async onKanbanDragEnd(evt) {
      const fromStatus = evt.from?.dataset?.status
      const toStatus = evt.to?.dataset?.status

      if (!fromStatus || !toStatus || fromStatus === toStatus) return

      const movedItem = this.kanbanData[toStatus]?.[evt.newIndex]
      if (!movedItem) return

      const feedbackItem = this.feedbackItems.find((i) => i.id === movedItem.id)
      if (!feedbackItem) return

      const oldStatus = feedbackItem.status
      feedbackItem.status = toStatus
      this.updateStatusCounts()

      try {
        await $fetch(`/api/feedback/${movedItem.id}/status`, {
          method: 'PATCH',
          body: { status: toStatus },
        })
      } catch (err) {
        feedbackItem.status = oldStatus
        this.buildKanbanData()
        this.updateStatusCounts()
        console.error('Failed to update feedback status:', err)
      }
    },

    formatDate(dateStr) {
      const date = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const days = Math.floor(diff / 86400000)
      if (days <= 0) return 'Today'
      if (days === 1) return 'Yesterday'
      if (days < 7) return `${days} days ago`
      if (days < 30) return `${Math.floor(days / 7)} weeks ago`
      return date.toLocaleDateString()
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

    statusBadgeVariant(status) {
      const variants = {
        open: 'outline',
        in_progress: 'secondary',
        planned: 'default',
        completed: 'default',
        closed: 'secondary',
        declined: 'destructive',
      }
      return variants[status] || 'outline'
    },
  },
}
</script>
