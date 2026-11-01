<template>
  <span class="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="project-tag">
    <ProjectBadge :project="project" size="xs" />
    <span class="truncate font-medium text-foreground">{{ project.name }}</span>
    <span v-if="suffix" class="truncate">/ {{ suffix }}</span>
  </span>
</template>

<script>
/** A project's badge and name, used on rows in All projects. */
export default {
  name: 'ProjectTag',
  props: {
    project: { type: Object, required: true },
    /** e.g. the product name, shown as "Project / suffix". */
    suffix: { type: String, default: '' },
  },
}
</script>
