<template>
  <section class="flex flex-col gap-2" data-testid="overview-projects">
    <div class="flex flex-wrap items-baseline gap-2">
      <h2 class="text-sm font-semibold">Projects</h2>
      <p class="text-xs text-muted-foreground">Click a project to switch to it.</p>
    </div>
    <div class="overflow-hidden rounded-xl border bg-card">
      <div :class="cn(rowClass, 'bg-background py-1.5 text-[11px] leading-tight text-muted-foreground')">
        <span>Project</span>
        <span>Waiting for reply</span>
        <span>SLA at risk</span>
        <span class="hidden lg:block">New feedback <span class="block">7 days</span></span>
        <span class="hidden lg:block">Votes <span class="block">7 days</span></span>
        <span class="hidden lg:block">Last release</span>
        <span />
      </div>
      <button
        v-for="row in viewRows"
        :key="row.project.id"
        type="button"
        :class="
          cn(rowClass, 'group w-full cursor-pointer border-t text-left text-sm transition-colors hover:bg-accent')
        "
        :data-testid="`overview-project-row-${row.project.id}`"
        @click="$emit('select', row.project.id)"
      >
        <span class="flex min-w-0 items-center gap-2 font-semibold">
          <ProjectBadge :project="row.scopeProject" size="sm" />
          <span class="truncate">{{ row.project.name }}</span>
        </span>
        <template v-if="row.inboxCell">
          <span class="text-muted-foreground" :data-testid="`overview-project-inbox-${row.project.id}`">
            {{ row.inboxCell }}
          </span>
          <span class="text-muted-foreground">–</span>
        </template>
        <template v-else>
          <span :class="row.waiting ? '' : 'text-muted-foreground'">{{ row.waiting }}</span>
          <span :class="row.slaAtRisk ? 'font-semibold text-destructive' : 'text-muted-foreground'">
            {{ row.slaAtRisk }}
          </span>
        </template>
        <span v-if="row.tools.feedback" :class="cn('hidden lg:block', row.newFeedback ? '' : 'text-muted-foreground')">
          {{ row.newFeedback }}
        </span>
        <span v-else class="hidden text-muted-foreground lg:block">Feedback off</span>
        <span v-if="row.tools.feedback" :class="cn('hidden lg:block', row.votes ? '' : 'text-muted-foreground')">
          {{ row.votes }}
        </span>
        <span v-else class="hidden text-muted-foreground lg:block">–</span>
        <span class="hidden min-w-0 truncate lg:block">
          <template v-if="!row.tools.changelog"><span class="text-muted-foreground">Changelog off</span></template>
          <template v-else-if="row.lastRelease">
            {{ formatDate(row.lastRelease.publishedAt) }}
            <span class="text-muted-foreground">· {{ row.lastRelease.title }}</span>
          </template>
          <span v-else class="text-muted-foreground">None yet</span>
        </span>
        <Icon
          name="lucide:arrow-right"
          class="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    </div>
  </section>
</template>

<script>
import { cn } from '~/lib/utils'
import { findScopeProject } from '~/lib/project-scope'

/**
 * The Projects table of the Overview (All projects, 2+ projects in view): one row per project with
 * labelled columns. Problems are red, zeros are grey and a tool that is off is said in words.
 * `rows` is `OverviewResponse['projects']`; `select` fires with the project id.
 */
export default {
  name: 'OverviewProjectsTable',
  props: {
    rows: { type: Array, required: true },
    /** ScopeProject[] from the active project context, for the project badges. */
    projects: { type: Array, default: () => [] },
  },
  emits: ['select'],
  computed: {
    viewRows() {
      return this.rows.map((row) => ({
        ...row,
        scopeProject: this.scopeProject(row.project),
        // Said in words: a number would read as "nothing waiting"
        inboxCell: !row.tools.inbox ? 'Inbox off' : !row.inboxAccess ? 'No inbox access' : '',
      }))
    },
    rowClass() {
      return 'grid items-center gap-2 px-3.5 py-2.5 tabular-nums grid-cols-[minmax(120px,1.4fr)_repeat(2,minmax(56px,1fr))_24px] lg:grid-cols-[minmax(150px,1.4fr)_repeat(4,minmax(70px,1fr))_minmax(110px,1.1fr)_24px]'
    },
  },
  methods: {
    cn,
    scopeProject(ref) {
      return findScopeProject({ projects: this.projects }, ref.id) || ref
    },
    formatDate(value) {
      return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    },
  },
}
</script>
