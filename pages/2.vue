<template>
  <main class="design-two min-h-screen px-4 py-8 sm:px-8">
    <div class="mx-auto max-w-6xl border-2 border-stone-900 bg-amber-50 p-4 shadow-[8px_8px_0_0_#111] sm:p-8">
      <header class="border-b-2 border-stone-900 pb-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="tracking-[0.26em] text-xs uppercase text-stone-700">Concept 02</p>
            <h1 class="mt-2 text-4xl font-semibold leading-tight text-stone-950 sm:text-5xl">The Feedback Gazette</h1>
          </div>
          <nav class="flex items-center gap-2 text-xs font-medium">
            <NuxtLink v-for="route in routes" :key="route" :to="`/${route}`" class="route-pill">/{{ route }}</NuxtLink>
          </nav>
        </div>
        <p class="mt-4 max-w-3xl text-sm text-stone-700">
          A print-inspired board where product signals read like front-page headlines.
        </p>
      </header>

      <section class="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div class="space-y-4">
          <article v-for="story in stories" :key="story.id" class="story-card">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-[0.7rem] uppercase tracking-[0.2em] text-stone-700">{{ story.section }}</p>
              <span class="edition">Votes {{ story.votes }}</span>
            </div>
            <h2 class="mt-2 text-2xl font-semibold leading-tight text-stone-950">{{ story.title }}</h2>
            <p class="mt-2 text-sm leading-relaxed text-stone-700">{{ story.summary }}</p>
            <div class="mt-3 flex flex-wrap items-center gap-4 text-xs text-stone-700">
              <span class="inline-flex items-center gap-1">
                <Icon name="lucide:messages-square" class="h-3.5 w-3.5" />
                {{ story.comments }} comments
              </span>
              <span class="inline-flex items-center gap-1">
                <Icon name="lucide:thumbs-up" class="h-3.5 w-3.5" />
                {{ story.sentiment }}
              </span>
              <button class="quick-action">
                <Icon name="lucide:plus" class="h-3.5 w-3.5" />
                Add Comment
              </button>
            </div>
          </article>
        </div>

        <aside class="space-y-4">
          <article class="panel">
            <h3 class="text-xs uppercase tracking-[0.22em] text-stone-700">Submit Desk</h3>
            <p class="mt-2 text-sm text-stone-700">Send bug reports, requests, or praise in one clean intake flow.</p>
            <button class="submit-link">
              Open Submission
              <Icon name="lucide:move-right" class="h-4 w-4" />
            </button>
          </article>

          <article class="panel">
            <h3 class="text-xs uppercase tracking-[0.22em] text-stone-700">Top Sections</h3>
            <ul class="mt-3 space-y-2 text-sm text-stone-800">
              <li class="list-item">
                <span>Feature Requests</span>
                <strong>62%</strong>
              </li>
              <li class="list-item">
                <span>Bug Reports</span>
                <strong>29%</strong>
              </li>
              <li class="list-item">
                <span>General Praise</span>
                <strong>9%</strong>
              </li>
            </ul>
          </article>

          <article class="panel">
            <h3 class="text-xs uppercase tracking-[0.22em] text-stone-700">Editorial Note</h3>
            <p class="mt-2 text-sm leading-relaxed text-stone-700">
              Community voting now drives roadmap rank every Friday at 10:00 AM.
            </p>
          </article>
        </aside>
      </section>
    </div>
  </main>
</template>

<script>
export default {
  name: 'DesignTwoPage',
  data() {
    return {
      routes: [1, 2, 3, 4, 5],
      stories: [
        {
          id: 'b1',
          section: 'Priority Bug',
          title: 'Auto-save stalls when editing long release notes',
          summary: 'Teams report missing draft snapshots after extended writing sessions.',
          votes: 138,
          comments: 25,
          sentiment: 'Urgent',
        },
        {
          id: 'b2',
          section: 'Feature Desk',
          title: 'Allow grouped notifications by product area',
          summary: 'Users want digest controls to reduce ping fatigue for busy boards.',
          votes: 102,
          comments: 13,
          sentiment: 'Popular',
        },
        {
          id: 'b3',
          section: 'Community',
          title: 'Huge improvement in loading speed after last update',
          summary: 'Public board now feels instant even with heavy threads and tags.',
          votes: 57,
          comments: 8,
          sentiment: 'Positive',
        },
      ],
    }
  },
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

.design-two {
  font-family: 'IBM Plex Mono', monospace;
  background:
    linear-gradient(0deg, rgba(120, 53, 15, 0.06), rgba(120, 53, 15, 0.06)),
    repeating-linear-gradient(
      90deg,
      rgba(146, 64, 14, 0.08) 0,
      rgba(146, 64, 14, 0.08) 1px,
      transparent 1px,
      transparent 32px
    ),
    #fffbeb;
}

h1,
h2 {
  font-family: 'Cormorant Garamond', serif;
}

.route-pill {
  border: 1px solid #1c1917;
  padding: 0.3rem 0.65rem;
  color: #1c1917;
}

.route-pill:hover {
  background: #1c1917;
  color: #fffbeb;
}

.story-card {
  border: 1px solid #1c1917;
  background: rgba(255, 255, 255, 0.72);
  padding: 1rem;
}

.edition {
  border: 1px solid #1c1917;
  padding: 0.15rem 0.5rem;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.quick-action {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-bottom: 1px solid #1c1917;
  padding-bottom: 0.05rem;
}

.panel {
  border: 1px solid #1c1917;
  background: rgba(255, 255, 255, 0.62);
  padding: 1rem;
}

.submit-link {
  margin-top: 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid #1c1917;
  background: #1c1917;
  color: #fffbeb;
  padding: 0.35rem 0.6rem;
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px dashed rgba(41, 37, 36, 0.35);
  padding-bottom: 0.3rem;
}
</style>
