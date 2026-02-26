<template>
  <div class="toy-board min-h-screen bg-[#ffe5e5] text-black font-sans overflow-x-hidden">
    <!-- Decorative background elements -->
    <div class="fixed top-10 left-10 w-20 h-20 bg-[#ffeb3b] border-4 border-black rounded-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-bounce" style="animation-duration: 3s;" />
    <div class="fixed bottom-20 right-10 w-32 h-32 bg-[#4caf50] border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] rotate-12" />
    <div class="fixed top-40 right-20 w-16 h-16 bg-[#2196f3] border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-12" />

    <div class="max-w-6xl mx-auto p-4 md:p-8 relative z-10">
      <!-- Header -->
      <header class="bg-white border-4 border-black p-8 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mb-12 flex flex-col md:flex-row justify-between items-center gap-6 transform hover:-translate-y-1 transition-transform">
        <div class="flex items-center gap-6">
          <div class="w-20 h-20 bg-[#ff5722] border-4 border-black rounded-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center text-4xl">
            🚀
          </div>
          <div>
            <h1 class="text-4xl md:text-6xl font-black tracking-tight text-[#ff5722] drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">
              Idea Box!
            </h1>
            <p class="text-xl font-bold mt-2">Help us make things awesomer.</p>
          </div>
        </div>
        <button class="bg-[#ffeb3b] border-4 border-black px-8 py-4 rounded-xl text-xl font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] transition-all active:shadow-none active:translate-y-[4px] active:translate-x-[4px]">
          + Add Idea
        </button>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <!-- Sidebar -->
        <aside class="lg:col-span-4 space-y-8">
          <div class="bg-[#e0f7fa] border-4 border-black p-6 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <h2 class="text-2xl font-black mb-6 flex items-center gap-2">
              <span>🏷️</span> Tags
            </h2>
            <div class="flex flex-wrap gap-3">
              <button v-for="(cat, index) in categories" :key="cat" class="border-2 border-black px-4 py-2 rounded-full font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all" :class="colors[index % colors.length]">
                {{ cat }}
              </button>
            </div>
          </div>

          <div class="bg-[#f3e5f5] border-4 border-black p-6 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <h2 class="text-2xl font-black mb-6 flex items-center gap-2">
              <span>📊</span> Status
            </h2>
            <div class="space-y-4">
              <div class="flex justify-between items-center bg-white border-2 border-black p-3 rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span class="font-bold flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-[#ff9800] border border-black" /> Planned</span>
                <span class="bg-[#ff9800] border-2 border-black px-3 py-1 rounded-full font-black text-sm">12</span>
              </div>
              <div class="flex justify-between items-center bg-white border-2 border-black p-3 rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span class="font-bold flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-[#2196f3] border border-black" /> Doing It</span>
                <span class="bg-[#2196f3] text-white border-2 border-black px-3 py-1 rounded-full font-black text-sm">5</span>
              </div>
              <div class="flex justify-between items-center bg-white border-2 border-black p-3 rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span class="font-bold flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-[#4caf50] border border-black" /> Done!</span>
                <span class="bg-[#4caf50] text-white border-2 border-black px-3 py-1 rounded-full font-black text-sm">128</span>
              </div>
            </div>
          </div>
        </aside>

        <!-- Main Content -->
        <main class="lg:col-span-8 space-y-6">
          <div class="flex flex-wrap justify-between items-center bg-white border-4 border-black p-4 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] mb-8">
            <div class="flex gap-2">
              <button class="bg-[#ff5722] text-white border-2 border-black px-4 py-2 rounded-xl font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">🔥 Hot</button>
              <button class="bg-white hover:bg-gray-100 border-2 border-black px-4 py-2 rounded-xl font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">✨ New</button>
              <button class="bg-white hover:bg-gray-100 border-2 border-black px-4 py-2 rounded-xl font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">⭐ Top</button>
            </div>
          </div>

          <div class="space-y-6">
            <article v-for="(item, index) in feedbacks" :key="item.id" class="bg-white border-4 border-black p-6 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] transition-all duration-200">
              
              <div class="flex flex-col sm:flex-row gap-6">
                <!-- Upvote Block -->
                <button class="flex flex-col items-center justify-center bg-[#ffeb3b] border-4 border-black w-20 h-24 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] transition-all active:shadow-none active:translate-y-[4px] active:translate-x-[4px] shrink-0">
                  <span class="text-3xl font-black">⬆️</span>
                  <span class="text-xl font-black">{{ item.upvotes }}</span>
                </button>

                <div class="flex-1">
                  <div class="flex flex-wrap gap-3 mb-4">
                    <span class="bg-white border-2 border-black px-3 py-1 rounded-full text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">{{ item.status }}</span>
                    <span class="border-2 border-black px-3 py-1 rounded-full text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" :class="colors[index % colors.length]">{{ item.category }}</span>
                  </div>
                  
                  <h3 class="text-2xl md:text-3xl font-black mb-3 leading-tight">{{ item.title }}</h3>
                  <p class="text-lg font-medium text-gray-700 mb-6">{{ item.description }}</p>
                  
                  <div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t-4 border-black border-dashed">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 bg-[#9c27b0] border-2 border-black rounded-full shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center text-white font-black">
                        {{ item.author.charAt(0) }}
                      </div>
                      <span class="font-bold">{{ item.author }}</span>
                    </div>
                    <div class="flex items-center gap-4">
                      <span class="font-bold text-gray-500">{{ item.date }}</span>
                      <button class="flex items-center gap-2 bg-[#e0e0e0] border-2 border-black px-4 py-2 rounded-xl font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#d5d5d5]">
                        💬 {{ item.comments }}
                      </button>
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

const categories = ['Features', 'Bugs 🐛', 'Integrations', 'Design 🎨', 'Other']
const colors = ['bg-[#ffc107]', 'bg-[#ff9800]', 'bg-[#4caf50]', 'bg-[#00bcd4]', 'bg-[#e91e63] text-white']

const feedbacks = ref([
  {
    id: 1,
    title: 'Dark mode support across all dashboards',
    description: 'The current light theme is too bright for night-time usage. We need a proper dark mode that respects system preferences and can be toggled manually.',
    upvotes: 142,
    status: 'Planned',
    category: 'Design 🎨',
    comments: 12,
    author: 'Sarah J.',
    date: '2 days ago'
  },
  {
    id: 2,
    title: 'Mobile app crashes on startup',
    description: 'Since the v2.4 update, the iOS app crashes immediately after the splash screen on iPhone 13 Pro. Reinstalling doesn\'t fix it.',
    upvotes: 89,
    status: 'Doing It',
    category: 'Bugs 🐛',
    comments: 5,
    author: 'Mike C.',
    date: '5 hours ago'
  },
  {
    id: 3,
    title: 'Add keyboard shortcuts for power users',
    description: 'Navigating through the menus takes too many clicks. Please add standard keyboard shortcuts (Cmd+K for search, etc) to speed up workflow.',
    upvotes: 56,
    status: 'Under Review',
    category: 'Features',
    comments: 3,
    author: 'Alex R.',
    date: '1 week ago'
  },
  {
    id: 4,
    title: 'Export reports to PDF format',
    description: 'Currently we can only export to CSV. Our clients need formatted PDF reports directly from the dashboard.',
    upvotes: 34,
    status: 'Done!',
    category: 'Integrations',
    comments: 8,
    author: 'Emma W.',
    date: '2 weeks ago'
  },
  {
    id: 5,
    title: 'Custom themes for workspaces',
    description: 'Allow organizations to set their own brand colors and logos for their specific workspaces.',
    upvotes: 21,
    status: 'Open',
    category: 'Design 🎨',
    comments: 1,
    author: 'David K.',
    date: '1 month ago'
  }
])
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');

.toy-board {
  font-family: 'Nunito', sans-serif;
}
</style>
