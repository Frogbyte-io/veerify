<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-12">
    <div class="w-full" :class="wide ? 'max-w-lg' : 'max-w-sm'">
      <div class="flex flex-col gap-6">
        <!-- Brand -->
        <div class="flex flex-col items-center gap-2">
          <div class="flex items-center gap-2.5">
            <div class="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
              <Icon name="lucide:check-check" class="h-5 w-5 text-primary-foreground" />
            </div>
            <span class="text-2xl font-display font-semibold tracking-tight">Veerify</span>
          </div>
        </div>

        <Card>
          <CardHeader class="text-center">
            <CardTitle class="text-xl font-semibold">{{ title }}</CardTitle>
            <CardDescription v-if="description">{{ description }}</CardDescription>
          </CardHeader>
          <CardContent>
            <slot />
          </CardContent>
        </Card>

        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script>
/**
 * Shared frame for the centred, clean-layout cards: brand header, title and
 * description, a body slot and an optional footer slot below the card.
 * `wide` widens the card for pages with more content.
 */
export default {
  name: 'AuthCard',
  props: {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    wide: { type: Boolean, default: false },
  },
}
</script>
