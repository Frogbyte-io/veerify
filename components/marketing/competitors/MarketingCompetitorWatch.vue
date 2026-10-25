<template>
  <Card :data-testid="`competitor-card-${competitor.id}`">
    <CardHeader class="pb-3">
      <CardTitle role="heading" aria-level="2" class="flex flex-wrap items-center gap-2 text-lg">
        {{ competitor.label }}
        <span v-if="competitor.competitorDomain" class="text-sm font-normal text-muted-foreground">
          {{ competitor.competitorDomain }}
        </span>
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <p v-if="!competitor.watches.length" class="text-sm text-muted-foreground">No pages watched yet.</p>

      <ul v-else class="divide-y divide-border rounded-md border border-border">
        <li
          v-for="watch in competitor.watches"
          :key="watch.id"
          class="space-y-2 px-3 py-3"
          :data-testid="`competitor-watch-${watch.id}`"
        >
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="outline" class="shadow-none">{{ kindLabel(watch.kind) }}</Badge>
            <a
              :href="watch.url"
              target="_blank"
              rel="noopener noreferrer"
              class="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
              >{{ watch.url }}</a
            >
            <Badge :variant="statusVariant(watch.status)" class="shadow-none">{{ statusLabel(watch.status) }}</Badge>
          </div>

          <p
            v-if="watch.status === 'blocked_by_robots'"
            class="text-xs text-muted-foreground"
            data-testid="competitor-blocked-note"
          >
            This site's robots.txt does not allow VeerifyBot to fetch this page, so Veerify never requests it. If the
            site changes its robots.txt, use Check now to try again.
          </p>
          <p v-else-if="watch.status === 'error'" class="text-xs text-destructive">
            Paused after repeated failures{{ watch.lastError ? `: ${watch.lastError}` : '' }}. Resume to try again.
          </p>
          <p v-else-if="watch.lastError" class="text-xs text-muted-foreground">
            Last check failed: {{ watch.lastError }}
          </p>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>Checked: {{ formatDate(watch.lastCheckedAt, 'not yet') }}</span>
            <span>Changed: {{ formatDate(watch.lastChangedAt, 'no change seen') }}</span>
            <div v-if="canManage" class="ml-auto flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                :disabled="isBusy(watch.id)"
                :data-testid="`competitor-check-${watch.id}`"
                @click="checkNow(watch)"
              >
                <Icon name="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
                {{ busy[watch.id] === 'check' ? 'Checking...' : 'Check now' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="isBusy(watch.id)"
                :data-testid="`competitor-toggle-${watch.id}`"
                @click="toggle(watch)"
              >
                <Icon :name="isResume(watch) ? 'lucide:play' : 'lucide:pause'" class="mr-1.5 h-3.5 w-3.5" />
                {{ isResume(watch) ? 'Resume' : 'Pause' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="isBusy(watch.id)"
                :data-testid="`competitor-delete-${watch.id}`"
                @click="remove(watch)"
              >
                <Icon name="lucide:trash-2" class="mr-1.5 h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
          <p v-if="rowErrors[watch.id]" class="text-xs text-destructive">{{ rowErrors[watch.id] }}</p>
          <p v-else-if="rowNotes[watch.id]" class="text-xs text-muted-foreground">{{ rowNotes[watch.id] }}</p>
        </li>
      </ul>

      <form
        v-if="canManage"
        class="space-y-2 border-t border-border pt-4"
        :data-testid="`competitor-add-form-${competitor.id}`"
        @submit.prevent="addPage"
      >
        <p class="text-sm font-medium">Add page</p>
        <div v-if="atLimit" class="text-sm text-muted-foreground">
          {{ limitMessage }}
        </div>
        <div v-else class="flex flex-wrap items-start gap-2">
          <Input
            v-model="url"
            type="url"
            class="min-w-64 flex-1"
            :placeholder="`https://${competitor.competitorDomain || 'rival.com'}/pricing`"
            aria-label="Page URL"
          />
          <select
            v-model="kind"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Page type"
          >
            <option v-for="option in kinds" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <Button type="submit" :disabled="adding || !url.trim()">
            {{ adding ? 'Adding...' : 'Add page' }}
          </Button>
        </div>
        <p v-if="addError" class="text-sm text-destructive" data-testid="competitor-add-error">{{ addError }}</p>
      </form>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'

const KINDS = [
  { value: 'pricing', label: 'Pricing' },
  { value: 'changelog', label: 'Changelog' },
  { value: 'homepage', label: 'Homepage' },
  { value: 'other', label: 'Other' },
]

const STATUS_LABELS = {
  active: 'Watching',
  paused: 'Paused',
  error: 'Error',
  blocked_by_robots: 'Blocked by robots.txt',
}

const OUTCOME_NOTES = {
  baseline: 'Baseline saved. Changes are reported from the next check.',
  changed: 'A change was found.',
  unchanged: 'No change.',
  noise: 'Only a tiny change, not reported.',
  blocked: 'Blocked by robots.txt.',
  error: 'The check failed.',
}

export default {
  name: 'MarketingCompetitorWatch',

  props: {
    projectId: { type: String, required: true },
    competitor: { type: Object, required: true },
    canManage: { type: Boolean, default: false },
    siteWatchCount: { type: Number, default: 0 },
    limits: { type: Object, default: () => ({ perCompetitor: 3, perSite: 15 }) },
  },

  emits: ['changed'],

  data() {
    return {
      url: '',
      kind: 'pricing',
      adding: false,
      addError: null,
      busy: {},
      rowErrors: {},
      rowNotes: {},
      kinds: KINDS,
    }
  },

  computed: {
    atLimit() {
      return this.competitor.watches.length >= this.limits.perCompetitor || this.siteWatchCount >= this.limits.perSite
    },
    limitMessage() {
      return this.competitor.watches.length >= this.limits.perCompetitor
        ? `At most ${this.limits.perCompetitor} pages per competitor. Delete one to add another.`
        : `At most ${this.limits.perSite} watched pages per project. Delete one to add another.`
    },
  },

  methods: {
    base() {
      return `/api/marketing/projects/${this.projectId}/competitors/watches`
    },
    kindLabel(value) {
      return KINDS.find((k) => k.value === value)?.label || value
    },
    statusLabel(value) {
      return STATUS_LABELS[value] || value
    },
    statusVariant(value) {
      if (value === 'active') return 'default'
      if (value === 'error') return 'destructive'
      return 'secondary'
    },
    formatDate(value, empty) {
      return value ? new Date(value).toLocaleString() : empty
    },
    isBusy(id) {
      return Boolean(this.busy[id])
    },

    async run(watch, action, fn, fallback) {
      this.busy = { ...this.busy, [watch.id]: action }
      this.rowErrors = { ...this.rowErrors, [watch.id]: null }
      this.rowNotes = { ...this.rowNotes, [watch.id]: null }
      try {
        await fn()
      } catch (err) {
        this.rowErrors = { ...this.rowErrors, [watch.id]: apiErrorMessage(err, fallback) }
      } finally {
        this.busy = { ...this.busy, [watch.id]: null }
      }
    },

    async toggle(watch) {
      const status = this.isResume(watch) ? 'active' : 'paused'
      await this.run(
        watch,
        'toggle',
        async () => {
          await $fetch(`${this.base()}/${watch.id}`, { method: 'PATCH', body: { status } })
          this.$emit('changed')
        },
        'Could not update the page'
      )
    },

    isResume(watch) {
      return watch.status === 'paused' || watch.status === 'error'
    },

    async remove(watch) {
      if (!window.confirm(`Delete the watched page ${watch.url}? Its change history is removed too.`)) return
      await this.run(
        watch,
        'delete',
        async () => {
          await $fetch(`${this.base()}/${watch.id}`, { method: 'DELETE' })
          this.$emit('changed')
        },
        'Could not delete the page'
      )
    },

    async checkNow(watch) {
      await this.run(
        watch,
        'check',
        async () => {
          const response = await $fetch(`${this.base()}/${watch.id}/check`, { method: 'POST' })
          this.rowNotes = { ...this.rowNotes, [watch.id]: OUTCOME_NOTES[response.data.outcome] || 'Checked.' }
          this.$emit('changed')
        },
        'Could not check the page'
      )
    },

    async addPage() {
      this.adding = true
      this.addError = null
      try {
        await $fetch(this.base(), {
          method: 'POST',
          body: { termId: this.competitor.id, url: this.url.trim(), kind: this.kind },
        })
        this.url = ''
        this.$emit('changed')
      } catch (err) {
        this.addError = apiErrorMessage(err, 'Could not add the page')
      } finally {
        this.adding = false
      }
    },
  },
}
</script>
