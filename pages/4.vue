<template>
  <div class="editorial-board min-h-screen bg-[#f4f4f0] text-[#1a1a1a] font-sans selection:bg-[#1a1a1a] selection:text-[#f4f4f0]">
    <div class="max-w-[1400px] mx-auto px-6 md:px-12 py-12">
      <!-- Top Bar -->
      <div class="flex justify-between items-center border-b border-[#1a1a1a] pb-4 mb-16">
        <div class="text-xs uppercase tracking-[0.2em] font-semibold">Vol. IV — Issue 02</div>
        <div class="text-xs uppercase tracking-[0.2em] font-semibold">Acme Corporation</div>
        <div class="text-xs uppercase tracking-[0.2em] font-semibold">Est. 2024</div>
      </div>

      <!-- Header -->
      <header class="text-center mb-24">
        <h1 class="text-7xl md:text-9xl font-serif tracking-tighter leading-none mb-6">The Feedback<br><span class="italic font-light text-[#555]">Chronicles</span></h1>
        <div class="w-24 h-[1px] bg-[#1a1a1a] mx-auto mb-8" />
        <p class="max-w-2xl mx-auto text-lg text-[#555] font-serif italic">A curated collection of thoughts, critiques, and visions for the future of our digital ecosystem.</p>
        
        <button class="mt-12 border border-[#1a1a1a] px-10 py-4 text-xs uppercase tracking-[0.2em] font-semibold hover:bg-[#1a1a1a] hover:text-[#f4f4f0] transition-colors duration-500">
          Submit a Letter
        </button>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-16">
        <!-- Sidebar -->
        <aside class="lg:col-span-3">
          <div class="sticky top-12">
            <div class="mb-12">
              <h2 class="text-xs uppercase tracking-[0.2em] font-semibold border-b border-[#1a1a1a] pb-3 mb-6">Index</h2>
              <ul class="space-y-4">
                <li v-for="cat in categories" :key="cat" class="group cursor-pointer flex justify-between items-center">
                  <span class="font-serif text-lg group-hover:italic transition-all">{{ cat }}</span>
                  <span class="text-xs text-[#888]">—</span>
                </li>
              </ul>
            </div>

            <div>
              <h2 class="text-xs uppercase tracking-[0.2em] font-semibold border-b border-[#1a1a1a] pb-3 mb-6">Status Report</h2>
              <div class="space-y-4 font-serif">
                <div class="flex justify-between items-end border-b border-dotted border-[#ccc] pb-2">
                  <span class="text-lg">Planned</span>
                  <span class="text-sm font-sans">12</span>
                </div>
                <div class="flex justify-between items-end border-b border-dotted border-[#ccc] pb-2">
                  <span class="text-lg">In Progress</span>
                  <span class="text-sm font-sans">05</span>
                </div>
                <div class="flex justify-between items-end border-b border-dotted border-[#ccc] pb-2">
                  <span class="text-lg">Completed</span>
                  <span class="text-sm font-sans">128</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <!-- Main Content -->
        <main class="lg:col-span-9">
          <div class="flex justify-between items-end border-b-2 border-[#1a1a1a] pb-4 mb-12">
            <h2 class="text-3xl font-serif">Recent Submissions</h2>
            <div class="flex gap-6 text-xs uppercase tracking-[0.1em] font-semibold">
              <button class="text-[#1a1a1a] border-b border-[#1a1a1a] pb-1">Trending</button>
              <button class="text-[#888] hover:text-[#1a1a1a] transition-colors">Latest</button>
              <button class="text-[#888] hover:text-[#1a1a1a] transition-colors">Archived</button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-16">
            <article v-for="(item, index) in feedbacks" :key="item.id" class="group" :class="{'md:col-span-2 border-b border-[#1a1a1a] pb-16': index === 0}">
              <div class="flex flex-col h-full">
                <div class="flex justify-between items-start mb-6">
                  <div class="flex gap-3">
                    <span class="text-[10px] uppercase tracking-[0.2em] border border-[#1a1a1a] px-2 py-1">{{ item.status }}</span>
                    <span class="text-[10px] uppercase tracking-[0.2em] text-[#555] py-1">{{ item.category }}</span>
                  </div>
                  <div class="text-xs font-serif italic text-[#888]">{{ item.date }}</div>
                </div>
                
                <h3 class="font-serif leading-tight mb-4 group-hover:text-[#555] transition-colors" :class="index === 0 ? 'text-5xl' : 'text-3xl'">
                  {{ item.title }}
                </h3>
                
                <p class="text-[#444] leading-relaxed mb-8 font-serif text-lg" :class="index === 0 ? 'max-w-3xl' : ''">
                  {{ item.description }}
                </p>
                
                <div class="mt-auto flex items-center justify-between pt-6 border-t border-[#e0e0e0]">
                  <div class="flex items-center gap-4">
                    <button class="flex items-center gap-2 group/btn">
                      <span class="w-8 h-8 rounded-full border border-[#1a1a1a] flex items-center justify-center group-hover/btn:bg-[#1a1a1a] group-hover/btn:text-[#f4f4f0] transition-colors">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
                      </span>
                      <span class="text-sm font-semibold">{{ item.upvotes }}</span>
                    </button>
                    <span class="text-[#ccc]">|</span>
                    <button class="text-xs uppercase tracking-[0.1em] text-[#555] hover:text-[#1a1a1a] transition-colors">
                      {{ item.comments }} Responses
                    </button>
                  </div>
                  <div class="text-xs uppercase tracking-[0.1em] font-semibold">
                    By {{ item.author }}
                  </div>
                </div>
              </div>
            </article>
          </div>
          
          <div class="mt-20 text-center">
            <button class="text-xs uppercase tracking-[0.2em] font-semibold border-b border-[#1a1a1a] pb-1 hover:text-[#555] hover:border-[#555] transition-colors">
              Load More Entries
            </button>
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

