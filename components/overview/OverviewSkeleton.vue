<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-2">
      <Skeleton class="h-4 w-20" />
      <div class="overflow-hidden rounded-xl border bg-card">
        <div v-for="n in 3" :key="n" class="flex items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0">
          <Skeleton class="size-[30px] shrink-0 rounded-lg" />
          <div class="flex-1 space-y-1.5">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3 w-1/3" />
          </div>
          <Skeleton class="h-8 w-20 rounded-md" />
        </div>
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <Skeleton class="h-4 w-28" />
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="n in 4" :key="n" class="h-[104px] rounded-xl" />
      </div>
    </div>
    <div v-if="projectsTable" class="flex flex-col gap-2">
      <Skeleton class="h-4 w-20" />
      <Skeleton class="h-40 rounded-xl" />
    </div>
  </div>
</template>

<script>
/** Placeholder shaped like the Overview: needs you, the four numbers and (All projects) the table. */
export default {
  name: 'OverviewSkeleton',
  props: {
    projectsTable: { type: Boolean, default: false },
  },
}
</script>
