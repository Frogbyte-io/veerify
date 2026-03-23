<template>
  <TooltipProvider>
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
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
        <div class="flex flex-1 flex-col gap-4 p-4 pt-0">
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
