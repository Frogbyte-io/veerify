<template>
  <PopoverRoot v-model:open="isOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="h-9 w-9 rounded-md border-2 border-input cursor-pointer ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :style="{ backgroundColor: modelValue || '#3b82f6' }"
        :aria-label="`Selected color: ${modelValue}`"
      />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="z-50 rounded-md border bg-popover p-3 shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        :side-offset="6"
        align="start"
      >
        <div class="space-y-3">
          <ClientOnly>
            <hex-color-picker
              :color="modelValue"
              class="color-picker-widget"
              @color-changed="onColorChanged"
            />
          </ClientOnly>
          <div class="flex items-center gap-2">
            <div
              class="h-6 w-6 shrink-0 rounded border border-input"
              :style="{ backgroundColor: modelValue || '#3b82f6' }"
            />
            <Input
              :model-value="hexInput"
              class="h-8 font-mono text-sm"
              maxlength="7"
              @update:model-value="onHexInput"
            />
          </div>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script>
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'

export default {
  name: 'ColorPicker',

  components: {
    PopoverRoot,
    PopoverTrigger,
    PopoverPortal,
    PopoverContent,
  },

  props: {
    modelValue: {
      type: String,
      default: '#3b82f6',
    },
  },

  emits: ['update:modelValue'],

  data() {
    return {
      isOpen: false,
      hexInput: this.modelValue || '#3b82f6',
    }
  },

  watch: {
    modelValue(val) {
      this.hexInput = val
    },
  },

  mounted() {
    if (import.meta.client) {
      import('vanilla-colorful/hex-color-picker.js')
    }
  },

  methods: {
    onColorChanged(event) {
      const color = event.detail.value
      this.hexInput = color
      this.$emit('update:modelValue', color)
    },

    onHexInput(value) {
      this.hexInput = value
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        this.$emit('update:modelValue', value)
      }
    },
  },
}
</script>

<style>
.color-picker-widget {
  width: 100%;
}
</style>
