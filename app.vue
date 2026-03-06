<template>
  <div class="min-h-screen bg-background">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <Toaster />
    <Analytics />
  </div>
</template>

<script setup>
import { Analytics } from '@vercel/analytics/nuxt'
</script>

<script>
import { Toaster } from '~/components/ui/sonner'
import 'vue-sonner/style.css'

export default {
  name: 'App',
  components: {
    Toaster,
  },
}
</script>
