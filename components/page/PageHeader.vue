<template>
  <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="min-w-0">
      <NuxtLink
        v-if="backTo"
        :to="backTo"
        class="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon name="lucide:arrow-left" class="h-4 w-4" />
        {{ backLabel }}
      </NuxtLink>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h1 class="truncate text-3xl font-bold tracking-tight text-foreground">{{ title }}</h1>
        <slot name="title-extra" />
      </div>
      <p v-if="description || $slots.description" class="mt-1 text-sm text-muted-foreground">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <!-- Actions keep a button's height even while hidden or loading, so the header never jumps -->
    <div v-if="$slots.actions" class="flex min-h-9 shrink-0 flex-wrap items-center gap-2 sm:justify-end">
      <slot name="actions" />
    </div>
  </header>
</template>

<script>
/**
 * The heading of every dashboard page: title, optional description, optional back
 * link and a right-aligned actions slot. Render actions from the first paint
 * (disabled while loading) rather than popping them in later.
 */
export default {
  name: 'PageHeader',
  props: {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    backTo: { type: [String, Object], default: null },
    backLabel: { type: String, default: 'Back' },
  },
}
</script>
