<template>
  <Card
    :id="`announcement-${entry.id}`"
    :class="highlighted ? 'ring-2 ring-primary' : ''"
    :data-testid="`announcement-card-${entry.id}`"
  >
    <CardContent class="space-y-4 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold">{{ entry.title }}</h2>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span v-if="entry.publishedAt">Published {{ publishedLabel }}</span>
            <span v-for="label in entry.labels" :key="label" class="rounded bg-muted px-1.5 py-0.5">{{ label }}</span>
          </div>
        </div>
        <Button
          size="sm"
          :variant="hasDrafts ? 'outline' : 'default'"
          :disabled="generating || !hasUsableKey"
          :title="hasUsableKey ? '' : 'Add an Anthropic, OpenAI, Gemini or Perplexity key in Marketing settings first'"
          :data-testid="`announcement-generate-${entry.id}`"
          @click="generate"
        >
          <Icon :name="generating ? 'lucide:loader-circle' : 'lucide:sparkles'" class="mr-2 h-4 w-4" />
          {{ generating ? 'Generating...' : hasDrafts ? 'Regenerate' : 'Generate drafts' }}
        </Button>
      </div>

      <p v-if="generateError" class="text-sm text-destructive" :data-testid="`announcement-generate-error-${entry.id}`">
        {{ generateError }}
      </p>

      <div class="flex flex-wrap gap-1" role="tablist">
        <button
          v-for="channel in channels"
          :key="channel.id"
          type="button"
          role="tab"
          :aria-selected="active === channel.id"
          :class="[
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
            active === channel.id
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground',
          ]"
          :data-testid="`announcement-tab-${entry.id}-${channel.id}`"
          @click="active = channel.id"
        >
          {{ channel.label }}
          <span
            v-if="drafts[channel.id]"
            class="h-1.5 w-1.5 rounded-full bg-current opacity-70"
            :title="drafts[channel.id].edited ? 'Edited draft' : 'Draft'"
          />
        </button>
      </div>

      <div class="space-y-2">
        <Textarea
          :model-value="texts[active]"
          rows="6"
          :aria-label="`${activeLabel} draft for ${entry.title || 'this changelog entry'}`"
          :placeholder="`No ${activeLabel} draft yet. Generate drafts, or write your own here.`"
          :data-testid="`announcement-text-${entry.id}`"
          @update:model-value="onInput"
        />
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p
            :class="['text-xs', overLimit ? 'font-medium text-destructive' : 'text-muted-foreground']"
            :data-testid="`announcement-counter-${entry.id}`"
          >
            {{ texts[active].length }} / {{ limits[active] }}
            <span v-if="overLimit">({{ activeLabel }} would cut this off)</span>
          </p>
          <div class="flex items-center gap-2">
            <span v-if="copied" class="text-xs text-muted-foreground">Copied</span>
            <Button
              variant="outline"
              size="sm"
              :disabled="!texts[active].trim()"
              :data-testid="`announcement-copy-${entry.id}`"
              @click="copy"
            >
              <Icon name="lucide:copy" class="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button
              v-if="drafts[active]"
              variant="outline"
              size="sm"
              :disabled="deleting || saving || generating"
              :data-testid="`announcement-delete-${entry.id}`"
              @click="removeDraft"
            >
              <Icon :name="deleting ? 'lucide:loader-circle' : 'lucide:trash-2'" class="mr-2 h-4 w-4" />
              {{ deleting ? 'Deleting...' : 'Delete' }}
            </Button>
            <Button size="sm" :disabled="!canSave" :data-testid="`announcement-save-${entry.id}`" @click="save">
              <Icon name="lucide:save" class="mr-2 h-4 w-4" />
              {{ saving ? 'Saving...' : 'Save' }}
            </Button>
          </div>
        </div>
        <p v-if="tooLong" class="text-xs text-destructive">
          Shorten this to at most {{ maxLength }} characters to save it.
        </p>
        <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>
      </div>

      <p class="text-xs text-muted-foreground">Veerify never posts for you. Copy a draft and post it yourself.</p>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'

const CHANNELS = [
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'newsletter', label: 'Newsletter' },
]

const EDIT_LIMIT_FACTOR = 1.5

