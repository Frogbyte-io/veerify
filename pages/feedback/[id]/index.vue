<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-4xl mx-auto">
      <!-- Loading State -->
      <div v-if="isLoading">
        <div class="mb-6">
          <Skeleton class="h-5 w-32 mb-4" />
          <Skeleton class="h-8 w-96 mb-2" />
          <Skeleton class="h-4 w-48" />
        </div>
        <div class="bg-card rounded-lg border border-border p-6">
          <Skeleton class="h-4 w-full mb-2" />
          <Skeleton class="h-4 w-3/4 mb-2" />
          <Skeleton class="h-4 w-1/2" />
        </div>
        <div class="mt-6 bg-card rounded-lg border border-border p-6">
          <Skeleton class="h-6 w-32 mb-4" />
          <Skeleton class="h-20 w-full mb-4" />
          <Skeleton class="h-4 w-64" />
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="rounded-lg border bg-card p-8 text-center">
        <Icon name="lucide:alert-circle" class="w-12 h-12 mx-auto text-destructive mb-4" />
        <p class="text-lg font-medium mb-2">Failed to load feedback</p>
        <p class="text-muted-foreground mb-4">{{ error }}</p>
        <div class="flex items-center justify-center gap-3">
          <Button variant="outline" @click="$router.back()">
            <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
            Go Back
          </Button>
          <Button @click="loadFeedback">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>

      <!-- Content -->
      <div v-else-if="item">
        <!-- Breadcrumb -->
        <div class="mb-6">
          <div class="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <NuxtLink to="/feedback" class="hover:text-foreground transition-colors">Feedback</NuxtLink>
            <Icon name="lucide:chevron-right" class="w-4 h-4" />
            <NuxtLink v-if="item.project" :to="`/feedback?projectId=${item.project.id}`" class="hover:text-foreground transition-colors">{{ item.project.name }}</NuxtLink>
            <Icon v-if="item.project" name="lucide:chevron-right" class="w-4 h-4" />
            <span class="text-foreground">{{ item.title }}</span>
          </div>

          <!-- Back button -->
          <Button variant="ghost" size="sm" class="mb-4" @click="$router.back()">
            <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>

        <!-- Main content area -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left column: Feedback content + Comments -->
          <div class="lg:col-span-2 space-y-6">
            <!-- Feedback Header -->
            <div class="bg-card rounded-lg border border-border p-6">
              <div class="flex items-start gap-4">
                <!-- Vote button -->
                <div class="flex flex-col items-center">
                  <button
                    class="flex flex-col items-center p-2 rounded-lg border transition-colors"
                    :class="item.hasVoted
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/50 text-muted-foreground hover:text-primary'"
                    @click="toggleVote"
                  >
                    <Icon name="lucide:chevron-up" class="w-5 h-5" />
                    <span class="text-sm font-semibold">{{ item.voteCount }}</span>
                  </button>
                </div>

                <!-- Title + Body -->
                <div class="flex-1 min-w-0">
                  <h1 class="text-2xl font-bold text-foreground mb-2">{{ item.title }}</h1>
                  <p v-if="item.body" class="text-muted-foreground whitespace-pre-wrap">{{ item.body }}</p>
                </div>
              </div>

              <!-- Meta row -->
              <div class="flex items-center flex-wrap gap-4 mt-6 pt-4 border-t border-border text-sm text-muted-foreground">
                <div class="flex items-center gap-2">
                  <Avatar class="h-6 w-6">
                    <AvatarImage v-if="item.author?.image" :src="item.author.image" />
                    <AvatarFallback class="text-xs">{{ authorInitials }}</AvatarFallback>
                  </Avatar>
                  <span>{{ item.authorName || item.author?.name || 'Anonymous' }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <Icon name="lucide:calendar" class="w-4 h-4" />
                  <span>{{ formatDate(item.createdAt) }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <Icon name="lucide:message-circle" class="w-4 h-4" />
                  <span>{{ item.commentCount }} {{ item.commentCount === 1 ? 'comment' : 'comments' }}</span>
                </div>
              </div>
            </div>

            <!-- Comments Section -->
            <div class="bg-card rounded-lg border border-border">
              <div class="p-6 border-b border-border">
                <h2 class="text-lg font-semibold text-card-foreground">
                  Comments
                  <span class="text-sm font-normal text-muted-foreground ml-2">{{ comments.length }}</span>
                </h2>
              </div>

              <!-- Comments Loading -->
              <div v-if="isCommentsLoading" class="p-6">
                <div v-for="n in 2" :key="n" class="mb-6 last:mb-0">
                  <div class="flex items-start gap-3">
                    <Skeleton class="h-8 w-8 rounded-full" />
                    <div class="flex-1">
                      <Skeleton class="h-4 w-32 mb-2" />
                      <Skeleton class="h-4 w-full mb-1" />
                      <Skeleton class="h-4 w-2/3" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Comments Error -->
              <div v-else-if="commentsError" class="p-6 text-center">
                <p class="text-sm text-muted-foreground mb-3">{{ commentsError }}</p>
                <Button variant="outline" size="sm" @click="loadComments">
                  <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>

              <!-- Empty Comments -->
              <div v-else-if="comments.length === 0" class="p-6 text-center">
                <Icon name="lucide:message-circle" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p class="text-muted-foreground">No comments yet. Be the first to share your thoughts.</p>
              </div>

              <!-- Comments List -->
              <div v-else class="divide-y divide-border">
                <div
                  v-for="comment in comments"
                  :key="comment.id"
                  class="p-6"
                  :class="comment.isInternal ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''"
                >
                  <div class="flex items-start gap-3">
                    <Avatar class="h-8 w-8">
                      <AvatarImage v-if="comment.author?.image" :src="comment.author.image" />
                      <AvatarFallback class="text-xs">{{ commentAuthorInitials(comment) }}</AvatarFallback>
                    </Avatar>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-sm font-medium text-foreground">
                          {{ comment.authorName || comment.author?.name || 'Anonymous' }}
                        </span>
                        <Badge v-if="comment.isInternal" variant="outline" class="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">
                          <Icon name="lucide:lock" class="w-3 h-3 mr-1" />
                          Internal
                        </Badge>
                        <span class="text-xs text-muted-foreground">{{ formatDate(comment.createdAt) }}</span>
                      </div>
                      <p class="text-sm text-foreground whitespace-pre-wrap">{{ comment.body }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Add Comment Form -->
              <div class="p-6 border-t border-border">
                <div class="space-y-3">
                  <Textarea
                    v-model="newComment"
                    placeholder="Write a comment..."
                    rows="3"
                    :disabled="isSubmittingComment"
                  />
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <label v-if="isTeamMember" class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                        <input v-model="isInternalComment" type="checkbox" class="rounded border-border" />
                        <Icon name="lucide:lock" class="w-4 h-4" />
                        Internal note
                      </label>
                    </div>
                    <Button
                      size="sm"
                      :disabled="!newComment.trim() || isSubmittingComment"
                      @click="submitComment"
                    >
                      <Icon v-if="isSubmittingComment" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                      Post Comment
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right column: Sidebar -->
          <div class="space-y-6">
            <!-- Status -->
            <div class="bg-card rounded-lg border border-border p-6">
              <h3 class="text-sm font-medium text-muted-foreground mb-3">Status</h3>
              <div v-if="isTeamMember">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" class="w-full justify-between">
                      <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full" :class="statusColor(item.status)" />
                        {{ formatStatus(item.status) }}
                      </div>
                      <Icon name="lucide:chevron-down" class="w-4 h-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" class="w-48">
                    <DropdownMenuItem
                      v-for="s in statuses"
                      :key="s.value"
                      :disabled="isUpdatingStatus"
                      @click="updateStatus(s.value)"
                    >
                      <span class="w-2 h-2 rounded-full mr-2" :class="statusColor(s.value)" />
                      {{ s.label }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div v-else>
                <Badge :variant="statusBadgeVariant(item.status)" class="text-sm">
                  <span class="w-2 h-2 rounded-full mr-2" :class="statusColor(item.status)" />
                  {{ formatStatus(item.status) }}
                </Badge>
              </div>
            </div>

            <!-- Category -->
            <div class="bg-card rounded-lg border border-border p-6">
              <h3 class="text-sm font-medium text-muted-foreground mb-3">Category</h3>
              <Badge v-if="item.category" variant="outline">
                {{ item.category.name }}
              </Badge>
              <span v-else class="text-sm text-muted-foreground">Uncategorized</span>
            </div>

            <!-- Details -->
            <div class="bg-card rounded-lg border border-border p-6">
              <h3 class="text-sm font-medium text-muted-foreground mb-3">Details</h3>
              <div class="space-y-3 text-sm">
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Votes</span>
                  <span class="font-medium text-foreground">{{ item.voteCount }}</span>
                </div>
                <Separator />
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Comments</span>
                  <span class="font-medium text-foreground">{{ item.commentCount }}</span>
                </div>
                <Separator />
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Created</span>
                  <span class="font-medium text-foreground">{{ formatFullDate(item.createdAt) }}</span>
                </div>
                <Separator />
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Updated</span>
                  <span class="font-medium text-foreground">{{ formatFullDate(item.updatedAt) }}</span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div v-if="item.isOwn || isTeamMember" class="bg-card rounded-lg border border-border p-6">
              <h3 class="text-sm font-medium text-muted-foreground mb-3">Actions</h3>
              <Button
                variant="destructive"
                size="sm"
                class="w-full"
                :disabled="isDeleting"
                @click="showDeleteDialog = true"
              >
                <Icon name="lucide:trash-2" class="w-4 h-4 mr-2" />
                Delete Feedback
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Delete Confirmation Dialog -->
      <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
        <DialogContent class="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Feedback</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{{ item?.title }}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
            <Button
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
import { authClient } from '~/lib/auth-client'

export default {
  name: 'FeedbackDetailPage',

  data() {
    return {
      item: null,
      comments: [],

      isLoading: true,
      error: null,
      isCommentsLoading: true,
      commentsError: null,

      newComment: '',
      isInternalComment: false,
      isSubmittingComment: false,

      isUpdatingStatus: false,
      isDeleting: false,
      showDeleteDialog: false,

      isTeamMember: false,

      statuses: [
        { value: 'open', label: 'Open' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'planned', label: 'Planned' },
        { value: 'completed', label: 'Completed' },
        { value: 'closed', label: 'Closed' },
        { value: 'declined', label: 'Declined' },
      ],
    }
  },

  computed: {
    feedbackId() {
      return this.$route.params.id
    },
    authorInitials() {
      const name = this.item?.authorName || this.item?.author?.name || '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
  },

  async mounted() {
    await this.loadFeedback()
  },

  methods: {
    async loadFeedback() {
      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}`)
        this.item = response?.data || null

        if (!this.item) {
          this.error = 'Feedback not found'
          return
        }

        // Determine if user is a team member by checking session
        await this.checkTeamMembership()

        // Load comments after feedback is loaded
        await this.loadComments()
      } catch (err) {
        console.error('Error loading feedback:', err)
        if (err?.statusCode === 404) {
          this.error = 'Feedback not found'
        } else if (err?.statusCode === 403) {
          this.error = 'You do not have access to this feedback'
        } else {
          this.error = err?.data?.error?.message || 'Failed to load feedback'
        }
      } finally {
        this.isLoading = false
      }
    },

    async checkTeamMembership() {
      try {
        const { data: session } = await authClient.useSession(useFetch)
        if (session.value?.user && this.item?.project) {
          // If the detail endpoint succeeded with auth, user has project access
          this.isTeamMember = !!session.value.user
        }
      } catch {
        this.isTeamMember = false
      }
    },

    async loadComments() {
      this.isCommentsLoading = true
      this.commentsError = null

      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/comments`)
        this.comments = response?.data || []
      } catch (err) {
        console.error('Error loading comments:', err)
        this.commentsError = 'Failed to load comments'
      } finally {
        this.isCommentsLoading = false
      }
    },

    async toggleVote() {
      if (!this.item) return

      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/vote`, {
          method: 'POST',
        })
        const data = response?.data
        if (data) {
          this.item.hasVoted = data.voted
          this.item.voteCount = data.voteCount
        }
      } catch (err) {
        console.error('Error toggling vote:', err)
      }
    },

    async submitComment() {
      if (!this.newComment.trim()) return

      this.isSubmittingComment = true

      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/comments`, {
          method: 'POST',
          body: {
            body: this.newComment.trim(),
            isInternal: this.isInternalComment,
          },
        })

        const comment = response?.data
        if (comment) {
          this.comments.push(comment)
          this.item.commentCount++
        }

        this.newComment = ''
        this.isInternalComment = false
      } catch (err) {
        console.error('Error posting comment:', err)
        alert(err?.data?.error?.message || 'Failed to post comment')
      } finally {
        this.isSubmittingComment = false
      }
    },

    async updateStatus(newStatus) {
      if (!this.item || this.item.status === newStatus) return

      this.isUpdatingStatus = true

      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/status`, {
          method: 'PATCH',
          body: { status: newStatus },
        })

        const updated = response?.data
        if (updated) {
          this.item.status = updated.status
          this.item.updatedAt = updated.updatedAt
        }
      } catch (err) {
        console.error('Error updating status:', err)
        alert(err?.data?.error?.message || 'Failed to update status')
      } finally {
        this.isUpdatingStatus = false
      }
    },

    async deleteFeedback() {
      if (!this.item) return

      this.isDeleting = true

      try {
        await $fetch(`/api/feedback/${this.feedbackId}`, { method: 'DELETE' })
        this.showDeleteDialog = false
        navigateTo('/feedback')
      } catch (err) {
        console.error('Error deleting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to delete feedback')
      } finally {
        this.isDeleting = false
      }
    },

    commentAuthorInitials(comment) {
      const name = comment.authorName || comment.author?.name || '?'
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },

    formatDate(dateStr) {
      const date = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const days = Math.floor(diff / 86400000)
      if (days === 0) return 'Today'
      if (days === 1) return 'Yesterday'
      if (days < 7) return `${days} days ago`
      if (days < 30) return `${Math.floor(days / 7)} weeks ago`
      return date.toLocaleDateString()
    },

    formatFullDate(dateStr) {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
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

    statusColor(status) {
      const colors = {
        open: 'bg-blue-500',
        in_progress: 'bg-yellow-500',
        planned: 'bg-purple-500',
        completed: 'bg-green-500',
        closed: 'bg-gray-500',
        declined: 'bg-red-500',
      }
      return colors[status] || 'bg-gray-500'
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
