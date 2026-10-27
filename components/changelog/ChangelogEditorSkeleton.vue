<template>
  <div class="space-y-6" data-testid="changelog-editor-skeleton">
    <!-- Status + action buttons -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Skeleton class="h-6 w-20 rounded-full" />
      <div class="flex items-center gap-2">
        <Skeleton class="h-9 w-24" />
        <Skeleton class="h-9 w-24" />
      </div>
    </div>
    <!-- Title -->
    <div class="space-y-2">
      <Skeleton class="h-4 w-12" />
      <Skeleton class="h-9 w-full" />
    </div>
    <!-- Summary -->
    <div class="space-y-2">
      <Skeleton class="h-4 w-20" />
      <Skeleton class="h-[60px] w-full" />
    </div>
    <!-- Labels -->
    <div class="space-y-2">
      <Skeleton class="h-4 w-14" />
      <div class="flex gap-2">
        <Skeleton v-for="n in 4" :key="n" class="h-7 w-20 rounded-full" />
      </div>
    </div>
    <!-- Body -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <Skeleton class="h-4 w-32" />
        <Skeleton class="h-8 w-24" />
      </div>
      <Skeleton class="h-96 w-full" />
    </div>
  </div>
</template>

<script>
// Shaped like ChangelogEntryEditor's form, shown while the project and the entry load.
export default {
  name: 'ChangelogEditorSkeleton',
}
</script>