export default {
  name: 'MarketingAnnouncementCard',

  props: {
    projectId: { type: String, required: true },
    entry: { type: Object, required: true },
    limits: { type: Object, required: true },
    hasUsableKey: { type: Boolean, default: false },
    highlighted: { type: Boolean, default: false },
  },

  data() {
    return {
      channels: CHANNELS,
      active: 'x',
      drafts: this.indexDrafts(this.entry.drafts),
      texts: this.textsFrom(this.indexDrafts(this.entry.drafts)),
      generating: false,
      generateError: null,
      saving: false,
      saveError: null,
      deleting: false,
      copied: false,
      copyTimer: null,
    }
  },

  computed: {
    activeLabel() {
      return CHANNELS.find((c) => c.id === this.active).label
    },
    hasDrafts() {
      return Object.keys(this.drafts).length > 0
    },
    overLimit() {
      return this.texts[this.active].length > this.limits[this.active]
    },
    maxLength() {
      return Math.floor(this.limits[this.active] * EDIT_LIMIT_FACTOR)
    },
    tooLong() {
      return this.texts[this.active].trim().length > this.maxLength
    },
    dirty() {
      return this.texts[this.active] !== (this.drafts[this.active]?.content ?? '')
    },
    canSave() {
      return !this.saving && !this.generating && this.dirty && Boolean(this.texts[this.active].trim()) && !this.tooLong
    },
    publishedLabel() {
      return new Date(this.entry.publishedAt).toLocaleDateString()
    },
  },

  beforeUnmount() {
    if (this.copyTimer) clearTimeout(this.copyTimer)
  },

  methods: {
    indexDrafts(list) {
      return Object.fromEntries((list || []).map((d) => [d.channel, d]))
    },

    textsFrom(drafts) {
      return Object.fromEntries(CHANNELS.map((c) => [c.id, drafts[c.id]?.content ?? '']))
    },

    base() {
      return `/api/marketing/projects/${this.projectId}/announcements/${this.entry.id}`
    },

    onInput(value) {
      this.texts[this.active] = String(value ?? '')
      this.saveError = null
    },

    hasUnsavedOrEdited() {
      return (
        Object.values(this.drafts).some((d) => d.edited) ||
        CHANNELS.some((c) => this.texts[c.id] !== (this.drafts[c.id]?.content ?? ''))
      )
    },

    async generate() {
      if (this.hasUnsavedOrEdited()) {
        if (!window.confirm('Regenerating replaces your edited and unsaved drafts. Continue?')) return
      }
      const projectId = this.projectId
      this.generating = true
      this.generateError = null
      try {
        const response = await $fetch(`${this.base()}/generate`, { method: 'POST', body: {} })
        if (projectId !== this.projectId) return
        for (const draft of response.data.drafts) {
          this.drafts[draft.channel] = draft
          this.texts[draft.channel] = draft.content
        }
      } catch (err) {
        if (projectId !== this.projectId) return
        this.generateError = apiErrorMessage(err, 'Could not generate drafts')
      } finally {
        if (projectId === this.projectId) this.generating = false
      }
    },

    async save() {
      const channel = this.active
      const projectId = this.projectId
      this.saving = true
      this.saveError = null
      try {
        const response = await $fetch(`${this.base()}/${channel}`, {
          method: 'PUT',
          body: { content: this.texts[channel] },
        })
        if (projectId !== this.projectId) return
        this.drafts[channel] = response.data.draft
        this.texts[channel] = response.data.draft.content
      } catch (err) {
        if (projectId !== this.projectId) return
        this.saveError = apiErrorMessage(err, 'Could not save the draft')
      } finally {
        if (projectId === this.projectId) this.saving = false
      }
    },

    async removeDraft() {
      const channel = this.active
      if (!this.drafts[channel]) return
      if (!window.confirm(`Delete the ${this.activeLabel} draft? This cannot be undone.`)) return
      const projectId = this.projectId
      this.deleting = true
      this.saveError = null
      try {
        await $fetch(`${this.base()}/${channel}`, { method: 'DELETE' })
        if (projectId !== this.projectId) return
        const { [channel]: _removed, ...rest } = this.drafts
        this.drafts = rest
        this.texts[channel] = ''
      } catch (err) {
        if (projectId !== this.projectId) return
        this.saveError = apiErrorMessage(err, 'Could not delete the draft')
      } finally {
        if (projectId === this.projectId) this.deleting = false
      }
    },

    async copy() {
      try {
        await navigator.clipboard.writeText(this.texts[this.active])
        this.copied = true
        if (this.copyTimer) clearTimeout(this.copyTimer)
        this.copyTimer = setTimeout(() => {
          this.copied = false
        }, 1500)
      } catch {
        this.saveError = 'Could not copy to the clipboard'
      }
    },
  },
}
</script>
