<template>
    <div
        class="organic-board min-h-screen bg-[#fdfbf7] text-[#4a4a4a] font-sans selection:bg-[#f4dcd6] selection:text-[#4a4a4a]">
        <!-- Decorative background blobs -->
        <div
            class="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[#f4dcd6] opacity-40 blur-3xl pointer-events-none" />
        <div
            class="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#d6e5e3] opacity-40 blur-3xl pointer-events-none" />

        <div class="max-w-5xl mx-auto p-6 md:p-12 relative z-10">
            <!-- Header -->
            <header class="text-center mb-20 pt-10">
                <div class="inline-block mb-6">
                    <div
                        class="w-16 h-16 mx-auto bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
                        <span class="text-2xl text-[#a3b8b5]">🌿</span>
                    </div>
                    <h1 class="text-5xl md:text-6xl font-serif text-[#2c3e3c] mb-4 tracking-tight">Community Voices</h1>
                    <p class="text-lg text-[#8a8a8a] max-w-xl mx-auto font-light">Help us shape the future of Acme Corp.
                        Share your thoughts, ideas, and experiences with our team.</p>
                </div>
                <div class="mt-8">
                    <button
                        class="bg-[#2c3e3c] text-white px-8 py-3.5 rounded-full text-sm tracking-wide hover:bg-[#3a524f] transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
                        Share your feedback
                    </button>
                </div>
            </header>

            <div class="flex flex-col lg:flex-row gap-12">
                <!-- Sidebar -->
                <aside class="lg:w-64 shrink-0 space-y-10">
                    <div>
                        <h3 class="text-xs font-bold uppercase tracking-widest text-[#a3b8b5] mb-5">Categories</h3>
                        <ul class="space-y-3">
                            <li v-for="cat in categories" :key="cat"
                                class="group cursor-pointer flex items-center gap-3">
                                <span
                                    class="w-1.5 h-1.5 rounded-full bg-[#d6e5e3] group-hover:bg-[#e8b4a6] transition-colors" />
                                <span class="text-[15px] text-[#6b6b6b] group-hover:text-[#2c3e3c] transition-colors">{{
                                    cat }}</span>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <h3 class="text-xs font-bold uppercase tracking-widest text-[#a3b8b5] mb-5">Progress</h3>
                        <div class="space-y-4">
                            <div class="flex items-center justify-between group cursor-pointer">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 rounded-full bg-[#f4dcd6] flex items-center justify-center text-[#e8b4a6]">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <span
                                        class="text-[15px] text-[#6b6b6b] group-hover:text-[#2c3e3c] transition-colors">Planned</span>
                                </div>
                                <span class="text-sm text-[#a3b8b5]">12</span>
                            </div>
                            <div class="flex items-center justify-between group cursor-pointer">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 rounded-full bg-[#fff3cd] flex items-center justify-center text-[#e6c254]">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                    </div>
                                    <span
                                        class="text-[15px] text-[#6b6b6b] group-hover:text-[#2c3e3c] transition-colors">In
                                        Progress</span>
                                </div>
                                <span class="text-sm text-[#a3b8b5]">5</span>
                            </div>
                            <div class="flex items-center justify-between group cursor-pointer">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 rounded-full bg-[#d6e5e3] flex items-center justify-center text-[#8ba8a4]">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <span
                                        class="text-[15px] text-[#6b6b6b] group-hover:text-[#2c3e3c] transition-colors">Completed</span>
                                </div>
                                <span class="text-sm text-[#a3b8b5]">128</span>
                            </div>
                        </div>
                    </div>
                </aside>

                <!-- Main Content -->
                <main class="flex-1 space-y-6">
                    <div class="flex justify-between items-center mb-8">
                        <div class="flex gap-6 text-[15px]">
                            <button
                                class="text-[#2c3e3c] font-medium border-b-2 border-[#e8b4a6] pb-1">Trending</button>
                            <button class="text-[#8a8a8a] hover:text-[#2c3e3c] transition-colors">Recent</button>
                            <button class="text-[#8a8a8a] hover:text-[#2c3e3c] transition-colors">Top Voted</button>
                        </div>
                    </div>

                    <div class="space-y-5">
                        <article v-for="item in feedbacks" :key="item.id"
                            class="bg-white p-6 md:p-8 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all duration-500 border border-[#f0f0f0]">
                            <div class="flex flex-col sm:flex-row gap-6 md:gap-8">
                                <!-- Upvote Block -->
                                <button
                                    class="flex flex-col items-center justify-center bg-[#fdfbf7] hover:bg-[#f4dcd6] w-16 h-20 rounded-2xl transition-colors shrink-0 group">
                                    <svg class="w-6 h-6 text-[#a3b8b5] group-hover:text-[#e8b4a6] transition-colors mb-1"
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M5 15l7-7 7 7" />
                                    </svg>
                                    <span class="text-lg font-medium text-[#2c3e3c]">{{ item.upvotes }}</span>
                                </button>

                                <div class="flex-1">
                                    <div class="flex flex-wrap gap-2 mb-3">
                                        <span
                                            class="bg-[#fdfbf7] text-[#8a8a8a] px-3 py-1 rounded-full text-xs font-medium border border-[#f0f0f0]">{{
                                            item.status }}</span>
                                        <span
                                            class="bg-[#f4dcd6]/30 text-[#e8b4a6] px-3 py-1 rounded-full text-xs font-medium">{{
                                            item.category }}</span>
                                    </div>

                                    <h3 class="text-2xl font-serif text-[#2c3e3c] mb-3 leading-snug">{{ item.title }}
                                    </h3>
                                    <p class="text-[#6b6b6b] text-[15px] leading-relaxed mb-6 font-light">{{
                                        item.description }}</p>

                                    <div class="flex items-center justify-between pt-4 border-t border-[#f0f0f0]">
                                        <div class="flex items-center gap-2 text-sm text-[#8a8a8a]">
                                            <div
                                                class="w-6 h-6 rounded-full bg-[#d6e5e3] flex items-center justify-center text-xs text-white font-medium">
                                                {{ item.author.charAt(0) }}
                                            </div>
                                            <span>{{ item.author }}</span>
                                            <span class="mx-2 text-[#d1d1d1]">•</span>
                                            <span>{{ item.date }}</span>
                                        </div>
                                        <button
                                            class="flex items-center gap-1.5 text-sm text-[#8a8a8a] hover:text-[#e8b4a6] transition-colors">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                            </svg>
                                            {{ item.comments }}
                                        </button>
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

const categories = ['Feature Requests', 'Bug Reports', 'Integrations', 'Design & UX', 'General Feedback']

const feedbacks = ref([
    {
        id: 1,
        title: 'Dark mode support across all dashboards',
        description: 'The current light theme is beautiful, but it can be a bit bright for night-time usage. We need a proper dark mode that respects system preferences and can be toggled manually.',
        upvotes: 142,
        status: 'Planned',
        category: 'Design & UX',
        comments: 12,
        author: 'Sarah Jenkins',
        date: '2 days ago'
    },
    {
        id: 2,
        title: 'Mobile app crashes on startup',
        description: 'Since the v2.4 update, the iOS app crashes immediately after the splash screen on iPhone 13 Pro. Reinstalling doesn\'t seem to fix the issue.',
        upvotes: 89,
        status: 'In Progress',
        category: 'Bug Reports',
        comments: 5,
        author: 'Michael Chen',
        date: '5 hours ago'
    },
    {
        id: 3,
        title: 'Add keyboard shortcuts for power users',
        description: 'Navigating through the menus takes too many clicks. Please add standard keyboard shortcuts (Cmd+K for search, etc) to speed up workflow.',
        upvotes: 56,
        status: 'Under Review',
        category: 'Feature Requests',
        comments: 3,
        author: 'Alex Rivera',
        date: '1 week ago'
    },
    {
        id: 4,
        title: 'Export reports to PDF format',
        description: 'Currently we can only export to CSV. Our clients need formatted PDF reports directly from the dashboard to share with their stakeholders.',
        upvotes: 34,
        status: 'Completed',
        category: 'Integrations',
        comments: 8,
        author: 'Emma Watson',
        date: '2 weeks ago'
    },
    {
        id: 5,
        title: 'Custom themes for workspaces',
        description: 'Allow organizations to set their own brand colors and logos for their specific workspaces to make it feel more like home.',
        upvotes: 21,
        status: 'Open',
        category: 'Design & UX',
        comments: 1,
        author: 'David Kim',
        date: '1 month ago'
    }
])
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Quicksand:wght@300;400;500;600&display=swap');

.organic-board {
    font-family: 'Quicksand', sans-serif;
}

.organic-board h1,
.organic-board h3.font-serif {
    font-family: 'Lora', serif;
}
</style>
