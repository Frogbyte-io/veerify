<template>
  <div class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" :data-testid="`launch-card-${item.id}`">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="truncate font-semibold">{{ item.name }}</h3>
        <div class="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{{ categoryText }}</Badge>
          <Badge v-if="!item.custom" variant="outline" class="capitalize">{{ item.pricing }}</Badge>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0 gap-1"
            :disabled="saving"
            :aria-label="`Status for ${item.name}: ${statusText}`"
            :data-testid="`launch-status-${item.id}`"
          >
            <Icon v-if="saving" name="lucide:loader-circle" class="h-3.5 w-3.5 animate-spin" />
            {{ statusText }}
            <Icon name="lucide:chevron-down" class="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem v-for="status in statuses" :key="status.value" @select="setStatus(status.value)">
            <span class="flex-1">{{ status.label }}</span>
            <Icon v-if="status.value === item.status" name="lucide:check" class="h-4 w-4" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <p v-if="item.audience" class="text-sm text-muted-foreground">{{ item.audience }}</p>
    <p v-if="item.tips" class="text-sm">
      <span class="font-medium">Tip:</span>
      {{ item.tips }}
    </p>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <a
        v-if="siteUrl"
        :href="siteUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex min-h-9 items-center gap-1 px-1 underline"
        :data-testid="`launch-site-${item.id}`"
      >
        <Icon name="lucide:external-link" class="h-3.5 w-3.5" />
        Visit site
      </a>
      <a
        v-if="item.submitUrl"
        :href="item.submitUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex min-h-9 items-center gap-1 px-1 underline"
        :data-testid="`launch-submit-${item.id}`"
      >
        <Icon name="lucide:send" class="h-3.5 w-3.5" />
        Submit page
      </a>
    </div>

    <div class="mt-auto space-y-2 border-t border-border pt-3">
      <form v-if="editing" class="space-y-2" @submit.prevent="save" @keydown.esc="cancelEdit">
        <div class="space-y-1">
          <Label :for="`launch-url-${item.id}`" class="text-xs">
            {{ item.custom ? 'Directory link (https)' : 'Your listing URL (https)' }}
          </Label>
          <Input
            :id="`launch-url-${item.id}`"
            v-model="urlDraft"
            type="url"
            maxlength="500"
            placeholder="https://"
            :disabled="saving"
          />
        </div>
        <div class="space-y-1">
          <Label :for="`launch-notes-${item.id}`" class="text-xs">Notes</Label>
          <Textarea :id="`launch-notes-${item.id}`" v-model="notesDraft" rows="2" maxlength="1000" :disabled="saving" />
        </div>
        <div class="flex gap-2">
          <Button type="submit" size="sm" :disabled="saving">Save</Button>
          <Button type="button" size="sm" variant="ghost" :disabled="saving" @click="cancelEdit">Cancel</Button>
        </div>
      </form>

      <div v-else class="flex items-start justify-between gap-2 text-sm">
        <div class="min-w-0 space-y-1">
          <a
            v-if="!item.custom && item.url"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="block truncate underline"
          >
            {{ item.url }}
          </a>
          <p v-if="item.notes" class="whitespace-pre-line text-muted-foreground">{{ item.notes }}</p>
          <p v-if="dates" class="text-xs text-muted-foreground">{{ dates }}</p>
          <p v-if="!hasDetails" class="text-muted-foreground">No listing URL or notes yet.</p>
        </div>
        <div class="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            :aria-label="`Edit ${item.name}`"
            :data-testid="`launch-edit-${item.id}`"
            @click="startEdit"
          >
            <Icon name="lucide:pencil" class="h-4 w-4" />
          </Button>
          <Button
            v-if="item.custom || canReset"
            size="sm"
            variant="ghost"
            :disabled="saving"
            :aria-label="item.custom ? `Remove ${item.name}` : `Reset ${item.name}`"
            :data-testid="`launch-remove-${item.id}`"
            @click="remove"
          >
            <Icon :name="item.custom ? 'lucide:trash-2' : 'lucide:rotate-ccw'" class="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { LAUNCH_STATUSES, categoryLabel, statusLabel } from '~/lib/marketing-launch'

export default {
  name: 'MarketingLaunchDirectory',

  props: {
    item: { type: Object, required: true },
    projectId: { type: String, required: true },
  },

  emits: ['changed', 'forbidden'],

  data() {
    return {
      statuses: LAUNCH_STATUSES,
      editing: false,
      urlDraft: '',
      notesDraft: '',
      saving: false,
      error: null,
    }
  },

  computed: {
    categoryText() {
      return this.item.custom ? 'Custom' : categoryLabel(this.item.category)
    },
    statusText() {
      return statusLabel(this.item.status)
    },
    siteUrl() {
      return this.item.siteUrl
    },
    hasDetails() {
      return Boolean(this.item.notes || (!this.item.custom && this.item.url))
    },
    canReset() {
      return this.item.status !== 'todo' || Boolean(this.item.url || this.item.notes)
    },
    dates() {
      const parts = []
      if (this.item.submittedAt) parts.push(`Submitted ${new Date(this.item.submittedAt).toLocaleDateString()}`)
      if (this.item.liveAt) parts.push(`Live ${new Date(this.item.liveAt).toLocaleDateString()}`)
      return parts.join(' · ')
    },
  },

  watch: {
    projectId() {
      this.editing = false
      this.error = null
    },
  },

  methods: {
    startEdit() {
      this.urlDraft = (this.item.custom ? this.item.siteUrl : this.item.url) || ''
      this.notesDraft = this.item.notes || ''
      this.error = null
      this.editing = true
    },

    cancelEdit() {
      this.editing = false
      this.error = null
    },

    async setStatus(status) {
      if (status === this.item.status) return
      await this.put({ status })
    },

    async save() {
      // Custom items store their directory link in `url`, catalog items their own listing
      const body = {
        status: this.item.status,
        notes: this.notesDraft.trim() || null,
        url: this.urlDraft.trim() || null,
      }
      if (await this.put(body)) this.editing = false
    },

    async put(body) {
      const projectId = this.projectId
      this.saving = true
      this.error = null
      try {
        await $fetch(`/api/marketing/projects/${projectId}/launch-kit/${encodeURIComponent(this.item.id)}`, {
          method: 'PUT',
          body,
        })
        if (projectId !== this.projectId) return false
        this.$emit('changed')
        return true
      } catch (err) {
        if (projectId !== this.projectId) return false
        this.fail(err, 'Could not save')
        return false
      } finally {
        if (projectId === this.projectId) this.saving = false
      }
    },

    async remove() {
      const message = this.item.custom
        ? `Remove ${this.item.name} from your launch kit?`
        : `Reset ${this.item.name}? Its status, listing URL and notes are cleared.`
      if (!window.confirm(message)) return
      const projectId = this.projectId
      this.saving = true
      this.error = null
      try {
        await $fetch(`/api/marketing/projects/${projectId}/launch-kit/${encodeURIComponent(this.item.id)}`, {
          method: 'DELETE',
        })
        if (projectId !== this.projectId) return
        this.$emit('changed')
      } catch (err) {
        if (projectId !== this.projectId) return
        this.fail(err, this.item.custom ? 'Could not remove the directory' : 'Could not reset')
      } finally {
        if (projectId === this.projectId) this.saving = false
      }
    },

    fail(err, fallback) {
      if (apiErrorStatus(err) === 403) this.$emit('forbidden', apiErrorMessage(err, ''))
      this.error = apiErrorMessage(err, fallback)
    },
  },
}
</script>