const categories = ['Feature Requests', 'Bug Reports', 'Integrations', 'Design & UX', 'General Feedback']

const feedbacks = ref([
  {
    id: 1,
    title: 'The Case for a Comprehensive Dark Mode',
    description: 'While the current light theme possesses a certain undeniable elegance, it proves rather harsh during nocturnal usage. A meticulously crafted dark mode, one that respects system preferences while maintaining our typographic hierarchy, is not merely a luxury but a necessity for the modern professional.',
    upvotes: 142,
    status: 'Planned',
    category: 'Design & UX',
    comments: 12,
    author: 'S. Jenkins',
    date: 'Oct 12, 2023'
  },
  {
    id: 2,
    title: 'Instability on Mobile Platforms',
    description: 'Following the recent v2.4 deployment, the iOS application exhibits immediate failure upon launch on newer devices. A swift resolution is requested.',
    upvotes: 89,
    status: 'In Progress',
    category: 'Bug Reports',
    comments: 5,
    author: 'M. Chen',
    date: 'Oct 14, 2023'
  },
  {
    id: 3,
    title: 'Keyboard Navigation for Power Users',
    description: 'The current reliance on cursor-based navigation impedes workflow velocity. The introduction of standard keyboard shortcuts would greatly enhance efficiency.',
    upvotes: 56,
    status: 'Under Review',
    category: 'Feature Requests',
    comments: 3,
    author: 'A. Rivera',
    date: 'Oct 05, 2023'
  },
  {
    id: 4,
    title: 'PDF Export Capabilities',
    description: 'The limitation to CSV exports is increasingly problematic. Stakeholders require beautifully formatted PDF reports directly from the analytical dashboard.',
    upvotes: 34,
    status: 'Completed',
    category: 'Integrations',
    comments: 8,
    author: 'E. Watson',
    date: 'Sep 28, 2023'
  },
  {
    id: 5,
    title: 'Workspace Personalization',
    description: 'Organizations would benefit immensely from the ability to apply their own brand colors and typographic choices to their specific workspaces.',
    upvotes: 21,
    status: 'Open',
    category: 'Design & UX',
    comments: 1,
    author: 'D. Kim',
    date: 'Sep 15, 2023'
  }
])
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,700;1,6..96,400&family=Inter:wght@400;600&display=swap');

.editorial-board {
  font-family: 'Inter', sans-serif;
}

.editorial-board h1, .editorial-board h2, .editorial-board h3, .editorial-board .font-serif {
  font-family: 'Bodoni Moda', serif;
}
</style>
