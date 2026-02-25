<template>
  <div class="min-h-screen bg-background relative flex flex-col">
    <!-- Top-right controls: always visible -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
      <button
        v-if="showThemeToggle"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        @click="toggleTheme"
      >
        <Icon :name="currentThemeIcon" class="w-4 h-4" />
        {{ currentThemeLabel }}
      </button>
      <!-- Logged-in state -->
      <template v-if="currentUser">
        <a
          :href="mainAppUrl + '/dashboard'"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        >
          <Icon name="lucide:layout-dashboard" class="w-4 h-4" />
          Dashboard
        </a>
        <div class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground bg-background/80 backdrop-blur-sm">
          <Avatar class="h-5 w-5">
            <AvatarImage v-if="currentUser.image" :src="currentUser.image" />
            <AvatarFallback class="text-[9px]">{{ currentUserInitials }}</AvatarFallback>
          </Avatar>
          {{ currentUser.name }}
        </div>
      </template>
      <!-- Logged-out state -->
      <template v-else>
        <a
          :href="mainAppUrl + '/login?redirect=' + authRedirectTarget"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors bg-background/80 backdrop-blur-sm"
        >
          <Icon name="lucide:log-in" class="w-4 h-4" />
          Log in
        </a>
        <a
          :href="mainAppUrl + '/signup?redirect=' + authRedirectTarget"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Sign up
        </a>
      </template>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="max-w-4xl mx-auto px-4 py-12">
      <div class="space-y-4">
        <Skeleton class="h-10 w-64" />
        <Skeleton class="h-5 w-96" />
        <div class="grid grid-cols-4 gap-4 mt-8">
          <Skeleton v-for="n in 4" :key="n" class="h-20" />
        </div>
        <Skeleton v-for="n in 3" :key="n" class="h-24 mt-4" />
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="max-w-4xl mx-auto px-4 py-12 text-center">
      <Icon name="lucide:alert-circle" class="w-16 h-16 mx-auto text-destructive mb-4" />
      <h1 class="text-2xl font-bold mb-2">Project Not Found</h1>
      <p class="text-muted-foreground">{{ error }}</p>
    </div>

    <!-- Main Content -->
    <div v-else-if="projectData" class="flex-1 flex flex-col">
      <!-- Banner: custom image when set, otherwise a styled default using accentColor -->
      <div
        data-testid="public-board-banner"
        class="w-full h-48 md:h-64 overflow-hidden relative"
        :style="bannerContainerStyle"
      >
        <img
          v-if="projectData.project.settings?.bannerUrl && !bannerError"
          :src="projectData.project.settings.bannerUrl"
          alt=""
          class="w-full h-full object-cover"
          @error="onBannerError"
        />
        <!-- Default banner content when no image or image failed to load -->
        <div v-if="!projectData.project.settings?.bannerUrl || bannerError" class="absolute inset-0 flex items-end">
          <div class="max-w-4xl w-full mx-auto px-4 pb-4">
            <p class="text-white/60 text-sm font-medium tracking-wide uppercase">Feedback Board</p>
          </div>
        </div>
      </div>

      <div class="max-w-4xl mx-auto px-4 py-8">
        <!-- Header -->
        <div class="mb-8">
          <div class="flex items-center gap-3 mb-2">
            <!-- Logo: custom image when set, otherwise a letter-avatar using accentColor -->
            <template v-if="projectData.project.settings?.logoUrl && !logoError">
              <img
                :src="projectData.project.settings.logoUrl"
                data-testid="public-board-logo"
                alt="Project logo"
                class="h-10 w-10 rounded object-cover border bg-muted"
                @error="onLogoError"
              />
            </template>
            <div
              v-else
              data-testid="public-board-logo"
              class="h-10 w-10 rounded flex items-center justify-center text-white font-bold text-lg select-none shrink-0"
              :style="logoFallbackStyle"
            >
              {{ projectInitial }}
            </div>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{{ projectData.team.name }}</span>
            </div>
          </div>
          <h1 class="text-3xl font-bold mb-2">{{ projectData.project.name }}</h1>
          <p v-if="projectData.project.description" class="text-muted-foreground text-lg">
            {{ projectData.project.description }}
          </p>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div class="rounded-lg border bg-card p-4">
            <p class="text-sm text-muted-foreground">Total</p>
            <p class="text-2xl font-bold">{{ projectData.stats.total }}</p>
          </div>
          <div class="rounded-lg border bg-card p-4">
            <p class="text-sm text-muted-foreground">Open</p>
            <p class="text-2xl font-bold text-orange-600">{{ projectData.stats.open }}</p>
          </div>
          <div class="rounded-lg border bg-card p-4">
            <p class="text-sm text-muted-foreground">In Progress</p>
            <p class="text-2xl font-bold text-blue-600">{{ projectData.stats.inProgress }}</p>
          </div>
          <div class="rounded-lg border bg-card p-4">
            <p class="text-sm text-muted-foreground">Completed</p>
            <p class="text-2xl font-bold text-green-600">{{ projectData.stats.completed }}</p>
          </div>
        </div>

        <!-- Actions Bar -->
        <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div class="flex flex-wrap items-center gap-2">
            <select
              v-model="filters.status"
              class="px-3 py-2 rounded-md border bg-background text-sm"
              @change="loadFeedback"
            >
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
            </select>

            <select
              v-model="filters.categoryId"
              class="px-3 py-2 rounded-md border bg-background text-sm"
              @change="loadFeedback"
            >
              <option value="">All Categories</option>
              <option v-for="cat in projectData.categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
            </select>

            <select
              v-model="filters.sortBy"
              class="px-3 py-2 rounded-md border bg-background text-sm"
              @change="loadFeedback"
            >
              <option value="voteCount">Most Voted</option>
              <option value="createdAt">Newest</option>
            </select>
          </div>

          <Button @click="showSubmitDialog = true">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Submit Feedback
          </Button>
        </div>

        <!-- Feedback List -->
        <div v-if="feedbackLoading" class="space-y-4">
          <Skeleton v-for="n in 3" :key="n" class="h-28" />
        </div>

        <div v-else-if="feedbackItems.length === 0" class="rounded-lg border bg-card p-12 text-center">
          <Icon name="lucide:message-square" class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 class="text-lg font-semibold mb-2">No feedback yet</h2>
          <p class="text-muted-foreground mb-4">Be the first to submit feedback for this product!</p>
          <Button @click="showSubmitDialog = true">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Submit Feedback
          </Button>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="item in feedbackItems"
            :key="item.id"
            class="rounded-lg border bg-card hover:shadow-sm transition-shadow cursor-pointer"
            :class="item.isOwn ? 'ring-2 ring-primary/30' : ''"
            :data-testid="`public-feedback-item-${item.id}`"
            role="button"
            tabindex="0"
            @click="openFeedbackDetails(item)"
            @keydown.enter.prevent="openFeedbackDetails(item)"
            @keydown.space.prevent="openFeedbackDetails(item)"
          >
            <div class="flex items-start gap-4 p-4">
              <div class="flex flex-col items-center min-w-[48px]">
                <button
                  class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors"
                  @click.stop="handleVote(item)"
                >
                  <Icon
                    name="lucide:chevron-up"
                    class="w-5 h-5"
                    :class="item.hasVoted ? 'text-primary' : 'text-muted-foreground'"
                  />
                  <span class="text-sm font-semibold">{{ item.voteCount }}</span>
                </button>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                  <h3 class="font-medium flex items-center gap-1.5">
                    <Icon
                      v-if="item.isPinned"
                      name="lucide:pin"
                      class="w-3.5 h-3.5 text-primary shrink-0"
                      data-testid="public-feedback-pinned-icon"
                    />
                    {{ item.title }}
                  </h3>
                  <div class="flex items-center gap-2 shrink-0">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      :class="
                        statusClasses[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      "
                    >
                      {{ formatStatus(item.status) }}
                    </span>
                    <span
                      v-if="item.category"
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      :style="{ backgroundColor: item.category.color + '20', color: item.category.color }"
                    >
                      <span
                        v-if="item.category.icon"
                        :data-testid="`public-feedback-category-icon-${item.id}`"
                        class="mr-1"
                      >
                        {{ item.category.icon }}
                      </span>
                      {{ item.category.name }}
                    </span>
                  </div>
                </div>
                <p v-if="item.body" class="text-sm text-muted-foreground line-clamp-2 mb-2">
                  {{ item.body }}
                </p>
                <div class="flex items-center gap-4 text-xs text-muted-foreground">
                  <span v-if="item.isOwn" class="text-primary font-medium">
                    <Icon name="lucide:star" class="w-3 h-3 inline" />
                    Your submission
                  </span>
                  <span v-else-if="item.authorName">
                    <Icon name="lucide:user" class="w-3 h-3 inline" />
                    {{ item.authorName }}
                  </span>
                  <span>
                    <Icon name="lucide:calendar" class="w-3 h-3 inline" />
                    {{ formatDate(item.createdAt) }}
                  </span>
                  <span v-if="item.commentCount > 0">
                    <Icon name="lucide:message-circle" class="w-3 h-3 inline" />
                    {{ item.commentCount }}
                  </span>
                  <span class="ml-auto text-primary">View details</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="pagination.totalPages > 1" class="flex items-center justify-between pt-4">
            <p class="text-sm text-muted-foreground">
              Page {{ pagination.page }} of {{ pagination.totalPages }} ({{ pagination.total }} total)
            </p>
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="pagination.page <= 1"
                @click="changePage(pagination.page - 1)"
                >Previous</Button
              >
              <Button
                variant="outline"
                size="sm"
                :disabled="pagination.page >= pagination.totalPages"
                @click="changePage(pagination.page + 1)"
                >Next</Button
              >
            </div>
          </div>
        </div>

        <!-- Submit Feedback Dialog -->
        <Dialog :open="showSubmitDialog" @update:open="showSubmitDialog = $event">
          <DialogContent class="sm:max-w-[500px]">
            <DialogHeader>
              <h2 class="text-lg font-semibold">Submit Feedback</h2>
              <p class="text-sm text-muted-foreground">Share your ideas, report bugs, or suggest improvements.</p>
            </DialogHeader>
            <div class="space-y-4 py-4">
              <div class="space-y-2">
                <Label for="fb-title">Title</Label>
                <Input id="fb-title" v-model="submitForm.title" placeholder="Brief summary of your feedback" />
              </div>
              <div class="space-y-2">
                <Label for="fb-body">Description</Label>
                <textarea
                  id="fb-body"
                  v-model="submitForm.body"
                  rows="4"
                  placeholder="Describe your feedback in detail..."
                  class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              <div class="space-y-2">
                <Label for="fb-category">Category</Label>
                <select
                  id="fb-category"
                  v-model="submitForm.categoryId"
                  class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a category</option>
                  <option v-for="cat in projectData.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                </select>
              </div>
              <div v-if="currentUser" class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <Icon name="lucide:user-check" class="w-3.5 h-3.5 shrink-0" />
                Submitting as {{ currentUser.name }}
              </div>
              <template v-else>
                <div class="space-y-2">
                  <Label for="fb-name">Your Name</Label>
                  <Input id="fb-name" v-model="submitForm.authorName" placeholder="John Doe" />
                </div>
                <div class="space-y-2">
                  <Label for="fb-email">Email (optional)</Label>
                  <Input id="fb-email" v-model="submitForm.authorEmail" type="email" placeholder="you@example.com" />
                  <p class="text-xs text-muted-foreground">
                    Provide your email to receive updates on comments and status changes.
                  </p>
                </div>
              </template>
            </div>
            <DialogFooter>
              <Button variant="outline" @click="showSubmitDialog = false">Cancel</Button>
              <Button
                :disabled="isSubmitting || !submitForm.title || !submitForm.body || (!currentUser && !submitForm.authorName)"
                @click="submitFeedback"
              >
                <Icon v-if="isSubmitting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                Submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog :open="showDetailsDialog" @update:open="handleDetailsDialogChange">
          <DialogContent class="sm:max-w-[900px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
            <!-- Loading -->
            <div v-if="detailsLoading" class="p-6 space-y-4">
              <Skeleton class="h-7 w-3/4" />
              <Skeleton class="h-24 w-full" />
              <Skeleton class="h-5 w-1/2" />
              <Skeleton class="h-16 w-full" />
            </div>

            <!-- Error -->
            <div v-else-if="detailsError" class="p-6">
              <div class="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                <p class="text-sm text-destructive">{{ detailsError }}</p>
                <Button class="mt-3" size="sm" variant="outline" @click="retryLoadDetails">Retry</Button>
              </div>
            </div>

            <!-- Two-column layout -->
            <div v-else-if="selectedFeedback" class="flex flex-col sm:flex-row min-h-0 flex-1 overflow-hidden">
              <!-- Left: main content + comments -->
              <div class="flex-1 overflow-y-auto p-6 space-y-5">
                <!-- Title + vote -->
                <div>
                  <div class="flex items-start justify-between gap-2 mb-3">
                    <h2 class="text-xl font-bold flex-1">{{ selectedFeedback.title }}</h2>
                    <div class="flex items-center gap-2 shrink-0">
                      <DropdownMenu v-if="isAdmin">
                        <DropdownMenuTrigger as-child>
                          <button class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                            <Icon name="lucide:more-horizontal" class="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem @click="adminTogglePin">
                            <Icon :name="selectedFeedback.isPinned ? 'lucide:pin-off' : 'lucide:pin'" class="w-4 h-4 mr-2" />
                            {{ selectedFeedback.isPinned ? 'Unpin' : 'Pin' }}
                          </DropdownMenuItem>
                          <DropdownMenuItem @click="adminToggleHide">
                            <Icon :name="selectedFeedback.isHidden ? 'lucide:eye' : 'lucide:eye-off'" class="w-4 h-4 mr-2" />
                            {{ selectedFeedback.isHidden ? 'Make visible' : 'Hide from public' }}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem class="text-destructive focus:text-destructive" @click="adminDeleteFeedback">
                            <Icon name="lucide:trash-2" class="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button
                        class="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors"
                        :class="selectedFeedback.hasVoted ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50 text-foreground'"
                        @click="voteFromDetails"
                      >
                        <Icon name="lucide:chevron-up" class="w-4 h-4" />
                        {{ selectedFeedback.voteCount }}
                      </button>
                    </div>
                  </div>
                  <p v-if="selectedFeedback.body" class="text-sm text-muted-foreground whitespace-pre-line">
                    {{ selectedFeedback.body }}
                  </p>
                  <p v-else class="text-sm text-muted-foreground italic">No description provided.</p>
                </div>

                <Separator />

                <!-- Comments section -->
                <div class="pt-1">
                  <div class="flex items-center border-b pb-2 mb-4">
                    <span class="text-sm font-semibold">
                      Comments
                      <span class="text-muted-foreground font-normal ml-1">{{ selectedFeedbackComments.length }}</span>
                    </span>
                  </div>

                  <div v-if="selectedFeedbackComments.length === 0" class="py-6 text-center text-sm text-muted-foreground">
                    No comments yet. Be the first to share your thoughts.
                  </div>
                  <div v-else class="space-y-5">
                    <div v-for="comment in selectedFeedbackComments" :key="comment.id" class="flex items-start gap-3">
                      <Avatar class="h-8 w-8 shrink-0">
                        <AvatarImage v-if="comment.author?.image" :src="comment.author.image" />
                        <AvatarFallback class="text-xs">{{ commentAuthorInitialsStr(comment) }}</AvatarFallback>
                      </Avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-sm font-medium">{{ formatCommentAuthor(comment) }}</span>
                          <span class="text-xs text-muted-foreground">{{ formatDate(comment.createdAt) }}</span>
                          <span v-if="comment.isEdited" class="text-xs text-muted-foreground italic">(edited)</span>
                          <div v-if="comment.canEdit" class="ml-auto flex items-center gap-1">
                            <button
                              class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                              :data-testid="`comment-edit-btn-${comment.id}`"
                              @click="startEditComment(comment)"
                            >
                              <Icon name="lucide:pencil" class="w-3.5 h-3.5" />
                            </button>
                            <button
                              class="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              :data-testid="`comment-delete-btn-${comment.id}`"
                              @click="deleteComment(comment)"
                            >
                              <Icon name="lucide:trash-2" class="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <template v-if="editingCommentId === comment.id">
                          <textarea
                            v-model="editingCommentBody"
                            rows="3"
                            :disabled="isSavingComment"
                            class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                          />
                          <div class="flex items-center gap-2 mt-2">
                            <Button size="sm" variant="outline" :disabled="isSavingComment" @click="cancelEditComment">
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              :disabled="!editingCommentBody.trim() || isSavingComment"
                              @click="saveEditComment(comment)"
                            >
                              <Icon v-if="isSavingComment" name="lucide:loader-2" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              Save
                            </Button>
                          </div>
                        </template>
                        <p v-else class="text-sm whitespace-pre-line">{{ comment.body }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Comment form -->
                  <div class="mt-6 space-y-3 border-t pt-4">
                    <textarea
                      v-model="detailCommentBody"
                      placeholder="Write a comment..."
                      rows="3"
                      :disabled="isSubmittingDetailComment"
                      class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                    />
                    <div class="flex items-center justify-between gap-2">
                      <p v-if="detailCommentError" class="text-xs text-destructive">{{ detailCommentError }}</p>
                      <div v-else />
                      <Button
                        size="sm"
                        :disabled="!detailCommentBody.trim() || isSubmittingDetailComment"
                        @click="openCommentOptions"
                      >
                        <Icon v-if="isSubmittingDetailComment" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                        Post Comment
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right: metadata sidebar -->
              <div class="sm:w-[220px] shrink-0 overflow-y-auto border-t sm:border-t-0 sm:border-l bg-muted/20 px-5 pb-5 pt-10 space-y-4">
                <!-- Status -->
                <div class="space-y-1.5">
                  <p class="text-sm text-muted-foreground">Status</p>
                  <span
                    class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                    :class="statusClasses[selectedFeedback.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'"
                  >
                    {{ formatStatus(selectedFeedback.status) }}
                  </span>
                </div>

                <!-- Board (Category) -->
                <div v-if="selectedFeedback.category" class="space-y-1.5">
                  <p class="text-sm text-muted-foreground">Board</p>
                  <div class="flex items-center gap-1.5 text-sm">
                    <span v-if="selectedFeedback.category.icon">{{ selectedFeedback.category.icon }}</span>
                    <Icon v-else name="lucide:layout-list" class="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{{ selectedFeedback.category.name }}</span>
                  </div>
                </div>

                <!-- Date -->
                <div class="space-y-1.5">
                  <p class="text-sm text-muted-foreground">Date</p>
                  <p class="text-sm">{{ formatDate(selectedFeedback.createdAt) }}</p>
                </div>

                <!-- Author -->
                <div class="space-y-1.5">
                  <p class="text-sm text-muted-foreground">Author</p>
                  <div class="flex items-center gap-2">
                    <Avatar class="h-6 w-6">
                      <AvatarImage v-if="selectedFeedback.author?.image" :src="selectedFeedback.author.image" />
                      <AvatarFallback class="text-[10px]">{{ selectedFeedbackAuthorInitials }}</AvatarFallback>
                    </Avatar>
                    <span class="text-sm">{{ selectedFeedback.authorName || selectedFeedback.author?.name || 'Anonymous' }}</span>
                  </div>
                </div>

                <Separator />

                <!-- Subscribe to post -->
                <div class="space-y-2">
                  <p class="text-sm font-semibold">Subscribe to post</p>
                  <p class="text-xs text-muted-foreground">Get notified by email when there are changes.</p>
                  <Button size="sm" variant="outline" class="w-full">
                    <Icon name="lucide:bell" class="w-4 h-4 mr-2" />
                    Get notified
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <!-- Comment Options Dialog -->
        <Dialog :open="showCommentOptionsModal" @update:open="showCommentOptionsModal = $event">
          <DialogContent class="sm:max-w-[400px]">
            <DialogHeader>
              <h2 class="text-lg font-semibold">How would you like to post?</h2>
              <p class="text-sm text-muted-foreground">Choose how to submit your comment.</p>
            </DialogHeader>

            <!-- Option selection -->
            <div v-if="!commentOptionSelected" class="space-y-3 py-2">
              <a
                v-if="!currentUser"
                :href="mainAppUrl + '/login?redirect=' + authRedirectTarget"
                class="flex items-center gap-3 w-full rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
              >
                <Icon name="lucide:log-in" class="w-4 h-4 shrink-0" />
                <div class="text-left">
                  <p class="font-medium">Log in</p>
                  <p class="text-xs text-muted-foreground font-normal">Comment with your account</p>
                </div>
              </a>
              <button
                class="flex items-center gap-3 w-full rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left"
                @click="submitAsAnon"
              >
                <Icon name="lucide:user-x" class="w-4 h-4 shrink-0" />
                <div>
                  <p class="font-medium">Continue as guest</p>
                  <p class="text-xs text-muted-foreground font-normal">Post anonymously without notifications</p>
                </div>
              </button>
              <button
                class="flex items-center gap-3 w-full rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left"
                @click="commentOptionSelected = 'notify'"
              >
                <Icon name="lucide:bell" class="w-4 h-4 shrink-0" />
                <div>
                  <p class="font-medium">Get notified</p>
                  <p class="text-xs text-muted-foreground font-normal">Enter your name and email for updates</p>
                </div>
              </button>
            </div>

            <!-- Notify form -->
            <div v-else-if="commentOptionSelected === 'notify'" class="space-y-4 py-2">
              <div class="space-y-2">
                <Label>Your name <span class="text-destructive">*</span></Label>
                <Input v-model="commentOptionName" placeholder="John Doe" :disabled="isSubmittingDetailComment" />
              </div>
              <div class="space-y-2">
                <Label>Email <span class="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                <Input
                  v-model="commentOptionEmail"
                  type="email"
                  placeholder="you@example.com"
                  :disabled="isSubmittingDetailComment"
                />
                <p class="text-xs text-muted-foreground">Receive email updates on replies and status changes.</p>
              </div>
              <div class="flex justify-end gap-2 pt-1">
                <Button variant="outline" :disabled="isSubmittingDetailComment" @click="commentOptionSelected = null">
                  Back
                </Button>
                <Button
                  :disabled="!commentOptionName.trim() || isSubmittingDetailComment"
                  @click="submitWithNotify"
                >
                  <Icon v-if="isSubmittingDetailComment" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  Post Comment
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <!-- Footer -->
      <div class="mt-auto py-3 text-center text-xs text-muted-foreground space-y-1">
        <div v-if="showCustomFooter" data-testid="public-footer-custom" class="space-y-1">
          <p v-if="customFooterBranding" class="text-xs font-medium text-foreground">
            {{ customFooterBranding }}
          </p>
          <p v-if="customFooterText" class="text-xs text-muted-foreground">
            {{ customFooterText }}
          </p>
          <div
            v-if="customFooterLinks.length > 0"
            class="flex items-center justify-center gap-3 text-xs text-muted-foreground"
          >
            <a
              v-for="(link, index) in customFooterLinks"
              :key="`${link.label}-${link.url}`"
              :data-testid="`public-footer-custom-link-${index}`"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              {{ link.label }}
            </a>
          </div>
        </div>
        <template v-else>
          <div v-if="projectData?.project?.settings?.showPoweredBy !== false" data-testid="public-footer-powered-by">
            Powered by
            <a href="https://veerify.io" target="_blank" rel="noopener noreferrer" class="hover:underline">Veerify</a>
          </div>
          <div v-if="projectData?.project?.settings?.showGithubFooter !== false" data-testid="public-footer-github">
            Open source &amp; contributions welcome &mdash;
            <a
              href="https://github.com/Frogbyte-io/veerify"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline inline-flex items-center gap-1"
            >
              <Icon name="lucide:github" class="h-3 w-3" />GitHub
            </a>
            &middot;
            <a
              href="https://github.com/Frogbyte-io/veerify/issues"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
              >report an issue</a
            >
            &middot;
            <a
              data-testid="public-footer-veerify-board"
              href="https://feedback.veerify.io"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              Veerify feedback board
            </a>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'PublicFeedbackBoard',
  props: {
    teamSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
  },
  data() {
    return {
      projectData: null,
      feedbackItems: [],
      isLoading: true,
      error: null,
      feedbackLoading: false,
      showSubmitDialog: false,
      showDetailsDialog: false,
      isSubmitting: false,
      detailsLoading: false,
      detailsError: null,
      selectedFeedbackId: null,
      selectedFeedback: null,
      selectedFeedbackComments: [],
      detailCommentBody: '',
      isSubmittingDetailComment: false,
      detailCommentError: null,
      showCommentOptionsModal: false,
      commentOptionSelected: null,
      commentOptionName: '',
      commentOptionEmail: '',
      isAdmin: false,
      currentUser: null,
      filters: { status: '', categoryId: '', sortBy: 'voteCount' },
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      submitForm: { title: '', body: '', categoryId: '', authorName: '', authorEmail: '' },
      previousColorMode: null,
      activeTheme: 'system',
      logoError: false,
      bannerError: false,
      editingCommentId: null,
      editingCommentBody: '',
      isSavingComment: false,
      statusClasses: {
        open: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
        in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        planned: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        closed: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
        declined: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      },
    }
  },
  computed: {
    accentColor() {
      return this.projectData?.project?.settings?.accentColor || '#6366f1'
    },
    projectInitial() {
      const name = this.projectData?.project?.name || ''
      return name.charAt(0).toUpperCase() || '?'
    },
    bannerContainerStyle() {
      const color = this.accentColor
      // Convert hex to a usable gradient. Always show something visually present.
      return {
        background: `linear-gradient(135deg, ${color} 0%, ${color}cc 50%, ${color}80 100%)`,
      }
    },
    logoFallbackStyle() {
      return {
        backgroundColor: this.accentColor,
      }
    },
    mainAppUrl() {
      if (!import.meta.client) return ''
      const config = useRuntimeConfig()
      const dashboardDomain = config.public.dashboardDomain || config.public.appDomain || 'localhost'
      const protocol = window.location.protocol
      const port = dashboardDomain === 'localhost' ? ':' + window.location.port : ''
      return `${protocol}//${dashboardDomain}${port}`
    },
    currentThemeIcon() {
      if (this.activeTheme === 'dark') return 'lucide:moon'
      if (this.activeTheme === 'light') return 'lucide:sun'
      return 'lucide:monitor'
    },
    currentThemeLabel() {
      if (this.activeTheme === 'dark') return 'Dark'
      if (this.activeTheme === 'light') return 'Light'
      return 'System'
    },
    showThemeToggle() {
      const forced = this.projectData?.project?.settings?.themeMode
      return !forced || forced === 'system'
    },
    authRedirectTarget() {
      if (!import.meta.client) return encodeURIComponent(`/${this.projectSlug}`)
      return encodeURIComponent(window.location.href)
    },
    customFooterBranding() {
      return this.projectData?.project?.settings?.customFooterBranding?.trim() || ''
    },
    customFooterText() {
      return this.projectData?.project?.settings?.customFooterText?.trim() || ''
    },
    customFooterLinks() {
      const settings = this.projectData?.project?.settings || {}
      const links = [
        {
          label: settings.customFooterPrimaryLabel?.trim(),
          url: settings.customFooterPrimaryUrl?.trim(),
        },
        {
          label: settings.customFooterSecondaryLabel?.trim(),
          url: settings.customFooterSecondaryUrl?.trim(),
        },
      ]
      return links.filter((link) => link.label && link.url)
    },
    showCustomFooter() {
      return (
        this.projectData?.project?.settings?.customFooterEnabled === true &&
        (this.customFooterBranding || this.customFooterText || this.customFooterLinks.length > 0)
      )
    },
    selectedFeedbackAuthorInitials() {
      const name = this.selectedFeedback?.authorName || this.selectedFeedback?.author?.name || '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
    currentUserInitials() {
      const name = this.currentUser?.name || this.currentUser?.email || '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
  },
  beforeUnmount() {
    if (import.meta.client && this.previousColorMode) {
      this.$colorMode.preference = this.previousColorMode
    }
  },
  async mounted() {
    if (import.meta.client) {
      this.previousColorMode = this.$colorMode.preference
    }
    try {
      const response = await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}`)
      this.projectData = response?.data
      this.applyTheme(this.projectData?.project?.settings?.themeMode || 'system')
      await this.loadFeedback()
      this.checkAdminStatus()
    } catch (err) {
      console.error('Error loading project:', err)
      this.error = 'This feedback page could not be found.'
    } finally {
      this.isLoading = false
    }
  },
  methods: {
    onBannerError() {
      this.bannerError = true
    },
    onLogoError() {
      this.logoError = true
    },
    applyTheme(mode) {
      this.activeTheme = mode
      if (import.meta.client) {
        this.$colorMode.preference = mode
      }
    },
    toggleTheme() {
      const cycle = { system: 'light', light: 'dark', dark: 'system' }
      this.applyTheme(cycle[this.activeTheme] || 'system')
    },
    async loadFeedback() {
      if (!this.projectData) return
      this.feedbackLoading = true
      try {
        const params = new URLSearchParams()
        params.set('page', String(this.pagination.page))
        params.set('limit', String(this.pagination.limit))
        params.set('sortBy', this.filters.sortBy)
        params.set('sortOrder', 'desc')
        if (this.filters.status) params.set('status', this.filters.status)
        if (this.filters.categoryId) params.set('categoryId', this.filters.categoryId)
        const response = await $fetch(
          `/api/public/t/${this.teamSlug}/${this.projectSlug}/feedback?${params.toString()}`
        )
        const data = response?.data
        this.feedbackItems = this.mergeWithLocalVotes(data?.items || [])
        this.pagination = data?.pagination || this.pagination
      } catch (err) {
        console.error('Error loading feedback:', err)
      } finally {
        this.feedbackLoading = false
      }
    },
    async submitFeedback() {
      if (!this.submitForm.title || !this.submitForm.body || !this.submitForm.authorName) return
      this.isSubmitting = true
      try {
        await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}/feedback`, {
          method: 'POST',
          body: {
            title: this.submitForm.title,
            body: this.submitForm.body,
            categoryId: this.submitForm.categoryId || null,
            authorName: this.submitForm.authorName,
            authorEmail: this.submitForm.authorEmail || undefined,
          },
        })
        this.showSubmitDialog = false
        this.submitForm = { title: '', body: '', categoryId: '', authorName: '', authorEmail: '' }
        this.pagination.page = 1
        this.filters.sortBy = 'createdAt'
        await this.loadFeedback()
        const projectResponse = await $fetch(`/api/public/t/${this.teamSlug}/${this.projectSlug}`)
        this.projectData = projectResponse?.data
      } catch (err) {
        console.error('Error submitting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to submit feedback. Please try again.')
      } finally {
        this.isSubmitting = false
      }
    },
    async openFeedbackDetails(item) {
      if (!item?.id) return
      this.showDetailsDialog = true
      this.selectedFeedbackId = item.id
      await this.loadFeedbackDetails(item.id)
    },
    handleDetailsDialogChange(isOpen) {
      this.showDetailsDialog = isOpen
      if (!isOpen) {
        this.detailsError = null
        this.detailCommentBody = ''
        this.detailCommentError = null
        this.showCommentOptionsModal = false
        this.commentOptionSelected = null
        this.commentOptionName = ''
        this.commentOptionEmail = ''
        this.editingCommentId = null
        this.editingCommentBody = ''
      }
    },
    async retryLoadDetails() {
      if (!this.selectedFeedbackId) return
      await this.loadFeedbackDetails(this.selectedFeedbackId)
    },
    async loadFeedbackDetails(feedbackId) {
      this.detailsLoading = true
      this.detailsError = null
      try {
        const [feedbackResponse, commentsResponse] = await Promise.all([
          $fetch(`/api/feedback/${feedbackId}`),
          $fetch(`/api/feedback/${feedbackId}/comments`),
        ])
        this.selectedFeedback = feedbackResponse?.data || null
        this.selectedFeedbackComments = Array.isArray(commentsResponse?.data) ? commentsResponse.data : []
      } catch (err) {
        console.error('Error loading feedback details:', err)
        this.detailsError = err?.data?.error?.message || 'Failed to load feedback details'
        this.selectedFeedback = null
        this.selectedFeedbackComments = []
      } finally {
        this.detailsLoading = false
      }
    },
    async handleVote(item) {
      // Optimistic update for instant feedback
      const wasVoted = item.hasVoted
      item.hasVoted = !wasVoted
      item.voteCount += wasVoted ? -1 : 1
      try {
        const response = await $fetch(`/api/feedback/${item.id}/vote`, { method: 'POST' })
        const data = response?.data
        item.voteCount = data.voteCount
        item.hasVoted = data.voted
        this.saveLocalVote(item.id, data.voted)
      } catch (err) {
        // Revert optimistic update
        item.hasVoted = wasVoted
        item.voteCount += wasVoted ? 1 : -1
        console.error('Error voting:', err)
        alert('Failed to vote. Please try again.')
      }
    },
    getLocalVotedIds() {
      if (!import.meta.client) return new Set()
      try {
        const data = JSON.parse(localStorage.getItem('veerify_votes') || '[]')
        return new Set(Array.isArray(data) ? data : [])
      } catch {
        return new Set()
      }
    },
    saveLocalVote(feedbackId, voted) {
      if (!import.meta.client) return
      try {
        const votes = this.getLocalVotedIds()
        if (voted) {
          votes.add(feedbackId)
        } else {
          votes.delete(feedbackId)
        }
        localStorage.setItem('veerify_votes', JSON.stringify([...votes]))
      } catch {
        // localStorage might be unavailable (e.g. private browsing with storage blocked)
      }
    },
    mergeWithLocalVotes(items) {
      if (!import.meta.client) return items
      try {
        const localVotes = this.getLocalVotedIds()
        // Sync localStorage with any server-confirmed votes
        items.forEach((item) => {
          if (item.hasVoted) localVotes.add(item.id)
        })
        localStorage.setItem('veerify_votes', JSON.stringify([...localVotes]))
        // Apply localStorage state — if local says voted and server doesn't (e.g. cookie cleared), show as voted
        return items.map((item) => ({
          ...item,
          hasVoted: item.hasVoted || localVotes.has(item.id),
        }))
      } catch {
        return items
      }
    },
    changePage(page) {
      this.pagination.page = page
      this.loadFeedback()
    },
    formatStatus(status) {
      const map = {
        open: 'Open',
        in_progress: 'In Progress',
        planned: 'Planned',
        completed: 'Completed',
        closed: 'Closed',
        declined: 'Declined',
      }
      return map[status] || status
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
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      return d.toLocaleDateString()
    },
    formatCommentAuthor(comment) {
      return comment?.author?.name || comment?.authorName || 'Anonymous'
    },
    commentAuthorInitialsStr(comment) {
      const name = comment?.author?.name || comment?.authorName || '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
    openCommentOptions() {
      if (!this.detailCommentBody.trim()) return
      if (this.currentUser) {
        this.executeCommentSubmit('', '')
        return
      }
      this.commentOptionSelected = null
      this.commentOptionName = ''
      this.commentOptionEmail = ''
      this.showCommentOptionsModal = true
    },
    async submitAsAnon() {
      await this.executeCommentSubmit('Anonymous', '')
    },
    async submitWithNotify() {
      if (!this.commentOptionName.trim()) return
      await this.executeCommentSubmit(this.commentOptionName.trim(), this.commentOptionEmail.trim())
    },
    async executeCommentSubmit(authorName, authorEmail) {
      this.isSubmittingDetailComment = true
      this.detailCommentError = null
      try {
        const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/comments`, {
          method: 'POST',
          body: {
            body: this.detailCommentBody.trim(),
            authorName,
            authorEmail: authorEmail || undefined,
          },
        })
        const comment = response?.data
        if (comment) {
          this.selectedFeedbackComments.push(comment)
          if (this.selectedFeedback) {
            this.selectedFeedback.commentCount = (this.selectedFeedback.commentCount || 0) + 1
          }
          const listItem = this.feedbackItems.find((item) => item.id === this.selectedFeedbackId)
          if (listItem) listItem.commentCount = (listItem.commentCount || 0) + 1
        }
        this.detailCommentBody = ''
        this.showCommentOptionsModal = false
        this.commentOptionSelected = null
        this.commentOptionName = ''
        this.commentOptionEmail = ''
      } catch (err) {
        console.error('Error posting comment:', err)
        this.detailCommentError = err?.data?.error?.message || 'Failed to post comment. Please try again.'
        this.showCommentOptionsModal = false
      } finally {
        this.isSubmittingDetailComment = false
      }
    },
    async checkAdminStatus() {
      if (!import.meta.client) return
      try {
        const sessionResult = await authClient.getSession()
        if (!sessionResult?.data?.user) return
        this.currentUser = sessionResult.data.user
        this.submitForm.authorName = sessionResult.data.user.name || ''
        this.submitForm.authorEmail = sessionResult.data.user.email || ''
        const response = await $fetch('/api/teams/list-user')
        const teams = response?.data || []
        this.isAdmin = teams.some((t) => t.slug === this.teamSlug)
      } catch {
        this.isAdmin = false
      }
    },
    async adminTogglePin() {
      try {
        const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/pin`, { method: 'PATCH' })
        const updated = response?.data
        if (updated && this.selectedFeedback) {
          this.selectedFeedback.isPinned = updated.isPinned
        }
        this.pagination.page = 1
        await this.loadFeedback()
      } catch (err) {
        console.error('Error toggling pin:', err)
      }
    },
    async adminToggleHide() {
      try {
        const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/visibility`, { method: 'PATCH' })
        const updated = response?.data
        if (updated && this.selectedFeedback) {
          this.selectedFeedback.isHidden = updated.isHidden
        }
        if (updated?.isHidden) {
          this.feedbackItems = this.feedbackItems.filter((item) => item.id !== this.selectedFeedbackId)
          this.showDetailsDialog = false
        }
      } catch (err) {
        console.error('Error toggling visibility:', err)
      }
    },
    async adminDeleteFeedback() {
      if (!confirm('Delete this feedback? This cannot be undone.')) return
      try {
        await $fetch(`/api/feedback/${this.selectedFeedbackId}`, { method: 'DELETE' })
        this.feedbackItems = this.feedbackItems.filter((item) => item.id !== this.selectedFeedbackId)
        this.showDetailsDialog = false
      } catch (err) {
        console.error('Error deleting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to delete feedback.')
      }
    },
    startEditComment(comment) {
      this.editingCommentId = comment.id
      this.editingCommentBody = comment.body
    },
    cancelEditComment() {
      this.editingCommentId = null
      this.editingCommentBody = ''
    },
    async saveEditComment(comment) {
      if (!this.editingCommentBody.trim()) return
      this.isSavingComment = true
      try {
        const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/comments/${comment.id}`, {
          method: 'PATCH',
          body: { body: this.editingCommentBody.trim() },
        })
        const updated = response?.data
        if (updated) {
          const idx = this.selectedFeedbackComments.findIndex((c) => c.id === comment.id)
          if (idx !== -1) {
            this.selectedFeedbackComments[idx] = {
              ...this.selectedFeedbackComments[idx],
              body: updated.body,
              isEdited: true,
            }
          }
        }
        this.editingCommentId = null
        this.editingCommentBody = ''
      } catch (err) {
        console.error('Error editing comment:', err)
        alert(err?.data?.error?.message || 'Failed to edit comment. Please try again.')
      } finally {
        this.isSavingComment = false
      }
    },
    async deleteComment(comment) {
      if (!confirm('Delete this comment? This cannot be undone.')) return
      try {
        await $fetch(`/api/feedback/${this.selectedFeedbackId}/comments/${comment.id}`, { method: 'DELETE' })
        this.selectedFeedbackComments = this.selectedFeedbackComments.filter((c) => c.id !== comment.id)
        if (this.selectedFeedback) {
          this.selectedFeedback.commentCount = Math.max((this.selectedFeedback.commentCount || 0) - 1, 0)
        }
        const listItem = this.feedbackItems.find((item) => item.id === this.selectedFeedbackId)
        if (listItem) listItem.commentCount = Math.max((listItem.commentCount || 0) - 1, 0)
      } catch (err) {
        console.error('Error deleting comment:', err)
        alert(err?.data?.error?.message || 'Failed to delete comment. Please try again.')
      }
    },
    async voteFromDetails() {
      if (!this.selectedFeedback) return
      const wasVoted = this.selectedFeedback.hasVoted
      this.selectedFeedback.hasVoted = !wasVoted
      this.selectedFeedback.voteCount += wasVoted ? -1 : 1
      // Sync the list item too
      const listItem = this.feedbackItems.find((item) => item.id === this.selectedFeedbackId)
      if (listItem) {
        listItem.hasVoted = this.selectedFeedback.hasVoted
        listItem.voteCount = this.selectedFeedback.voteCount
      }
      try {
        const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/vote`, { method: 'POST' })
        const data = response?.data
        this.selectedFeedback.voteCount = data.voteCount
        this.selectedFeedback.hasVoted = data.voted
        this.saveLocalVote(this.selectedFeedbackId, data.voted)
        if (listItem) {
          listItem.voteCount = data.voteCount
          listItem.hasVoted = data.voted
        }
      } catch (err) {
        // Revert optimistic update
        this.selectedFeedback.hasVoted = wasVoted
        this.selectedFeedback.voteCount += wasVoted ? 1 : -1
        if (listItem) {
          listItem.hasVoted = wasVoted
          listItem.voteCount = this.selectedFeedback.voteCount
        }
        console.error('Error voting:', err)
      }
    },
  },
}
</script>
