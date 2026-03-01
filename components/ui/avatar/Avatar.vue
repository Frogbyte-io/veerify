<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { AvatarRoot } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <AvatarRoot
    data-slot="avatar"
    :class="
      cn(
        'relative flex size-10 shrink-0 overflow-hidden rounded-full shadow-sm transition-transform duration-200 hover:scale-105',
        props.class
      )
    "
  >
    <slot />
  </AvatarRoot>
</template>
