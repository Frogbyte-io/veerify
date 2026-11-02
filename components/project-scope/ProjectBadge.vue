<template>
  <span
    :class="
      cn('inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold leading-none', sizeClass)
    "
    :style="logoUrl ? undefined : { backgroundColor: color, color: foreground }"
    :title="title || undefined"
    data-testid="project-badge"
  >
    <img v-if="logoUrl" :src="logoUrl" :alt="''" class="size-full object-cover" />
    <span v-else>{{ initials }}</span>
  </span>
</template>

<script>
import { cn } from '~/lib/utils'
import { projectForegroundColor, projectInitials, PROJECT_PALETTE } from '~/lib/project-identity'

const SIZES = {
  xs: 'size-3.5 rounded-[4px] text-[8px]',
  sm: 'size-[18px] rounded-[5px] text-[9px] tracking-tight',
  md: 'size-6 rounded-md text-[11px]',
  lg: 'size-8 rounded-lg text-[13px]',
}

/** A project's colour square with its initials (or logo). See lib/project-identity.ts. */
export default {
  name: 'ProjectBadge',
  props: {
    /** Anything with `name` and `identity` ({ color, initials, logoUrl }). */
    project: { type: Object, required: true },
    size: { type: String, default: 'sm' },
    /** Show only the first initial (fits the xs size). */
    single: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  computed: {
    identity() {
      return this.project?.identity || null
    },
    color() {
      return this.identity?.color || PROJECT_PALETTE[0]
    },
    foreground() {
      return projectForegroundColor(this.color)
    },
    logoUrl() {
      return this.identity?.logoUrl || null
    },
    initials() {
      const value = this.identity?.initials || projectInitials(this.project?.name || '')
      return this.single || this.size === 'xs' ? (Array.from(value)[0] ?? '') : value
    },
    sizeClass() {
      return SIZES[this.size] || SIZES.sm
    },
  },
  methods: { cn },
}
</script>
