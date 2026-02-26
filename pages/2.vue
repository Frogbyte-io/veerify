<template>
  <div class="cyberpunk-board min-h-screen bg-[#0a0a1a] text-[#00f0ff] font-sans relative overflow-hidden">
    <!-- Scanlines overlay -->
    <div class="pointer-events-none absolute inset-0 z-50 opacity-10 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px]" />
    
    <!-- Grid background -->
    <div class="absolute inset-0 z-0 opacity-20 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />

    <div class="max-w-7xl mx-auto p-4 md:p-8 relative z-10">
      <!-- Header -->
      <header class="flex flex-col md:flex-row justify-between items-center mb-16 border-b border-[#ff003c] pb-6 shadow-[0_4px_20px_rgba(255,0,60,0.2)]">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 bg-[#ff003c] flex items-center justify-center text-black font-black text-3xl shadow-[0_0_15px_#ff003c]">
            AC
          </div>
          <div>
            <h1 class="text-4xl md:text-5xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#00f0ff] to-[#ff003c] drop-shadow-[0_0_10px_rgba(0,240,255,0.5)]">
              NEXUS_FEEDBACK
            </h1>
            <p class="text-[#ff003c] text-sm tracking-[0.3em] mt-1">SYSTEM.ONLINE // V.2.0.4</p>
          </div>
        </div>
        <button class="mt-6 md:mt-0 relative group px-8 py-3 bg-transparent border border-[#00f0ff] text-[#00f0ff] font-bold tracking-widest uppercase overflow-hidden transition-all hover:shadow-[0_0_20px_#00f0ff]">
          <span class="absolute inset-0 w-full h-full bg-[#00f0ff] opacity-0 group-hover:opacity-20 transition-opacity" />
          <span class="relative z-10 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            INIT_REQUEST
          </span>
          <!-- Glitch effect on hover -->
          <span class="absolute top-0 left-0 w-full h-full bg-[#ff003c] mix-blend-screen opacity-0 group-hover:animate-glitch" />
        </button>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <!-- Sidebar -->
        <aside class="lg:col-span-1 space-y-8">
          <div class="bg-[#0f0f2a] border border-[#00f0ff]/30 p-6 rounded-sm shadow-[inset_0_0_20px_rgba(0,240,255,0.05)]">
            <h2 class="text-xl font-bold text-[#ff003c] mb-6 flex items-center gap-2">
              <span class="w-2 h-2 bg-[#ff003c] animate-pulse" />
              DATABANKS
            </h2>
            <ul class="space-y-3">
              <li v-for="cat in categories" :key="cat" class="group cursor-pointer flex items-center justify-between p-2 hover:bg-[#00f0ff]/10 transition-colors border-l-2 border-transparent hover:border-[#00f0ff]">
                <span class="text-sm tracking-wider group-hover:text-white transition-colors">{{ cat }}</span>
                <span class="text-xs text-[#ff003c] opacity-0 group-hover:opacity-100 transition-opacity">[SELECT]</span>
              </li>
            </ul>
          </div>

          <div class="bg-[#0f0f2a] border border-[#ff003c]/30 p-6 rounded-sm">
            <h2 class="text-xl font-bold text-[#00f0ff] mb-4">SYS_STATUS</h2>
            <div class="space-y-4">
              <div class="flex justify-between items-center">
                <span class="text-sm tracking-wider text-gray-400">PLANNED</span>
                <div class="flex items-center gap-2">
                  <div class="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div class="w-1/3 h-full bg-[#00f0ff]" />
                  </div>
                  <span class="text-xs">12</span>
                </div>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-sm tracking-wider text-gray-400">IN_PROG</span>
                <div class="flex items-center gap-2">
                  <div class="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div class="w-1/6 h-full bg-[#ff003c]" />
                  </div>
                  <span class="text-xs">5</span>
                </div>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-sm tracking-wider text-gray-400">COMPLETED</span>
                <div class="flex items-center gap-2">
                  <div class="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div class="w-full h-full bg-[#00ff00]" />
                  </div>
                  <span class="text-xs">128</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <!-- Main Content -->
        <main class="lg:col-span-3 space-y-6">
          <div class="flex justify-between items-center bg-[#0f0f2a] p-4 border border-[#00f0ff]/20">
            <div class="flex gap-6 text-sm tracking-widest">
              <button class="text-[#00f0ff] border-b-2 border-[#00f0ff] pb-1 shadow-[0_2px_10px_rgba(0,240,255,0.3)]">HOT_NODES</button>
              <button class="text-gray-500 hover:text-white transition-colors">NEW_DATA</button>
              <button class="text-gray-500 hover:text-white transition-colors">TOP_RATED</button>
            </div>
            <div class="text-xs text-[#ff003c] animate-pulse">LIVE_FEED_ACTIVE</div>
          </div>

          <div class="space-y-4">
            <article v-for="item in feedbacks" :key="item.id" class="group bg-[#0f0f2a] border border-[#00f0ff]/20 p-6 hover:border-[#00f0ff] transition-all duration-300 hover:shadow-[0_0_15px_rgba(0,240,255,0.15)] relative">
              <!-- Decorative corner pieces -->
              <div class="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#00f0ff]" />
              <div class="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#00f0ff]" />
              <div class="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#00f0ff]" />
              <div class="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#00f0ff]" />

              <div class="flex flex-col sm:flex-row gap-6 items-start">
                <!-- Upvote Block -->
                <button class="flex flex-col items-center justify-center bg-[#050510] border border-[#00f0ff]/30 w-16 h-20 group-hover:bg-[#00f0ff]/10 group-hover:border-[#00f0ff] transition-all shrink-0 rounded-sm">
                  <span class="text-2xl text-[#00f0ff] group-hover:-translate-y-1 transition-transform">▲</span>
                  <span class="text-lg font-bold text-white">{{ item.upvotes }}</span>
                </button>

                <div class="flex-1 w-full">
                  <div class="flex flex-wrap justify-between items-start mb-2 gap-2">
                    <div class="flex gap-2">
                      <span class="bg-[#ff003c]/10 text-[#ff003c] border border-[#ff003c]/50 px-2 py-0.5 text-[10px] tracking-widest uppercase">{{ item.status }}</span>
                      <span class="bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/50 px-2 py-0.5 text-[10px] tracking-widest uppercase">{{ item.category }}</span>
                    </div>
                    <span class="text-[10px] text-gray-500 tracking-widest">{{ item.date }}</span>
                  </div>
                  
                  <h3 class="text-xl font-bold text-white mb-2 group-hover:text-[#00f0ff] transition-colors tracking-wide">{{ item.title }}</h3>
                  <p class="text-gray-400 text-sm mb-4 line-clamp-2 font-light tracking-wide">{{ item.description }}</p>
                  
                  <div class="flex items-center justify-between border-t border-[#00f0ff]/10 pt-3 mt-auto">
                    <div class="flex items-center gap-4 text-xs text-gray-500 tracking-widest">
                      <span class="flex items-center gap-1 hover:text-[#00f0ff] cursor-pointer transition-colors">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="square" stroke-linejoin="miter" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                        {{ item.comments }} CMTS
                      </span>
                    </div>
                    <div class="text-xs text-[#ff003c] tracking-widest flex items-center gap-2">
                      <span class="w-1 h-1 bg-[#ff003c] rounded-full" />
                      USR: {{ item.author }}
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

definePageMeta({
  layout: 'clean'
})

const categories = ['FEATURE_REQ', 'BUG_REP', 'SYS_INTEGRATION', 'UI_UX_CORE', 'GEN_DATA']

const feedbacks = ref([
  {
    id: 1,
    title: 'Dark mode support across all dashboards',
    description: 'The current light theme is too bright for night-time usage. We need a proper dark mode that respects system preferences and can be toggled manually.',
    upvotes: 142,
    status: 'Planned',
    category: 'UI_UX_CORE',
    comments: 12,
    author: 'USR_892',
    date: 'T-48:00:00'
  },
  {
    id: 2,
    title: 'Mobile app crashes on startup',
    description: 'Since the v2.4 update, the iOS app crashes immediately after the splash screen on iPhone 13 Pro. Reinstalling doesn\'t fix it.',
    upvotes: 89,
    status: 'In Progress',
    category: 'BUG_REP',
    comments: 5,
    author: 'SYS_ADMIN',
    date: 'T-05:00:00'
  },
  {
    id: 3,
    title: 'Add keyboard shortcuts for power users',
    description: 'Navigating through the menus takes too many clicks. Please add standard keyboard shortcuts (Cmd+K for search, etc) to speed up workflow.',
    upvotes: 56,
    status: 'Under Review',
    category: 'FEATURE_REQ',
    comments: 3,
    author: 'DEV_NULL',
    date: 'T-168:00:00'
  },
  {
    id: 4,
    title: 'Export reports to PDF format',
    description: 'Currently we can only export to CSV. Our clients need formatted PDF reports directly from the dashboard.',
    upvotes: 34,
    status: 'Completed',
    category: 'SYS_INTEGRATION',
    comments: 8,
    author: 'DATA_GURU',
    date: 'T-336:00:00'
  },
  {
    id: 5,
    title: 'Custom themes for workspaces',
    description: 'Allow organizations to set their own brand colors and logos for their specific workspaces.',
    upvotes: 21,
    status: 'Open',
    category: 'UI_UX_CORE',
    comments: 1,
    author: 'DESIGN_PRO',
    date: 'T-720:00:00'
  }
])
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@300;400;500;600;700&display=swap');

.cyberpunk-board {
  font-family: 'Rajdhani', sans-serif;
}

.cyberpunk-board h1, .cyberpunk-board h2, .cyberpunk-board h3, .cyberpunk-board button {
  font-family: 'Orbitron', sans-serif;
}

@keyframes glitch {
  0% { transform: translate(0) }
  20% { transform: translate(-2px, 2px) }
  40% { transform: translate(-2px, -2px) }
  60% { transform: translate(2px, 2px) }
  80% { transform: translate(2px, -2px) }
  100% { transform: translate(0) }
}

.animate-glitch {
  animation: glitch 0.2s cubic-bezier(.25, .46, .45, .94) both infinite;
}
</style>
