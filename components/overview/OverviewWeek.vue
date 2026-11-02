<template>
  <section class="flex flex-col gap-2" data-testid="overview-week">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h2 class="text-sm font-semibold">Last 7 days</h2>
      <p class="text-xs text-muted-foreground" :title="previousTitle">{{ rangeLabel }}</p>
      <span class="flex-1" />
      <div v-if="showSplit" class="flex flex-wrap gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
        <span v-for="project in projectsInView" :key="project.id" class="inline-flex items-center gap-1.5">
          <ProjectBadge :project="project" size="xs" />
          {{ project.name }}
        </span>
      </div>
    </div>
    <div :class="cn('grid grid-cols-1 gap-2.5 sm:grid-cols-2', columnsClass)">
      <div
        v-for="tile in tiles"
        :key="tile.key"
        class="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-3.5 py-3"
        :data-testid="`overview-tile-${tile.key}`"
      >
        <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon :name="tile.icon" class="h-3 w-3" />
          {{ tile.label }}
        </span>
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="text-2xl font-semibold tabular-nums tracking-tight" :data-testid="`overview-value-${tile.key}`">
            {{ tile.value }}
          </span>
          <span v-if="tile.delta.text" :class="cn('whitespace-nowrap text-[11.5px]', deltaClass(tile.delta.tone))">
            <template v-if="tile.delta.arrow">{{ tile.delta.arrow }}&nbsp;</template>{{ tile.delta.text }}
          </span>
        </div>
        <div
          v-if="showSplit && tile.split.length > 0"
          class="mt-0.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full"
          :title="tile.splitTitle"
          :data-testid="`overview-split-${tile.key}`"
        >
          <i
            v-for="part in tile.split"
            :key="part.id"
            class="block h-full"
            :style="{ flex: part.value, backgroundColor: part.color }"
          />
        </div>
        <span class="truncate text-[11.5px] text-muted-foreground">{{ tile.footer }}</span>
      </div>
    </div>
  </section>
</template>

<script>
import { cn } from '~/lib/utils'
import { formatDelta, formatMinutes, formatWeekRange } from '~/lib/overview'
import { PROJECT_PALETTE } from '~/lib/project-identity'

const COLUMNS = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }
const DELTA_TONES = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-destructive',
  neutral: 'text-muted-foreground',
}

/**
 * The "Last 7 days" numbers of the Overview: label, value, comparison with the previous 7 days of
 * the same projects, and (with 2+ projects in view) a thin bar splitting the count by project.
 * Only reply time is coloured: faster is good. `week` is `OverviewResponse['week']`.
 */
export default {
  name: 'OverviewWeek',
  props: {
    week: { type: Object, required: true },
    /** ScopeProject[] in view, in the order of the split bars */
    projectsInView: { type: Array, default: () => [] },
  },
  computed: {
    showSplit() {
      return this.projectsInView.length > 1
    },
    rangeLabel() {
      return formatWeekRange(this.week.from)
    },
    previousTitle() {
      const from = new Date(this.week.previousFrom).toLocaleString()
      const to = new Date(this.week.from).toLocaleString()
      return `Compared with ${from} – ${to}`
    },
    tiles() {
      const week = this.week
      const tiles = []
      if (week.received.available) {
        tiles.push(
          this.volumeTile(
            'received',
            'lucide:inbox',
            'Conversations received',
            week.received,
            'New emails and chats in the inbox'
          )
        )
      }
      if (week.firstReply.available) {
        const reply = week.firstReply
        const slowest = reply.slowest && Object.values(reply.byProject).filter((m) => m !== null).length > 1
        tiles.push({
          key: 'first-reply',
          icon: 'lucide:timer',
          label: 'Median first reply',
          value: formatMinutes(reply.current),
          delta: formatDelta(reply.current, reply.previous, true),
          split: [],
          splitTitle: '',
          footer: slowest
            ? `Slowest: ${reply.slowest.project.name}, ${formatMinutes(reply.slowest.minutes)}`
            : 'From first message to our first reply',
        })
      }
      if (week.posts.available) {
        tiles.push(
          this.volumeTile('posts', 'lucide:message-square', 'New feedback posts', week.posts, 'Posted on your boards')
        )
      }
      if (week.votes.available) {
        tiles.push(this.volumeTile('votes', 'lucide:chevron-up', 'Votes', week.votes, 'On any feedback post'))
      }
      return tiles
    },
    columnsClass() {
      return COLUMNS[Math.min(Math.max(this.tiles.length, 1), 4)]
    },
  },
  methods: {
    cn,
    deltaClass(tone) {
      return DELTA_TONES[tone] || DELTA_TONES.neutral
    },
    volumeTile(key, icon, label, metric, footer) {
      const parts = this.projectsInView.map((project) => ({
        id: project.id,
        name: project.name,
        value: metric.byProject[project.id] || 0,
        color: project.identity?.color || PROJECT_PALETTE[0],
      }))
      return {
        key,
        icon,
        label,
        value: metric.current,
        delta: formatDelta(metric.current, metric.previous),
        split: parts.filter((part) => part.value > 0),
        splitTitle: parts.map((part) => `${part.name}: ${part.value}`).join(' · '),
        footer,
      }
    },
  },
}
</script>
