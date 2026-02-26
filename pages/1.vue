<template>
  <main class="design-one min-h-screen overflow-hidden px-4 py-8 sm:px-8">
    <div class="mx-auto max-w-6xl space-y-8">
      <header class="rounded-3xl border border-cyan-300/30 bg-slate-900/70 p-6 backdrop-blur">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.32em] text-cyan-200/70">Concept 01</p>
            <h1 class="mt-2 text-3xl font-semibold text-cyan-50 sm:text-4xl">Signal Grid Feedback</h1>
            <p class="mt-2 max-w-xl text-sm text-cyan-100/70">
              A high-energy public board for bugs, ideas, and praise with live vote momentum.
            </p>
          </div>
          <nav class="flex items-center gap-2 text-xs font-medium">
            <NuxtLink v-for="route in routes" :key="route" :to="`/${route}`" class="route-chip">
              /{{ route }}
            </NuxtLink>
          </nav>
        </div>
      </header>

      <section class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <article class="rounded-3xl border border-cyan-300/30 bg-slate-900/70 p-6 backdrop-blur">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-cyan-50">Live Queue</h2>
            <button class="submit-btn">
              <Icon name="lucide:sparkles" class="h-4 w-4" />
              Submit Feedback
            </button>
          </div>
          <div class="mt-5 space-y-4">
            <article v-for="item in feedbackItems" :key="item.id" class="feedback-card">
              <div class="vote-rail">
                <button class="vote-btn" aria-label="Upvote">
                  <Icon name="lucide:arrow-up" class="h-4 w-4" />
                </button>
                <p class="vote-count">{{ item.votes }}</p>
                <button class="vote-btn" aria-label="Downvote">
                  <Icon name="lucide:arrow-down" class="h-4 w-4" />
                </button>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-base font-semibold text-cyan-50">{{ item.title }}</h3>
                  <span class="tag">{{ item.type }}</span>
                </div>
                <p class="mt-2 text-sm text-cyan-100/70">{{ item.summary }}</p>
                <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-cyan-100/70">
                  <span class="inline-flex items-center gap-1">
                    <Icon name="lucide:message-square" class="h-3.5 w-3.5" />
                    {{ item.comments }} comments
                  </span>
                  <span class="inline-flex items-center gap-1">
                    <Icon name="lucide:dot" class="h-3.5 w-3.5" />
                    {{ item.status }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </article>

        <aside class="space-y-6">
          <article class="rounded-3xl border border-cyan-300/30 bg-slate-900/70 p-6 backdrop-blur">
            <h2 class="text-sm uppercase tracking-[0.2em] text-cyan-100/70">Pulse</h2>
            <div class="mt-4 grid grid-cols-2 gap-3 text-cyan-50">
              <div class="stat-card">
                <p class="text-xs text-cyan-100/70">Open</p>
                <p class="mt-1 text-2xl font-semibold">42</p>
              </div>
              <div class="stat-card">
                <p class="text-xs text-cyan-100/70">In Progress</p>
                <p class="mt-1 text-2xl font-semibold">11</p>
              </div>
              <div class="stat-card">
                <p class="text-xs text-cyan-100/70">Released</p>
                <p class="mt-1 text-2xl font-semibold">108</p>
              </div>
              <div class="stat-card">
                <p class="text-xs text-cyan-100/70">Contributors</p>
                <p class="mt-1 text-2xl font-semibold">1.7k</p>
              </div>
            </div>
          </article>

          <article class="rounded-3xl border border-cyan-300/30 bg-slate-900/70 p-6 backdrop-blur">
            <h2 class="text-sm uppercase tracking-[0.2em] text-cyan-100/70">Top Thread</h2>
            <p class="mt-3 text-lg font-semibold text-cyan-50">Offline mode with smart conflict sync</p>
            <p class="mt-2 text-sm text-cyan-100/70">
              368 voters are asking for full local drafts with conflict-safe merge when reconnecting.
            </p>
          </article>
        </aside>
      </section>
    </div>
  </main>
</template>

<script>
export default {
  name: 'DesignOnePage',
  data() {
    return {
      routes: [1, 2, 3, 4, 5],
      feedbackItems: [
        {
          id: 'a1',
          title: 'Crash when importing 2GB CSV',
          summary: 'App freezes near 78% import; reproducible in Chrome and Edge on Windows.',
          type: 'bug',
          votes: 94,
          comments: 17,
          status: 'Triaging',
        },
        {
          id: 'a2',
          title: 'Batch edit tags from board view',
          summary: 'Need multi-select + keyboard shortcuts for faster backlog cleanup.',
          type: 'feature',
          votes: 73,
          comments: 9,
          status: 'Planned',
        },
        {
          id: 'a3',
          title: 'The new timeline view feels great',
          summary: 'Clean visual flow and better context for long-running tickets. Nice work.',
          type: 'praise',
          votes: 41,
          comments: 6,
          status: 'Acknowledged',
        },
      ],
    }
  },
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&display=swap');

.design-one {
  font-family: 'Chakra Petch', sans-serif;
  background:
    radial-gradient(circle at 10% 0%, rgba(34, 211, 238, 0.22), transparent 40%),
    radial-gradient(circle at 90% 20%, rgba(45, 212, 191, 0.22), transparent 40%),
    #050914;
}

.route-chip {
  border: 1px solid rgba(165, 243, 252, 0.35);
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  color: rgba(207, 250, 254, 0.9);
  transition: 0.2s ease;
}

.route-chip:hover {
  background: rgba(34, 211, 238, 0.18);
}

.submit-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid rgba(45, 212, 191, 0.4);
  border-radius: 999px;
  background: linear-gradient(120deg, rgba(8, 47, 73, 0.9), rgba(15, 118, 110, 0.75));
  color: #cffafe;
  padding: 0.45rem 0.9rem;
  font-size: 0.8rem;
}

.feedback-card {
  display: flex;
  gap: 1rem;
  border: 1px solid rgba(103, 232, 249, 0.24);
  border-radius: 1rem;
  background: rgba(7, 27, 43, 0.5);
  padding: 1rem;
}

.vote-rail {
  display: flex;
  width: 3.15rem;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid rgba(45, 212, 191, 0.25);
  border-radius: 0.8rem;
  background: rgba(8, 47, 73, 0.45);
  padding: 0.45rem;
}

.vote-btn {
  border-radius: 0.6rem;
  padding: 0.15rem;
  color: rgba(165, 243, 252, 0.9);
}

.vote-btn:hover {
  background: rgba(34, 211, 238, 0.2);
}

.vote-count {
  font-size: 0.95rem;
  font-weight: 700;
  color: #ecfeff;
}

.tag {
  border: 1px solid rgba(45, 212, 191, 0.45);
  border-radius: 999px;
  padding: 0.2rem 0.5rem;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(153, 246, 228, 0.95);
}

.stat-card {
  border: 1px solid rgba(103, 232, 249, 0.22);
  border-radius: 0.95rem;
  background: rgba(8, 47, 73, 0.45);
  padding: 0.75rem;
}
</style>
