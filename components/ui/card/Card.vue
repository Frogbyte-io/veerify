<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'bg-card text-card-foreground flex flex-col gap-6 rounded-xl border border-border/60 py-6 shadow-md transition-all duration-200 hover:shadow-lg',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>
