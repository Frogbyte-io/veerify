<template>
  <span :class="cn('relative inline-grid shrink-0 grid-cols-2 gap-[2px]', size === 'lg' ? 'size-8' : 'size-[18px]')">
    <i
      v-for="(project, index) in shown"
      :key="index"
      :class="size === 'lg' ? 'rounded-[4px]' : 'rounded-[2px]'"
      :style="{ backgroundColor: project.identity?.color || '#888' }"
    />
  </span>
</template>

<script>
import { cn } from '~/lib/utils'

/** Up to four project colours in a 2×2 grid: the mark for All projects. */
export default {
  name: 'ProjectBadgeStack',
  props: {
    projects: { type: Array, default: () => [] },
    size: { type: String, default: 'sm' },
  },
  computed: {
    shown() {
      const list = this.projects.slice(0, 4)
      // Repeat colours so the grid is always full.
      while (list.length > 0 && list.length < 4) list.push(list[list.length % Math.max(1, this.projects.length)])
      return list
    },
  },
  methods: { cn },
}
</script>
