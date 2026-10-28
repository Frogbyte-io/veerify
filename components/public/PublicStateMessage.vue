<template>
  <div class="py-16 text-center" role="status">
    <Icon :name="icon" class="mx-auto mb-3 h-10 w-10" :class="isError ? 'text-destructive' : 'text-muted-foreground'" />
    <p class="font-medium">{{ title }}</p>
    <p v-if="message" class="mt-1 text-sm text-muted-foreground">{{ message }}</p>
    <Button v-if="retryable" variant="outline" size="sm" class="mt-4" @click="$emit('retry')">Retry</Button>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>

<script>
/**
 * Empty / error state shared by every tab of the public project site, so they
 * look the same: same icon size, padding and a Button-based Retry.
 */
export default {
  name: 'PublicStateMessage',
  props: {
    icon: { type: String, default: 'lucide:inbox' },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    // 'error' tints the icon and is the only kind that offers a retry
    kind: { type: String, default: 'empty' },
    retryable: { type: Boolean, default: false },
  },
  emits: ['retry'],
  computed: {
    isError() {
      return this.kind === 'error'
    },
  },
}
</script>
