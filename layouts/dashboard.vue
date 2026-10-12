<template>
  <TooltipProvider>
    <SidebarProvider>
      <!--
        The sidebar picks its desktop or mobile (sheet) markup from a media query that is false on the
        server but already true on the first client render at narrow widths, which mismatched hydration.
        It renders client-side only; the fallback reserves the desktop gap so there is no layout shift.
      -->
      <ClientOnly>
        <AppSidebar />
        <template #fallback>
          <div class="hidden w-(--sidebar-width) shrink-0 md:block" aria-hidden="true" />
        </template>
      </ClientOnly>
      <SidebarInset class="min-w-0">
        <header
          class="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
        >
          <div class="flex w-full items-center justify-between px-4">
            <div class="flex items-center gap-2">
              <SidebarTrigger class="-ml-1" />
              <SidebarSeparator orientation="vertical" />
            </div>
            <NotificationBell />
          </div>
        </header>
        <div class="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
          <EmailVerificationNudge />
          <slot />
        </div>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>
</template>

<script>
export default {
  name: 'DashboardLayout',
}
</script>
