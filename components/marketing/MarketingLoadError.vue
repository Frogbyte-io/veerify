<template>
  <Card role="alert">
    <CardContent class="py-8 text-center">
      <Icon name="lucide:alert-circle" class="mx-auto mb-3 h-8 w-8 text-destructive" />
      <p class="mb-1 font-medium">{{ title }}</p>
      <p v-if="message" class="mb-4 text-sm text-muted-foreground">{{ message }}</p>
      <Button variant="outline" :class="message ? '' : 'mt-3'" @click="$emit('retry')">
        <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
        Try again
      </Button>
    </CardContent>
  </Card>
</template>

<script>
/** The one error state of the marketing pages: a card with the reason and a retry. */
export default {
  name: 'MarketingLoadError',

  props: {
    title: { type: String, default: 'Something went wrong' },
    message: { type: String, default: '' },
  },

  emits: ['retry'],
}
</script>
