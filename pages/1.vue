<template>
  <div class="brutalist-board min-h-screen bg-black text-white font-mono selection:bg-[#00ff00] selection:text-black">
    <div class="max-w-6xl mx-auto p-4 md:p-8">
      <!-- Header -->
      <header class="border-b-4 border-white pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 class="text-6xl md:text-8xl font-black uppercase tracking-tighter leading-none hover:text-[#00ff00] transition-colors duration-300">
            FEEDBACK<br>SYSTEM
          </h1>
          <p class="text-xl mt-4 uppercase tracking-widest text-gray-400">Acme Corp // V.1.0.0</p>
        </div>
        <button class="border-2 border-white px-8 py-4 text-xl font-bold uppercase hover:bg-white hover:text-black transition-all duration-200 active:scale-95">
          + Submit Issue
        </button>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <!-- Sidebar -->
        <aside class="lg:col-span-3 space-y-8">
          <div class="border-2 border-white p-6">
            <h2 class="text-2xl font-bold uppercase mb-6 border-b-2 border-white pb-2">Filters</h2>
            <ul class="space-y-4">
              <li v-for="cat in categories" :key="cat" class="group cursor-pointer flex items-center gap-3">
                <div class="w-4 h-4 border-2 border-white group-hover:bg-[#00ff00] group-hover:border-[#00ff00] transition-colors"/>
                <span class="text-lg uppercase group-hover:text-[#00ff00] transition-colors">{{ cat }}</span>
              </li>
            </ul>
          </div>

          <div class="border-2 border-white p-6 bg-white text-black">
            <h2 class="text-2xl font-bold uppercase mb-4">Status</h2>
            <div class="space-y-2">
              <div class="flex justify-between items-center border-b border-black pb-2">
                <span class="uppercase font-bold">Planned</span>
                <span class="bg-black text-white px-2 py-1 text-xs">12</span>
              </div>
              <div class="flex justify-between items-center border-b border-black pb-2">
                <span class="uppercase font-bold">In Progress</span>
                <span class="bg-black text-white px-2 py-1 text-xs">5</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="uppercase font-bold">Completed</span>
                <span class="bg-black text-white px-2 py-1 text-xs">128</span>
              </div>
            </div>
          </div>
        </aside>

        <!-- Main Content -->
        <main class="lg:col-span-9 space-y-6">
          <div class="flex justify-between items-center border-b-2 border-white pb-4">
            <div class="text-2xl font-bold uppercase">Active Issues</div>
            <div class="flex gap-4 text-sm uppercase">
              <button class="hover:text-[#00ff00] underline decoration-2 underline-offset-4">Trending</button>
              <button class="text-gray-500 hover:text-white">Newest</button>
              <button class="text-gray-500 hover:text-white">Top</button>
            </div>
          </div>

          <div class="space-y-6">
            <article v-for="item in feedbacks" :key="item.id" class="group border-2 border-white p-6 hover:border-[#00ff00] transition-colors relative overflow-hidden">
              <div class="absolute top-0 right-0 w-32 h-32 bg-[#00ff00] opacity-0 group-hover:opacity-10 transition-opacity rounded-bl-full"/>
              
              <div class="flex flex-col md:flex-row gap-6 items-start">
                <!-- Upvote Block -->
                <button class="flex flex-col items-center justify-center border-2 border-white w-20 h-24 group-hover:bg-[#00ff00] group-hover:text-black group-hover:border-[#00ff00] transition-all shrink-0">
                  <span class="text-3xl font-black">↑</span>
                  <span class="text-xl font-bold">{{ item.upvotes }}</span>
                </button>

                <div class="flex-1">
                  <div class="flex flex-wrap gap-3 mb-3">
                    <span class="border border-white px-3 py-1 text-xs uppercase font-bold">{{ item.status }}</span>
                    <span class="text-[#00ff00] border border-[#00ff00] px-3 py-1 text-xs uppercase font-bold">{{ item.category }}</span>
                  </div>
                  <h3 class="text-3xl font-bold uppercase mb-3 group-hover:text-[#00ff00] transition-colors">{{ item.title }}</h3>
                  <p class="text-gray-400 text-lg mb-6 line-clamp-2">{{ item.description }}</p>
                  
                  <div class="flex items-center gap-6 text-sm uppercase font-bold text-gray-500">
                    <span class="flex items-center gap-2 hover:text-white cursor-pointer">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="square" stroke-linejoin="miter" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                      {{ item.comments }} Comments
                    </span>
                    <span>{{ item.author }}</span>
                    <span>{{ item.date }}</span>
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

const categories = ['Feature Requests', 'Bug Reports', 'Integrations', 'UI/UX', 'General']

const feedbacks = ref([
  {
    id: 1,
    title: 'Dark mode support across all dashboards',
    description: 'The current light theme is too bright for night-time usage. We need a proper dark mode that respects system preferences and can be toggled manually.',
    upvotes: 142,
    status: 'Planned',
    category: 'UI/UX',
    comments: 12,
    author: 'USR_892',
    date: '2 DAYS AGO'
  },
  {
    id: 2,
    title: 'Mobile app crashes on startup',
    description: 'Since the v2.4 update, the iOS app crashes immediately after the splash screen on iPhone 13 Pro. Reinstalling doesn\'t fix it.',
    upvotes: 89,
    status: 'In Progress',
    category: 'Bug Reports',
    comments: 5,
    author: 'SYS_ADMIN',
    date: '5 HOURS AGO'
  },
  {
    id: 3,
    title: 'Add keyboard shortcuts for power users',
    description: 'Navigating through the menus takes too many clicks. Please add standard keyboard shortcuts (Cmd+K for search, etc) to speed up workflow.',
    upvotes: 56,
    status: 'Under Review',
    category: 'Feature Requests',
    comments: 3,
    author: 'DEV_NULL',
    date: '1 WEEK AGO'
  },
  {
    id: 4,
    title: 'Export reports to PDF format',
    description: 'Currently we can only export to CSV. Our clients need formatted PDF reports directly from the dashboard.',
    upvotes: 34,
    status: 'Completed',
    category: 'Integrations',
    comments: 8,
    author: 'DATA_GURU',
    date: '2 WEEKS AGO'
  },
  {
    id: 5,
    title: 'Custom themes for workspaces',
    description: 'Allow organizations to set their own brand colors and logos for their specific workspaces.',
    upvotes: 21,
    status: 'Open',
    category: 'UI/UX',
    comments: 1,
    author: 'DESIGN_PRO',
    date: '1 MONTH AGO'
  }
])
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');

.brutalist-board {
  font-family: 'Space Mono', monospace;
}
</style>
