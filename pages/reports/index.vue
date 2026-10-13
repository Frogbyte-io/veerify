<template>
  <NuxtLayout name="dashboard">
    <div class="p-6" data-testid="reports-unavailable">
      <h1 class="text-3xl font-bold text-foreground">Analytics</h1>
      <section class="mt-6 max-w-xl rounded-lg border border-border bg-card p-6" aria-labelledby="reports-status">
        <h2 id="reports-status" class="text-lg font-semibold text-card-foreground">Reporting is not available yet</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Analytics will appear here when reporting is available. No report data is currently shown.
        </p>
      </section>
    </div>
  </NuxtLayout>
</template>
