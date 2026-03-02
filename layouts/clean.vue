<template>
  <TooltipProvider>
    <div class="relative min-h-screen bg-background overflow-hidden">
      <!-- Ambient blur gradient (top-center glow) -->
      <div class="pointer-events-none fixed inset-x-0 top-0 z-0 flex justify-center overflow-hidden" aria-hidden="true">
        <div class="h-80 w-[48rem] rounded-full bg-primary/10 blur-[140px] -translate-y-1/2"></div>
      </div>

      <!-- Grain texture overlay -->
      <div class="pointer-events-none fixed inset-0 z-[9999] opacity-[0.022]" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
          <filter id="grain-filter">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain-filter)" />
        </svg>
      </div>

      <!-- Page content -->
      <div class="relative z-10">
        <slot />
      </div>
    </div>
  </TooltipProvider>
</template>

<script>
export default {
  name: 'CleanLayout',
}
</script>
