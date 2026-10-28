<template>
  <NuxtLayout name="clean">
    <AuthCard title="Sign in">
      <div class="space-y-3" data-testid="auth-redirect-loading">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-10 w-full" />
      </div>
    </AuthCard>
  </NuxtLayout>
</template>

<script>
/**
 * Legacy `/auth` entry point. The Better Auth demo was removed; the sign-in
 * link in the sidebar still points here, so forward to `/login` and keep any
 * query (e.g. `redirect`).
 */
export default {
  name: 'AuthRedirectPage',

  mounted() {
    navigateTo({ path: '/login', query: this.$route.query }, { replace: true })
  },
}
</script>
