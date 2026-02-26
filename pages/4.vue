<template>
  <main class="design-four min-h-screen px-4 py-8 sm:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <header class="hero">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.22em] text-rose-100/90">Concept 04</p>
            <h1 class="mt-2 text-3xl font-semibold text-white sm:text-4xl">Prism Garden Board</h1>
            <p class="mt-2 max-w-2xl text-sm text-rose-100/80">
              A soft-glass, colorful board for human-first feedback conversations.
            </p>
          </div>
          <nav class="flex items-center gap-2 text-xs">
            <NuxtLink v-for="route in routes" :key="route" :to="`/${route}`" class="chip">/{{ route }}</NuxtLink>
          </nav>
        </div>
      </header>

      <section class="grid gap-4 md:grid-cols-12">
        <article class="glass-card md:col-span-4">
          <p class="label">Submit</p>
          <h2 class="text-2xl font-semibold text-white">Share what should improve next.</h2>
          <p class="mt-2 text-sm text-rose-100/85">Feature ideas, bugs, and celebration posts are all welcome.</p>
          <button class="cta">
            <Icon name="lucide:pen-line" class="h-4 w-4" />
            Start a Post
          </button>
        </article>

        <article class="glass-card md:col-span-8">
          <p class="label">Trendline</p>
          <div class="mt-3 grid gap-3 sm:grid-cols-3">
            <div class="metric">
              <p class="text-xs text-rose-100/75">Total Threads</p>
              <p class="text-3xl font-semibold text-white">524</p>
            </div>
            <div class="metric">
              <p class="text-xs text-rose-100/75">Weekly Votes</p>
              <p class="text-3xl font-semibold text-white">2,918</p>
            </div>
            <div class="metric">
              <p class="text-xs text-rose-100/75">Avg Response</p>
              <p class="text-3xl font-semibold text-white">14h</p>
            </div>
          </div>
        </article>

        <article v-for="item in cards" :key="item.id" class="glass-card" :class="item.spanClass">
          <div class="flex items-center justify-between">
            <p class="label">{{ item.type }}</p>
            <span class="pill">{{ item.status }}</span>
          </div>
          <h3 class="mt-2 text-xl font-semibold text-white">{{ item.title }}</h3>
          <p class="mt-2 text-sm text-rose-100/85">{{ item.summary }}</p>
          <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-rose-50">
            <span class="inline-flex items-center gap-1">
              <Icon name="lucide:arrow-big-up-dash" class="h-3.5 w-3.5" />
              {{ item.votes }} votes
            </span>
            <span class="inline-flex items-center gap-1">
              <Icon name="lucide:messages-square" class="h-3.5 w-3.5" />
              {{ item.comments }} comments
            </span>
          </div>
        </article>
      </section>
    </div>
  </main>
</template>

<script>
export default {
  name: 'DesignFourPage',
  data() {
    return {
      routes: [1, 2, 3, 4, 5],
      cards: [
        {
          id: 'd1',
          type: 'Bug Report',
          title: 'Mentions in comments fail on Safari mobile',
          summary: 'Autocomplete opens, but selected mentions are stripped after submission.',
          votes: 81,
          comments: 19,
          status: 'Investigating',
          spanClass: 'md:col-span-6',
        },
        {
          id: 'd2',
          type: 'Feature Request',
          title: 'Segment board by customer plan',
          summary: 'Enterprise users want filtering for requests by plan tier.',
          votes: 133,
          comments: 22,
          status: 'Planned',
          spanClass: 'md:col-span-6',
        },
        {
          id: 'd3',
          type: 'Community',
          title: 'Shoutout: board performance is visibly faster',
          summary: 'Scrolling and pagination are smoother after the recent backend update.',
          votes: 47,
          comments: 6,
          status: 'Noted',
          spanClass: 'md:col-span-4',
        },
        {
          id: 'd4',
          type: 'Feature Request',
          title: 'Webhook for vote threshold reached',
          summary: 'Trigger Slack or Discord when any item crosses vote milestones.',
          votes: 109,
          comments: 11,
          status: 'In Review',
          spanClass: 'md:col-span-8',
        },
      ],
    }
  },
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');

.design-four {
  font-family: 'Sora', sans-serif;
  background:
    radial-gradient(circle at 12% 8%, rgba(251, 113, 133, 0.35), transparent 30%),
    radial-gradient(circle at 90% 18%, rgba(45, 212, 191, 0.3), transparent 34%),
    linear-gradient(145deg, #192339, #2b1740 45%, #152f3f);
}

.hero,
.glass-card {
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 1.15rem;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05));
  backdrop-filter: blur(10px);
}

.hero {
  padding: 1.1rem;
}

.glass-card {
  padding: 1rem;
}

.chip {
  border: 1px solid rgba(255, 228, 230, 0.6);
  border-radius: 999px;
  color: rgba(255, 241, 242, 0.95);
  padding: 0.3rem 0.7rem;
}

.chip:hover {
  background: rgba(255, 255, 255, 0.2);
}

.label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(255, 228, 230, 0.78);
}

.cta {
  margin-top: 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 228, 230, 0.7);
  background: rgba(255, 255, 255, 0.2);
  padding: 0.4rem 0.8rem;
  color: #fff;
}

.metric {
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 0.9rem;
  background: rgba(255, 255, 255, 0.08);
  padding: 0.75rem;
}

.pill {
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  padding: 0.15rem 0.5rem;
  font-size: 0.66rem;
  color: rgba(255, 241, 242, 0.95);
}
</style>
