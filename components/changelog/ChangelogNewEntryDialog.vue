<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New changelog entry</DialogTitle>
        <DialogDescription>You're in All projects, so pick the project this entry belongs to.</DialogDescription>
      </DialogHeader>

      <div class="space-y-2">
        <Label>Project</Label>
        <div
          class="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="Project"
          data-testid="changelog-new-entry-projects"
        >
          <button
            v-for="project in projects"
            :key="project.id"
            type="button"
            role="radio"
            :aria-checked="selectedId === project.id"
            :data-testid="`changelog-new-entry-project-${project.slug}`"
            :class="optionClass(selectedId === project.id)"
            @click="selectedId = project.id"
          >
            <ProjectBadge :project="project" size="xs" />
            {{ project.name }}
          </button>
        </div>
        <p class="flex items-center gap-1 text-xs text-muted-foreground">
          <Icon name="lucide:history" class="w-3 h-3" />
          Defaults to the last project you used
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="$emit('update:open', false)">Cancel</Button>
        <Button :disabled="!selected" data-testid="changelog-new-entry-continue" @click="$emit('create', selected.id)">
          {{ selected ? `Create in ${selected.name}` : 'Create' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { cn } from '~/lib/utils'
import { pickNewEntryProject, readLastChangelogProject } from '~/lib/changelog-combined'

/**
 * Asks which project a new changelog entry goes to (All projects). Defaults to the last project used in
 * this workspace, then the active (last single) project. Emits `create` with the project id.
 */
export default {
  name: 'ChangelogNewEntryDialog',
  props: {
    open: { type: Boolean, default: false },
    /** Projects with the changelog on (ScopeProject[]). */
    projects: { type: Array, default: () => [] },
    activeProjectId: { type: String, default: '' },
    organizationId: { type: String, default: '' },
  },
  emits: ['update:open', 'create'],
  data() {
    return { selectedId: '' }
  },
  computed: {
    selected() {
      return this.projects.find((p) => p.id === this.selectedId) || null
    },
  },
  watch: {
    open: {
      immediate: true,
      handler(open) {
        if (!open) return
        const last = readLastChangelogProject(this.organizationId)
        this.selectedId = pickNewEntryProject(this.projects, last, this.activeProjectId)?.id || ''
      },
    },
  },
  methods: {
    optionClass(on) {
      return cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
        on ? 'bg-accent border-primary/50 text-foreground' : 'text-muted-foreground hover:border-muted-foreground'
      )
    },
  },
}
</script>
