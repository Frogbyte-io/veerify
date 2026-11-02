<template>
  <section class="flex flex-col gap-2" data-testid="overview-needs-you">
    <div class="flex flex-wrap items-baseline gap-2">
      <h2 class="text-sm font-semibold">Needs you</h2>
      <p v-if="subtitle" class="text-xs text-muted-foreground">{{ subtitle }}</p>
    </div>
    <div class="overflow-hidden rounded-xl border bg-card">
      <div
        v-if="todos.length === 0"
        class="px-4 py-6 text-center text-muted-foreground"
        data-testid="overview-caught-up"
      >
        <Icon name="lucide:circle-check" class="mx-auto mb-1.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <p class="text-sm">You're all caught up.</p>
      </div>
      <ul v-else class="divide-y">
        <li
          v-for="todo in todos"
          :key="todo.key"
          class="flex items-center gap-3 px-3.5 py-2.5"
          :data-testid="`overview-todo-${todo.key}`"
        >
          <span :class="cn('grid size-[30px] shrink-0 place-items-center rounded-lg', toneClass(todo.tone))">
            <Icon :name="todo.icon" class="h-4 w-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{{ todo.title }}</p>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <ProjectTag v-if="todo.project && allProjects" :project="withIdentity(todo.project)" />
              <span v-if="todo.lead">{{ todo.lead }}</span>
              <span v-if="todo.quote" class="max-w-[18rem] truncate text-foreground">“{{ todo.quote }}”</span>
              <span v-if="todo.detail">{{ todo.detail }}</span>
              <template v-if="todo.breakdown && todo.breakdown.length > 0">
                <span
                  v-for="entry in todo.breakdown"
                  :key="entry.project.id"
                  class="inline-flex items-center gap-1"
                  :data-testid="`overview-breakdown-${entry.project.id}`"
                >
                  <span class="tabular-nums text-foreground">{{ entry.count }}</span>
                  <span>in</span>
                  <ProjectTag :project="withIdentity(entry.project)" />
                </span>
              </template>
            </div>
          </div>
          <Button
            size="sm"
            :variant="todo.primary ? 'default' : 'outline'"
            :disabled="busyKey === todo.key"
            :data-testid="`overview-action-${todo.key}`"
            @click="$emit('action', todo)"
          >
            {{ todo.action.label }}
          </Button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script>
import { cn } from '~/lib/utils'
import { findScopeProject } from '~/lib/project-scope'

const TONES = {
  urgent: 'bg-destructive/15 text-destructive',
  inbox: 'bg-primary/15 text-primary',
  feedback: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  changelog: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
}

/**
 * "Needs you" on the Overview: one sentence per thing that needs a person, each with one button.
 * `todos` come from `buildTodos` (lib/overview.ts); the page handles `action`.
 */
export default {
  name: 'OverviewNeedsYou',
  props: {
    todos: { type: Array, required: true },
    /** ScopeProject[] from the active project context, for the project badges. */
    projects: { type: Array, default: () => [] },
    /** Tag rows with their project (All projects only). */
    allProjects: { type: Boolean, default: false },
    busyKey: { type: String, default: '' },
  },
  emits: ['action'],
  computed: {
    subtitle() {
      if (this.todos.length === 0) return ''
      return this.todos.length === 1 ? '1 thing' : `${this.todos.length} things, most urgent first`
    },
  },
  methods: {
    cn,
    toneClass(tone) {
      return TONES[tone] || TONES.inbox
    },
    withIdentity(ref) {
      return findScopeProject({ projects: this.projects }, ref.id) || ref
    },
  },
}
</script>
