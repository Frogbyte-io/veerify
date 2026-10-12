<template>
  <div class="min-h-screen bg-background">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <Toaster />
    <Analytics v-if="onVercel" />
  </div>
</template>

<script>
import { Analytics } from '@vercel/analytics/nuxt'
import { Toaster } from '~/components/ui/sonner'
import 'vue-sonner/style.css'

export default {
  name: 'App',
  components: {
    Toaster,
    Analytics,
  },
  computed: {
    // /_vercel/insights/script.js only exists on Vercel; elsewhere it returns the HTML shell
    onVercel() {
      return useRuntimeConfig().public.onVercel === true
    },
  },
}
</script>
