<template>
  <NuxtLayout name="dashboard">
    <div class="px-4 pb-10 pt-6 sm:px-6 lg:px-10">
      <div v-if="isLoading" class="mx-auto max-w-[1400px] space-y-6">
        <Skeleton class="h-4 w-32" />
        <Skeleton class="h-10 w-[min(30rem,90vw)]" />
        <div class="grid gap-8 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
          <div class="space-y-6">
            <div class="rounded-2xl border bg-card p-6 sm:p-8">
              <Skeleton class="mb-4 h-6 w-40" />
              <Skeleton class="h-10 w-3/4" />
              <Skeleton class="mt-4 h-4 w-full" />
              <Skeleton class="mt-2 h-4 w-[88%]" />
            </div>
            <div class="rounded-2xl border bg-card p-6 sm:p-8">
              <Skeleton class="mb-4 h-6 w-32" />
              <Skeleton class="h-24 w-full" />
            </div>
          </div>
          <div class="space-y-6">
            <div class="rounded-2xl border bg-card p-6">
              <Skeleton class="mb-4 h-6 w-28" />
              <Skeleton class="h-11 w-full" />
            </div>
            <div class="rounded-2xl border bg-card p-6">
              <Skeleton class="mb-4 h-6 w-24" />
              <Skeleton class="h-16 w-full" />
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="error"
        class="mx-auto flex max-w-3xl flex-col items-center rounded-2xl border bg-card px-6 py-14 text-center"
      >
        <Icon name="lucide:alert-circle" class="mb-4 h-10 w-10 text-destructive" />
        <h1 class="text-2xl font-semibold">Failed to load feedback</h1>
        <p class="mt-3 text-sm text-muted-foreground">{{ error }}</p>
        <div class="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" @click="$router.back()">Back</Button>
          <Button @click="loadFeedback">Retry</Button>
        </div>
      </div>

      <div v-else-if="item" data-testid="feedback-detail-page" class="mx-auto max-w-[1400px] space-y-8">
        <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <NuxtLink to="/feedback" prefetch-on="interaction" class="hover:text-foreground">Feedback</NuxtLink>
              <Icon name="lucide:chevron-right" class="h-4 w-4" />
              <NuxtLink
                v-if="item.project"
                :to="`/feedback?projectId=${item.project.id}`"
                prefetch-on="interaction"
                class="hover:text-foreground"
              >
                {{ item.project.name }}
              </NuxtLink>
              <Icon v-if="item.project" name="lucide:chevron-right" class="h-4 w-4" />
              <span class="text-foreground">{{ item.title }}</span>
            </div>
            <Button variant="ghost" size="sm" class="-ml-2 w-fit" @click="$router.back()">
              <Icon name="lucide:arrow-left" class="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{{ item.title }}</h1>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <Button
              v-if="canEditFeedback"
              data-testid="feedback-detail-edit"
              variant="outline"
              @click="openEditDialog"
            >
              <Icon name="lucide:pencil" class="mr-2 h-4 w-4" />
              Edit feedback
            </Button>
            <Button
              v-if="canDeleteFeedback"
              data-testid="feedback-detail-delete"
              variant="destructive"
              @click="showDeleteDialog = true"
            >
              <Icon name="lucide:trash-2" class="mr-2 h-4 w-4" />
              Delete feedback
            </Button>
          </div>
        </div>

        <div class="grid gap-8 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
          <div data-testid="feedback-detail-main" class="space-y-6">
            <section class="rounded-[28px] border bg-card p-6 shadow-sm sm:p-8">
              <div class="mb-5 flex flex-wrap gap-2">
                <Badge class="border-transparent" :style="statusPillStyle(item.status)">
                  {{ formatStatus(item.status) }}
                </Badge>
                <Badge v-if="item.category" variant="outline">{{ item.category.name }}</Badge>
                <Badge v-if="item.tag" variant="secondary">{{ feedbackTypeLabel(item.tag) || item.tag }}</Badge>
                <Badge v-if="item.isPinned" variant="outline">Pinned</Badge>
                <Badge v-if="item.isHidden" variant="outline">Hidden</Badge>
                <Badge v-if="item.isLocked" variant="outline">Comments locked</Badge>
              </div>

              <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
                <div class="flex shrink-0 items-center gap-3 lg:w-[88px] lg:flex-col">
                  <button
                    class="flex h-12 w-12 items-center justify-center rounded-2xl border"
                    :class="item.voteType === 'upvote' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'"
                    :disabled="isVoting"
                    @click="toggleVote('upvote')"
                  >
                    <Icon name="lucide:chevron-up" class="h-5 w-5" />
                  </button>
                  <div class="min-w-[3.5rem] text-center">
                    <div class="text-2xl font-semibold">{{ item.voteCount }}</div>
                    <div class="text-xs uppercase tracking-[0.2em] text-muted-foreground">Votes</div>
                  </div>
                  <button
                    class="flex h-12 w-12 items-center justify-center rounded-2xl border"
                    :class="item.voteType === 'downvote' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'"
                    :disabled="isVoting"
                    @click="toggleVote('downvote')"
                  >
                    <Icon name="lucide:chevron-down" class="h-5 w-5" />
                  </button>
                </div>

                <div class="flex-1 space-y-5">
                  <p v-if="item.body" class="whitespace-pre-line text-sm leading-7 text-foreground/85">{{ item.body }}</p>
                  <p v-else class="italic text-muted-foreground">No description provided.</p>

                  <div class="grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div class="rounded-xl bg-background/80 p-4">
                      <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Author</div>
                      <div class="mt-2 flex items-center gap-3">
                        <Avatar class="h-9 w-9">
                          <AvatarImage v-if="item.author?.image" :src="item.author.image" />
                          <AvatarFallback class="text-xs">{{ authorInitials }}</AvatarFallback>
                        </Avatar>
                        <div class="min-w-0">
                          <div class="truncate text-sm font-medium">{{ displayAuthorName }}</div>
                          <div class="text-xs text-muted-foreground">{{ item.isOwn ? 'Your submission' : 'Submitted feedback' }}</div>
                        </div>
                      </div>
                    </div>
                    <div class="rounded-xl bg-background/80 p-4">
                      <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Project</div>
                      <div class="mt-2 text-sm font-medium">{{ item.project?.name || 'Unknown' }}</div>
                    </div>
                    <div class="rounded-xl bg-background/80 p-4">
                      <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Created</div>
                      <div class="mt-2 text-sm font-medium">{{ formatDate(item.createdAt) }}</div>
                    </div>
                    <div class="rounded-xl bg-background/80 p-4">
                      <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Updated</div>
                      <div class="mt-2 text-sm font-medium">{{ formatDate(item.updatedAt) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-[28px] border bg-card p-6 shadow-sm sm:p-8">
              <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 class="text-xl font-semibold">Conversation</h2>
                  <p class="mt-1 text-sm text-muted-foreground">Public comments and internal notes live here.</p>
                </div>
                <div class="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-sm">
                  <Icon name="lucide:message-circle" class="h-4 w-4 text-muted-foreground" />
                  <span class="font-medium">{{ comments.length }}</span>
                  <span class="text-muted-foreground">comments</span>
                </div>
              </div>

              <div v-if="isCommentsLoading" class="space-y-4">
                <Skeleton class="h-24 w-full" />
                <Skeleton class="h-24 w-full" />
              </div>
              <div v-else-if="commentsError" class="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
                <p class="text-sm text-destructive">{{ commentsError }}</p>
                <Button class="mt-4" size="sm" variant="outline" @click="loadComments">Retry comments</Button>
              </div>
              <div v-else-if="comments.length === 0" class="rounded-2xl border border-dashed p-10 text-center">
                <p class="text-sm text-muted-foreground">No comments yet.</p>
              </div>
              <div v-else class="space-y-4">
                <article
                  v-for="comment in comments"
                  :key="comment.id"
                  :data-testid="`feedback-detail-comment-${comment.id}`"
                  class="rounded-2xl border p-5"
                  :class="comment.isInternal ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20' : 'bg-background/80'"
                >
                  <div class="flex items-start gap-4">
                    <Avatar class="mt-0.5 h-10 w-10 shrink-0">
                      <AvatarImage v-if="comment.author?.image" :src="comment.author.image" />
                      <AvatarFallback class="text-xs">{{ commentAuthorInitials(comment) }}</AvatarFallback>
                    </Avatar>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="truncate text-sm font-medium">{{ comment.authorName || comment.author?.name || 'Anonymous' }}</span>
                            <Badge v-if="comment.isInternal" variant="outline">Internal</Badge>
                            <span v-if="comment.isEdited" class="text-xs italic text-muted-foreground">(edited)</span>
                          </div>
                          <div class="mt-1 text-xs text-muted-foreground">{{ formatDate(comment.createdAt) }}</div>
                        </div>
                        <div v-if="comment.canEdit || comment.canDelete" class="flex items-center gap-2 self-start">
                          <Button v-if="comment.canEdit" :data-testid="`comment-edit-btn-${comment.id}`" size="sm" variant="ghost" @click="startEditComment(comment)">
                            <Icon name="lucide:pencil" class="h-4 w-4" />
                          </Button>
                          <Button v-if="comment.canDelete" :data-testid="`comment-delete-btn-${comment.id}`" size="sm" variant="ghost" class="text-destructive hover:text-destructive" @click="deleteComment(comment)">
                            <Icon name="lucide:trash-2" class="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <template v-if="editingCommentId === comment.id">
                        <div class="mt-4 space-y-3">
                          <Textarea v-model="editingCommentBody" rows="4" :disabled="isSavingComment" />
                          <div class="flex flex-wrap gap-3">
                            <Button size="sm" variant="outline" :disabled="isSavingComment" @click="cancelEditComment">Cancel</Button>
                            <Button size="sm" :disabled="!editingCommentBody.trim() || isSavingComment" @click="saveEditComment(comment)">
                              <Icon v-if="isSavingComment" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                              Save comment
                            </Button>
                          </div>
                        </div>
                      </template>
                      <p v-else class="mt-4 whitespace-pre-line text-sm leading-7 text-foreground/85">{{ comment.body }}</p>
                    </div>
                  </div>
                </article>
              </div>

              <div class="mt-8 rounded-2xl border bg-muted/20 p-5 sm:p-6">
                <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 class="text-base font-semibold">Add a comment</h3>
                    <p class="mt-1 text-sm text-muted-foreground">
                      {{ item.isLocked ? 'Comments are locked for this feedback.' : 'Keep the discussion moving with public updates or internal notes.' }}
                    </p>
                  </div>
                  <label
                    v-if="canManageFeedback"
                    class="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    <input v-model="isInternalComment" type="checkbox" class="rounded border-border" >
                    <Icon name="lucide:lock" class="h-4 w-4" />
                    Internal note
                  </label>
                </div>
                <Textarea
                  v-model="newComment"
                  data-testid="feedback-detail-comment-input"
                  rows="4"
                  placeholder="Write a comment..."
                  :disabled="isSubmittingComment || item.isLocked"
                />
                <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p v-if="detailCommentError" class="text-sm text-destructive">{{ detailCommentError }}</p>
                  <div v-else-if="item.isLocked" class="text-sm text-muted-foreground">Unlock comments from the admin card to continue the thread.</div>
                  <div v-else class="text-sm text-muted-foreground">
                    {{ canManageFeedback ? 'Workspace members can post public comments or internal notes.' : 'Your comment will be visible in the thread.' }}
                  </div>
                  <Button
                    data-testid="feedback-detail-comment-submit"
                    :disabled="!newComment.trim() || isSubmittingComment || item.isLocked"
                    @click="submitComment"
                  >
                    <Icon v-if="isSubmittingComment" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                    Post comment
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <aside data-testid="feedback-detail-sidebar" class="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <section class="rounded-[28px] border bg-card p-6 shadow-sm">
              <h2 class="text-lg font-semibold">Workflow</h2>
              <p class="mt-1 text-sm text-muted-foreground">Status, notifications, and public-board behavior.</p>
              <div class="mt-5 space-y-5">
                <div class="space-y-2">
                  <div class="text-sm font-medium">Status</div>
                  <select
                    v-if="canManageFeedback"
                    :value="item.status"
                    data-testid="feedback-detail-status-select"
                    class="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                    :disabled="isUpdatingStatus"
                    @change="updateStatus($event.target.value)"
                  >
                    <option v-for="status in statusOptions" :key="status.value" :value="status.value">
                      {{ status.name || formatStatus(status.value) }}
                    </option>
                  </select>
                  <Badge v-else class="border-transparent" :style="statusPillStyle(item.status)">
                    {{ formatStatus(item.status) }}
                  </Badge>
                </div>
                <div class="rounded-2xl border bg-muted/20 p-4">
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-sm font-medium">Visibility</span>
                    <Badge variant="outline">{{ item.isHidden ? 'Hidden' : 'Visible' }}</Badge>
                  </div>
                  <div class="mt-3 flex items-center justify-between gap-4">
                    <span class="text-sm font-medium">Comments</span>
                    <Badge variant="outline">{{ item.isLocked ? 'Locked' : 'Open' }}</Badge>
                  </div>
                </div>
                <div class="rounded-2xl border bg-muted/20 p-4">
                  <div class="text-sm font-medium">Subscribe to updates</div>
                  <p class="mt-1 text-sm text-muted-foreground">Get notified when the status changes or when new comments arrive.</p>
                  <Button class="mt-4 w-full" :variant="item.isSubscribed ? 'default' : 'outline'" :disabled="detailSubscribeLoading" @click="toggleSubscription">
                    <Icon
                      :name="detailSubscribeLoading ? 'lucide:loader-2' : item.isSubscribed ? 'lucide:bell-off' : 'lucide:bell'"
                      class="mr-2 h-4 w-4"
                      :class="detailSubscribeLoading ? 'animate-spin' : ''"
                    />
                    {{ item.isSubscribed ? 'Unsubscribe' : 'Get notified' }}
                  </Button>
                </div>
              </div>
            </section>

            <section class="rounded-[28px] border bg-card p-6 shadow-sm">
              <h2 class="text-lg font-semibold">Details</h2>
              <p class="mt-1 text-sm text-muted-foreground">Keep useful context visible while you work the item.</p>
              <div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div class="rounded-2xl border bg-muted/20 p-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Votes</div>
                  <div class="mt-2 text-2xl font-semibold">{{ item.voteCount }}</div>
                </div>
                <div class="rounded-2xl border bg-muted/20 p-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Comments</div>
                  <div class="mt-2 text-2xl font-semibold">{{ item.commentCount }}</div>
                </div>
                <div class="rounded-2xl border bg-muted/20 p-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Category</div>
                  <div class="mt-2 text-sm font-medium">{{ item.category?.name || 'Uncategorized' }}</div>
                </div>
                <div class="rounded-2xl border bg-muted/20 p-4">
                  <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Type</div>
                  <div class="mt-2 text-sm font-medium">{{ feedbackTypeLabel(item.tag) || item.tag || 'Unspecified' }}</div>
                </div>
              </div>
            </section>

            <section
              v-if="canManageFeedback"
              data-testid="feedback-detail-admin-card"
              class="rounded-[28px] border bg-card p-6 shadow-sm"
            >
              <h2 class="text-lg font-semibold">Admin Controls</h2>
              <p class="mt-1 text-sm text-muted-foreground">Same moderation options as the public detail view, plus workspace controls.</p>
              <div class="mt-5 space-y-3">
                <button
                  data-testid="feedback-detail-pin"
                  class="flex w-full items-start justify-between rounded-2xl border p-4 text-left transition hover:border-primary/40 hover:bg-muted/30"
                  :disabled="adminAction === 'pin'"
                  @click="togglePin"
                >
                  <div>
                    <div class="font-medium">{{ item.isPinned ? 'Unpin feedback' : 'Pin feedback' }}</div>
                    <div class="mt-1 text-sm text-muted-foreground">{{ item.isPinned ? 'Remove this item from the top of lists.' : 'Keep this item at the top of boards and lists.' }}</div>
                  </div>
                  <Icon :name="adminAction === 'pin' ? 'lucide:loader-2' : item.isPinned ? 'lucide:pin-off' : 'lucide:pin'" class="h-5 w-5 shrink-0" :class="adminAction === 'pin' ? 'animate-spin' : ''" />
                </button>
                <button
                  data-testid="feedback-detail-visibility"
                  class="flex w-full items-start justify-between rounded-2xl border p-4 text-left transition hover:border-primary/40 hover:bg-muted/30"
                  :disabled="adminAction === 'visibility'"
                  @click="toggleVisibility"
                >
                  <div>
                    <div class="font-medium">{{ item.isHidden ? 'Make feedback visible' : 'Hide from public board' }}</div>
                    <div class="mt-1 text-sm text-muted-foreground">{{ item.isHidden ? 'Return this item to the public board.' : 'Keep handling private while preserving the record.' }}</div>
                  </div>
                  <Icon :name="adminAction === 'visibility' ? 'lucide:loader-2' : item.isHidden ? 'lucide:eye' : 'lucide:eye-off'" class="h-5 w-5 shrink-0" :class="adminAction === 'visibility' ? 'animate-spin' : ''" />
                </button>
                <button
                  data-testid="feedback-detail-lock"
                  class="flex w-full items-start justify-between rounded-2xl border p-4 text-left transition hover:border-primary/40 hover:bg-muted/30"
                  :disabled="adminAction === 'lock'"
                  @click="toggleLock"
                >
                  <div>
                    <div class="font-medium">{{ item.isLocked ? 'Unlock comments' : 'Lock comments' }}</div>
                    <div class="mt-1 text-sm text-muted-foreground">{{ item.isLocked ? 'Allow the thread to continue.' : 'Freeze new replies while the team resolves the item.' }}</div>
                  </div>
                  <Icon :name="adminAction === 'lock' ? 'lucide:loader-2' : item.isLocked ? 'lucide:unlock' : 'lucide:lock'" class="h-5 w-5 shrink-0" :class="adminAction === 'lock' ? 'animate-spin' : ''" />
                </button>
              </div>
            </section>
          </aside>
        </div>

        <Dialog :open="showEditDialog" @update:open="showEditDialog = $event">
          <DialogContent class="sm:max-w-[640px]">
            <DialogHeader>
              <DialogTitle>Edit Feedback</DialogTitle>
              <DialogDescription>Update the content and metadata for this feedback item.</DialogDescription>
            </DialogHeader>
            <div class="space-y-5 py-2">
              <div class="space-y-2">
                <Label for="feedback-title">Title</Label>
                <Input id="feedback-title" v-model="editForm.title" data-testid="feedback-detail-edit-title" />
              </div>
              <div class="space-y-2">
                <Label for="feedback-body">Description</Label>
                <Textarea id="feedback-body" v-model="editForm.body" data-testid="feedback-detail-edit-body" rows="6" />
              </div>
              <div class="grid gap-5 sm:grid-cols-2">
                <div v-if="canManageFeedback" class="space-y-2">
                  <Label for="feedback-category">Category</Label>
                  <select
                    id="feedback-category"
                    v-model="editForm.categoryId"
                    class="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="">Uncategorized</option>
                    <option v-for="category in categories" :key="category.id" :value="category.id">
                      {{ category.name }}
                    </option>
                  </select>
                </div>
                <div class="space-y-2">
                  <Label for="feedback-type">Type</Label>
                  <select
                    id="feedback-type"
                    v-model="editForm.feedbackType"
                    class="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="">Unspecified</option>
                    <option v-for="option in feedbackTypeOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" :disabled="isSavingFeedback" @click="showEditDialog = false">Cancel</Button>
              <Button data-testid="feedback-detail-save" :disabled="!editForm.title.trim() || !editForm.body.trim() || isSavingFeedback" @click="saveFeedback">
                <Icon v-if="isSavingFeedback" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
          <DialogContent class="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Delete Feedback</DialogTitle>
              <DialogDescription>
                This permanently deletes "{{ item?.title }}". The feedback thread and comments cannot be recovered.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" :disabled="isDeleting" @click="showDeleteDialog = false">Cancel</Button>
              <Button variant="destructive" :disabled="isDeleting" @click="deleteFeedback">
                <Icon v-if="isDeleting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                Delete feedback
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
export default {
  name: 'FeedbackDetailPage',

  data() {
    return {
      item: null,
      comments: [],
      categories: [],
      availableStatuses: [],
      isLoading: true,
      error: null,
      isCommentsLoading: false,
      commentsError: null,
      isVoting: false,
      isUpdatingStatus: false,
      isSubmittingComment: false,
      isSavingComment: false,
      isSavingFeedback: false,
      isDeleting: false,
      detailSubscribeLoading: false,
      newComment: '',
      isInternalComment: false,
      detailCommentError: null,
      editingCommentId: null,
      editingCommentBody: '',
      showEditDialog: false,
      showDeleteDialog: false,
      adminAction: null,
      editForm: {
        title: '',
        body: '',
        categoryId: '',
        feedbackType: '',
      },
      feedbackTypeOptions: [
        { value: 'feature_request', label: 'Feature request' },
        { value: 'bug_report', label: 'Bug report' },
        { value: 'improvement', label: 'Improvement' },
        { value: 'question', label: 'Question' },
        { value: 'other', label: 'Other' },
      ],
      fallbackStatuses: [
        { value: 'open', name: 'Open', color: '#3b82f6' },
        { value: 'planned', name: 'Planned', color: '#8b5cf6' },
        { value: 'in_progress', name: 'In Progress', color: '#f59e0b' },
        { value: 'completed', name: 'Completed', color: '#10b981' },
        { value: 'closed', name: 'Closed', color: '#6b7280' },
        { value: 'declined', name: 'Declined', color: '#ef4444' },
      ],
    }
  },

  computed: {
    feedbackId() {
      return this.$route.params.id
    },
    canEditFeedback() {
      return Boolean(this.item?.canEdit)
    },
    canDeleteFeedback() {
      return Boolean(this.item?.canDelete)
    },
    canManageFeedback() {
      return Boolean(this.item?.canManage)
    },
    displayAuthorName() {
      return this.item?.authorName || this.item?.author?.name || 'Anonymous'
    },
    authorInitials() {
      return this.initialsFromName(this.displayAuthorName)
    },
    statusOptions() {
      return this.ensureCurrentStatus(this.availableStatuses, this.item?.status)
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
        await Promise.all([this.loadComments(), this.loadProjectControls()])
      } catch (err) {
        console.error('Error loading feedback:', err)
        if (err?.statusCode === 404) this.error = 'Feedback not found'
        else if (err?.statusCode === 403) this.error = 'You do not have access to this feedback'
        else this.error = err?.data?.error?.message || 'Failed to load feedback'
      } finally {
        this.isLoading = false
      }
    },

    async loadProjectControls() {
      this.availableStatuses = []
      this.categories = []
      if (!this.item?.project?.slug || !this.canManageFeedback) return

      const [statusesResult, categoriesResult] = await Promise.allSettled([
        $fetch(`/api/projects/${this.item.project.slug}/statuses`),
        $fetch(`/api/projects/${this.item.project.slug}/categories`),
      ])

      if (statusesResult.status === 'fulfilled') {
        this.availableStatuses = Array.isArray(statusesResult.value?.data) ? statusesResult.value.data : []
      }
      if (categoriesResult.status === 'fulfilled') {
        this.categories = Array.isArray(categoriesResult.value?.data) ? categoriesResult.value.data : []
      }
    },

    async loadComments() {
      this.isCommentsLoading = true
      this.commentsError = null
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/comments`)
        this.comments = Array.isArray(response?.data) ? response.data : []
      } catch (err) {
        console.error('Error loading comments:', err)
        this.commentsError = err?.data?.error?.message || 'Failed to load comments'
      } finally {
        this.isCommentsLoading = false
      }
    },

    async toggleVote(type) {
      if (!this.item || this.isVoting) return
      this.isVoting = true
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/vote`, {
          method: 'POST',
          body: { type },
        })
        const data = response?.data
        if (data) {
          this.item = {
            ...this.item,
            voteCount: data.voteCount,
            voteType: data.voteType,
            hasVoted: data.voted,
          }
        }
      } catch (err) {
        console.error('Error toggling vote:', err)
        alert(err?.data?.error?.message || 'Failed to update vote')
      } finally {
        this.isVoting = false
      }
    },

    async updateStatus(newStatus) {
      if (!this.item || !this.canManageFeedback || this.item.status === newStatus) return
      this.isUpdatingStatus = true
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/status`, {
          method: 'PATCH',
          body: { status: newStatus },
        })
        const updated = response?.data
        if (updated) {
          this.item = {
            ...this.item,
            status: updated.status,
            updatedAt: updated.updatedAt,
          }
        }
      } catch (err) {
        console.error('Error updating status:', err)
        alert(err?.data?.error?.message || 'Failed to update status')
      } finally {
        this.isUpdatingStatus = false
      }
    },

    openEditDialog() {
      if (!this.item) return
      this.editForm = {
        title: this.item.title || '',
        body: this.item.body || '',
        categoryId: this.item.category?.id || '',
        feedbackType: this.item.tag || '',
      }
      this.showEditDialog = true
    },

    async saveFeedback() {
      if (!this.item || !this.canEditFeedback) return
      this.isSavingFeedback = true
      try {
        await $fetch(`/api/feedback/${this.feedbackId}`, {
          method: 'PATCH',
          body: {
            title: this.editForm.title.trim(),
            body: this.editForm.body.trim(),
            feedbackType: this.editForm.feedbackType || null,
            ...(this.canManageFeedback ? { categoryId: this.editForm.categoryId || null } : {}),
          },
        })
        this.showEditDialog = false
        await this.loadFeedback()
      } catch (err) {
        console.error('Error saving feedback:', err)
        alert(err?.data?.error?.message || 'Failed to save feedback')
      } finally {
        this.isSavingFeedback = false
      }
    },

    async submitComment() {
      if (!this.item || !this.newComment.trim() || this.item.isLocked) return
      this.isSubmittingComment = true
      this.detailCommentError = null
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/comments`, {
          method: 'POST',
          body: {
            body: this.newComment.trim(),
            ...(this.canManageFeedback ? { isInternal: this.isInternalComment } : {}),
          },
        })
        const comment = response?.data
        if (comment) {
          this.comments.push(comment)
          this.item.commentCount = (this.item.commentCount || 0) + 1
        }
        this.newComment = ''
        this.isInternalComment = false
      } catch (err) {
        console.error('Error posting comment:', err)
        this.detailCommentError = err?.data?.error?.message || 'Failed to post comment'
      } finally {
        this.isSubmittingComment = false
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
        const response = await $fetch(`/api/feedback/${this.feedbackId}/comments/${comment.id}`, {
          method: 'PATCH',
          body: { body: this.editingCommentBody.trim() },
        })
        const updated = response?.data
        if (updated) {
          const index = this.comments.findIndex((item) => item.id === comment.id)
          if (index !== -1) {
            this.comments[index] = {
              ...this.comments[index],
              body: updated.body,
              updatedAt: updated.updatedAt,
              isEdited: true,
            }
          }
        }
        this.cancelEditComment()
      } catch (err) {
        console.error('Error editing comment:', err)
        alert(err?.data?.error?.message || 'Failed to edit comment')
      } finally {
        this.isSavingComment = false
      }
    },

    async deleteComment(comment) {
      if (!confirm('Delete this comment? This cannot be undone.')) return
      try {
        await $fetch(`/api/feedback/${this.feedbackId}/comments/${comment.id}`, { method: 'DELETE' })
        this.comments = this.comments.filter((item) => item.id !== comment.id)
        if (this.item) {
          this.item.commentCount = Math.max((this.item.commentCount || 0) - 1, 0)
        }
      } catch (err) {
        console.error('Error deleting comment:', err)
        alert(err?.data?.error?.message || 'Failed to delete comment')
      }
    },

    async toggleSubscription() {
      if (!this.item || this.detailSubscribeLoading) return
      this.detailSubscribeLoading = true
      try {
        if (this.item.isSubscribed) {
          await $fetch(`/api/feedback/${this.feedbackId}/subscribe`, { method: 'DELETE' })
          this.item.isSubscribed = false
        } else {
          await $fetch(`/api/feedback/${this.feedbackId}/subscribe`, { method: 'POST' })
          this.item.isSubscribed = true
        }
      } catch (err) {
        console.error('Subscription toggle failed:', err)
        alert(err?.data?.error?.message || 'Failed to update subscription')
      } finally {
        this.detailSubscribeLoading = false
      }
    },

    async togglePin() {
      if (!this.canManageFeedback || this.adminAction) return
      this.adminAction = 'pin'
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/pin`, { method: 'PATCH' })
        const updated = response?.data
        if (updated && this.item) {
          this.item.isPinned = updated.isPinned
          this.item.updatedAt = updated.updatedAt
        }
      } catch (err) {
        console.error('Error toggling pin:', err)
        alert(err?.data?.error?.message || 'Failed to update pin state')
      } finally {
        this.adminAction = null
      }
    },

    async toggleVisibility() {
      if (!this.canManageFeedback || this.adminAction) return
      this.adminAction = 'visibility'
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/visibility`, { method: 'PATCH' })
        const updated = response?.data
        if (updated && this.item) {
          this.item.isHidden = updated.isHidden
          this.item.updatedAt = updated.updatedAt
        }
      } catch (err) {
        console.error('Error toggling visibility:', err)
        alert(err?.data?.error?.message || 'Failed to update visibility')
      } finally {
        this.adminAction = null
      }
    },

    async toggleLock() {
      if (!this.canManageFeedback || this.adminAction) return
      this.adminAction = 'lock'
      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/lock`, { method: 'PATCH' })
        const updated = response?.data
        if (updated && this.item) {
          this.item.isLocked = updated.isLocked
          this.item.updatedAt = updated.updatedAt
        }
      } catch (err) {
        console.error('Error toggling comment lock:', err)
        alert(err?.data?.error?.message || 'Failed to update comment lock')
      } finally {
        this.adminAction = null
      }
    },

    async deleteFeedback() {
      if (!this.item) return
      this.isDeleting = true
      try {
        await $fetch(`/api/feedback/${this.feedbackId}`, { method: 'DELETE' })
        this.showDeleteDialog = false
        await navigateTo('/feedback')
      } catch (err) {
        console.error('Error deleting feedback:', err)
        alert(err?.data?.error?.message || 'Failed to delete feedback')
      } finally {
        this.isDeleting = false
      }
    },

    ensureCurrentStatus(statuses, currentValue) {
      const list = Array.isArray(statuses) && statuses.length > 0 ? statuses : this.fallbackStatuses
      if (!currentValue || list.some((status) => status.value === currentValue)) return list
      return [...list, this.resolveStatusMeta(currentValue)]
    },

    resolveStatusMeta(status) {
      return (
        this.availableStatuses.find((item) => item.value === status) ||
        this.fallbackStatuses.find((item) => item.value === status) || {
          value: status,
          name: this.formatStatus(status),
          color: '#6b7280',
        }
      )
    },

    statusPillStyle(status) {
      const meta = this.resolveStatusMeta(status)
      const color = meta?.color || '#6b7280'
      return {
        backgroundColor: `${color}1a`,
        color,
      }
    },

    feedbackTypeLabel(value) {
      const option = this.feedbackTypeOptions.find((item) => item.value === value)
      return option?.label || ''
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

    formatDate(dateStr) {
      if (!dateStr) return ''
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / 86400000)
      if (diffDays <= 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      return date.toLocaleDateString()
    },

    commentAuthorInitials(comment) {
      return this.initialsFromName(comment.authorName || comment.author?.name || 'Anonymous')
    },

    initialsFromName(name) {
      return String(name || '?')
        .split(' ')
        .map((part) => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    },
  },
}
</script>
