<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-4">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:newspaper" class="h-5 w-5" />
              Changelog
            </CardTitle>
            <CardDescription>Manage release notes for this product. Imported posts arrive as drafts.</CardDescription>
          </div>
          <Button data-testid="product-changelog-open-create" @click="openCreateDialog">
            <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
            New Post
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-3">
          <Skeleton v-for="n in 3" :key="n" class="h-20 w-full" />
        </div>

        <div v-else-if="displayError" class="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p class="text-sm text-destructive">{{ displayError }}</p>
          <Button variant="outline" size="sm" class="mt-3" @click="reloadPosts">Try Again</Button>
        </div>

        <div v-else-if="posts.length === 0" class="rounded-lg border border-dashed p-10 text-center">
          <Icon name="lucide:newspaper" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p class="font-medium">No changelog posts yet</p>
          <p class="text-sm text-muted-foreground mt-1">Create a post manually or import one from another tool.</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="post in posts"
            :key="post.id"
            :data-testid="`product-changelog-post-${post.id}`"
            class="rounded-lg border p-4"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="font-medium">{{ post.title }}</p>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="
                      post.isDraft
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                    "
                  >
                    {{ post.isDraft ? 'Draft' : 'Published' }}
                  </span>
                  <span
                    v-if="post.category"
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                  >
                    {{ post.category }}
                  </span>
                </div>
                <p class="text-sm text-muted-foreground mt-2 whitespace-pre-line">{{ post.body }}</p>
                <p class="text-xs text-muted-foreground mt-3">
                  {{ post.isDraft ? 'Created' : 'Published' }} {{ formatDate(post.publishedAt || post.createdAt) }}
                </p>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" @click="openEditDialog(post)">
                  <Icon name="lucide:pencil" class="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
                <Button
                  v-if="post.isDraft"
                  size="sm"
                  :data-testid="`product-changelog-publish-${post.id}`"
                  :disabled="publishingId === post.id"
                  @click="publishPost(post)"
                >
                  <Icon
                    v-if="publishingId === post.id"
                    name="lucide:loader-2"
                    class="h-4 w-4 mr-1.5 animate-spin"
                  />
                  <Icon v-else name="lucide:send" class="h-4 w-4 mr-1.5" />
                  Publish
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="showDialog" @update:open="handleDialogOpenChange">
      <DialogContent class="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ editingPostId ? 'Edit changelog post' : 'Create changelog post' }}</DialogTitle>
          <DialogDescription>Drafts stay private until you publish them.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="changelog-title">Title</Label>
            <Input id="changelog-title" v-model="form.title" />
          </div>
          <div class="space-y-2">
            <Label for="changelog-category">Category</Label>
            <Input id="changelog-category" v-model="form.category" placeholder="Release, Improvement, Fix" />
          </div>
          <div class="space-y-2">
            <Label for="changelog-body">Body</Label>
            <Textarea id="changelog-body" v-model="form.body" rows="8" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="handleDialogOpenChange(false)">Cancel</Button>
          <Button :disabled="isSaving || !canSubmit" @click="savePost">
            <Icon v-if="isSaving" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
            {{ editingPostId ? 'Save Changes' : 'Create Draft' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsChangelog',
  props: {
    project: {
      type: Object,
      required: true,
    },
    resourceState: {
      type: Object,
      required: true,
    },
    ensureLoaded: {
      type: Function,
      default: null,
    },
    refresh: {
      type: Function,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      showDialog: false,
      editingPostId: null,
      isSaving: false,
      publishingId: null,
      form: {
        title: '',
        category: '',
        body: '',
      },
    }
  },
  computed: {
    posts() {
      return Array.isArray(this.resourceState?.data) ? this.resourceState.data : []
    },
    isLoading() {
      return ['idle', 'loading'].includes(this.resourceState?.status) && this.posts.length === 0
    },
    displayError() {
      return this.resourceState?.status === 'error' ? this.resourceState?.error || 'Failed to load changelog' : null
    },
    canSubmit() {
      return this.form.title.trim().length > 0 && this.form.body.trim().length > 0
    },
  },
  watch: {
    isActive: {
      async handler(isActive) {
        if (!isActive || !this.ensureLoaded) return
        await this.ensureLoaded().catch(() => {})
      },
      immediate: true,
    },
  },
  methods: {
    formatDate(value) {
      if (!value) return 'just now'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return 'just now'
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    },
    resetForm() {
      this.editingPostId = null
      this.form = {
        title: '',
        category: '',
        body: '',
      }
    },
    handleDialogOpenChange(open) {
      this.showDialog = open
      if (!open) {
        this.resetForm()
      }
    },
    openCreateDialog() {
      this.resetForm()
      this.showDialog = true
    },
    openEditDialog(post) {
      this.editingPostId = post.id
      this.form = {
        title: post.title || '',
        category: post.category || '',
        body: post.body || '',
      }
      this.showDialog = true
    },
    async reloadPosts() {
      if (!this.refresh) return
      await this.refresh().catch(() => {})
    },
    async savePost() {
      if (this.isSaving || !this.canSubmit) return
      this.isSaving = true

      try {
        if (this.editingPostId) {
          await $fetch(`/api/projects/${this.project.slug}/changelog/${this.editingPostId}`, {
            method: 'PUT',
            body: {
              title: this.form.title,
              category: this.form.category || null,
              body: this.form.body,
            },
          })
          toast.success('Changelog post updated')
        } else {
          await $fetch(`/api/projects/${this.project.slug}/changelog`, {
            method: 'POST',
            body: {
              title: this.form.title,
              category: this.form.category || null,
              body: this.form.body,
              isDraft: true,
            },
          })
          toast.success('Draft created')
        }

        this.handleDialogOpenChange(false)
        await this.reloadPosts()
      } catch (err) {
        console.error('Failed to save changelog post:', err)
        toast.error(err?.data?.error?.message || 'Failed to save changelog post')
      } finally {
        this.isSaving = false
      }
    },
    async publishPost(post) {
      if (this.publishingId) return
      this.publishingId = post.id

      try {
        await $fetch(`/api/projects/${this.project.slug}/changelog/${post.id}/publish`, {
          method: 'POST',
        })
        toast.success('Changelog post published')
        await this.reloadPosts()
      } catch (err) {
        console.error('Failed to publish changelog post:', err)
        toast.error(err?.data?.error?.message || 'Failed to publish changelog post')
      } finally {
        this.publishingId = null
      }
    },
  },
}
</script>

