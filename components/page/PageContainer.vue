<template>
  <div :class="['mx-auto flex w-full min-w-0 flex-col gap-6', widthClass]">
    <slot />
  </div>
</template>

<script>
// One set of widths for every dashboard page, so moving between pages of the same kind keeps
// the content's left edge and width. The dashboard layout owns the gutters.
const WIDTHS = {
  // Lists, settings, marketing tools
  default: 'max-w-6xl',
  // Detail and editor pages
  narrow: 'max-w-3xl',
  // Boards and inboxes that use the whole canvas
  full: '',
}

export default {
  name: 'PageContainer',
  props: {
    width: {
      type: String,
      default: 'default',
      validator: (value) => Object.keys(WIDTHS).includes(value),
    },
  },
  computed: {
    widthClass() {
      return WIDTHS[this.width]
    },
  },
}
</script>
