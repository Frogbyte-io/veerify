<template>
  <Card>
    <CardContent class="space-y-4 py-10 text-center">
      <div class="space-y-1">
        <p class="font-medium">{{ title }}</p>
        <p v-if="$slots.default" class="mx-auto max-w-md text-sm text-muted-foreground">
          <slot />
        </p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center justify-center gap-2">
        <slot name="actions" />
      </div>
    </CardContent>
  </Card>
</template>

<script>
/** Empty and informational state of the marketing pages (no project, nothing yet, tool off). */
export default {
  name: 'MarketingNotice',

  props: {
    title: { type: String, required: true },
  },
}
</script>
