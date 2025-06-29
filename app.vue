<template>
  <div class="min-h-screen bg-background">
    <NuxtPage />
    <Toaster />
  </div>
</template>

<script>
import { Toaster } from '~/components/ui/sonner'
import 'vue-sonner/style.css' 

export default {
  name: 'App',
  components: {
    Toaster
  }
}
</script>
