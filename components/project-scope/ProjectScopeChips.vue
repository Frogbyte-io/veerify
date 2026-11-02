<template>
  <div class="flex flex-wrap items-center gap-1.5" data-testid="project-scope-chips">
    <button
      type="button"
      data-testid="project-scope-chip-all"
      :class="chipClass(selected.length === 0)"
      :aria-pressed="selected.length === 0"
      @click="clear"
    >
      <ProjectBadgeStack :projects="projects" />
      <span>All projects</span>
      <span v-if="counts" class="tabular-nums opacity-70">{{ totalCount }}</span>
    </button>
    <template v-for="project in selectable" :key="project.id">
      <button
        type="button"
        :data-testid="`project-scope-chip-${project.id}`"
        :class="chipClass(selected.includes(project.id))"
        :style="selected.includes(project.id) ? { borderColor: project.identity?.color } : undefined"
        :aria-pressed="selected.includes(project.id)"
        @click="toggle(project.id)"
      >
        <ProjectBadge :project="project" size="xs" />
        <span>{{ project.name }}</span>
        <span v-if="counts" class="tabular-nums opacity-70">{{ counts[project.id] ?? 0 }}</span>
      </button>
    </template>
    <span
      v-if="unavailable.length > 0"
      class="px-1 text-xs text-muted-foreground"
      :title="`${moduleLabel} is off in ${unavailable.map((p) => p.name).join(', ')}`"
      data-testid="project-scope-chip-unavailable"
    >
      {{ unavailableLabel }}
    </span>
    <button
      v-if="selected.length > 0"
      type="button"
      class="px-1 text-xs text-muted-foreground hover:text-foreground"
      data-testid="project-scope-chip-clear"
      @click="clear"
    >
      Clear
    </button>
  </div>
</template>

<script>
import { cn } from '~/lib/utils'
import { MODULES } from '~/lib/modules'
import {
  parseProjectFilter,
  projectFilterParam,
  readRememberedProjectFilter,
  rememberProjectFilter,
} from '~/lib/project-scope'

/**
 * Project filter chips for All projects. `v-model` is the selected project ids (empty = every
 * project). The selection is mirrored to `?projects=` and remembered per `page`, and restored from
 * there on mount (URL first). Projects without `module` switched on are left out and summed up
 * in one hint ("2 projects without Inbox"; hover lists them).
 */

export default {
  name: 'ProjectScopeChips',
  props: {
    modelValue: { type: Array, default: () => [] },
    /** Every project in the scope (ScopeProject[] from the active project context). */
    projects: { type: Array, default: () => [] },
    /** Key used to remember the selection, e.g. 'inbox'. */
    page: { type: String, required: true },
    /** Tool the page needs (lib/modules.ts key); projects without it can't be picked. */
    module: { type: String, default: null },
    /** Optional count per project id, shown on each chip. */
    counts: { type: Object, default: null },
  },
  emits: ['update:modelValue'],
  computed: {
    selected() {
      return this.modelValue.filter((id) => this.selectable.some((p) => p.id === id))
    },
    selectable() {
      return this.projects.filter((p) => this.hasModule(p))
    },
    // Projects without the tool are summed up in one hint instead of a greyed chip each.
    unavailable() {
      return this.projects.filter((p) => !this.hasModule(p))
    },
    unavailableLabel() {
      const list = this.unavailable
      if (list.length === 1) return `${this.moduleLabel} is off in ${list[0].name}`
      return `${list.length} projects without ${this.moduleLabel}`
    },
    organizationId() {
      return this.projects[0]?.organizationId
    },
    moduleLabel() {
      return MODULES.find((m) => m.key === this.module)?.label || 'This tool'
    },
    totalCount() {
      if (!this.counts) return 0
      return this.selectable.reduce((sum, p) => sum + (Number(this.counts[p.id]) || 0), 0)
    },
  },
  watch: {
    projects() {
      // Drop ids that left the scope (project deleted or access removed).
      if (this.selected.length !== this.modelValue.length) this.commit(this.selected)
    },
  },
  mounted() {
    const valid = (ids) => ids.filter((id) => this.selectable.some((p) => p.id === id))
    const fromUrl = valid(parseProjectFilter(this.$route.query.projects))
    const initial = fromUrl.length > 0 ? fromUrl : valid(readRememberedProjectFilter(this.page, this.organizationId))
    const current = this.modelValue.join(',')
    if (initial.join(',') !== current) this.commit(initial)
    else this.syncUrl(initial)
  },
  methods: {
    hasModule(project) {
      return !this.module || Boolean(project.modules?.[this.module])
    },
    chipClass(on) {
      return cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
        on ? 'bg-accent text-foreground border-primary/50' : 'text-muted-foreground hover:border-muted-foreground'
      )
    },
    toggle(id) {
      const next = this.selected.includes(id) ? this.selected.filter((x) => x !== id) : [...this.selected, id]
      // Picking every project is the same as All projects.
      this.commit(next.length === this.selectable.length ? [] : next)
    },
    clear() {
      this.commit([])
    },
    commit(ids) {
      rememberProjectFilter(this.page, this.organizationId, ids)
      this.syncUrl(ids)
      this.$emit('update:modelValue', ids)
    },
    syncUrl(ids) {
      const value = projectFilterParam(ids)
      if ((this.$route.query.projects || undefined) === value) return
      const query = { ...this.$route.query }
      if (value) query.projects = value
      else delete query.projects
      this.$router.replace({ query })
    },
  },
}
</script>
