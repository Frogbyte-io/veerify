<template>
  <div class="min-h-screen bg-gray-50">
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
// Redirect to dashboard on app load
const router = useRouter()
const route = useRoute()

onMounted(() => {
  if (route.path === '/') {
    router.push('/dashboard')
  }
})
</script>
