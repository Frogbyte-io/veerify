<template>
  <main class="design-three min-h-screen px-4 py-8 sm:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <header class="header-shell">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-amber-200/80">Concept 03</p>
            <h1 class="mt-2 text-3xl font-semibold text-white sm:text-4xl">Orbit Ops Feedback</h1>
            <p class="mt-2 max-w-2xl text-sm text-slate-300">Mission-control board for public voting and delivery tracking.</p>
          </div>
          <nav class="flex items-center gap-2 text-xs">
            <NuxtLink v-for="route in routes" :key="route" :to="`/${route}`" class="route-link">/{{ route }}</NuxtLink>
          </nav>
        </div>
      </header>

      <section class="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <aside class="space-y-4">
          <article class="panel">
            <p class="panel-kicker">Launch Input</p>
            <h2 class="panel-title">Submit new feedback signal</h2>
            <p class="panel-copy">Route bug reports and feature requests into the mission backlog.</p>
            <button class="launch-btn">
              <Icon name="lucide:rocket" class="h-4 w-4" />
              Open Intake
            </button>
          </article>

          <article class="panel">
            <p class="panel-kicker">Telemetry</p>
            <ul class="space-y-2 text-sm text-slate-200">
              <li class="metric-row">
                <span>Votes Today</span>
                <strong>+447</strong>
              </li>
              <li class="metric-row">
                <span>New Threads</span>
                <strong>31</strong>
              </li>
              <li class="metric-row">
                <span>Resolved This Week</span>
                <strong>19</strong>
              </li>
            </ul>
          </article>
        </aside>

        <section class="grid gap-4 md:grid-cols-3">
          <article v-for="lane in lanes" :key="lane.id" class="lane">
            <div class="lane-head">
              <h2 class="text-sm uppercase tracking-[0.18em] text-amber-100">{{ lane.name }}</h2>
              <span class="count">{{ lane.items.length }}</span>
            </div>
            <div class="mt-3 space-y-3">
              <article v-for="item in lane.items" :key="item.id" class="thread">
                <p class="text-sm font-medium text-white">{{ item.title }}</p>
                <p class="mt-1 text-xs text-slate-300">{{ item.summary }}</p>
                <div class="mt-3 flex items-center justify-between text-xs text-slate-300">
                  <span class="inline-flex items-center gap-1">
                    <Icon name="lucide:triangle" class="h-3.5 w-3.5" />
                    {{ item.votes }}
                  </span>
                  <span class="inline-flex items-center gap-1">
                    <Icon name="lucide:message-circle" class="h-3.5 w-3.5" />
                    {{ item.comments }}
                  </span>
                </div>
              </article>
            </div>
          </article>
        </section>
      </section>
    </div>
  </main>
</template>

<script>
export default {
  name: 'DesignThreePage',
  data() {
    return {
      routes: [1, 2, 3, 4, 5],
      lanes: [
        {
          id: 'queued',
          name: 'Queued',
          items: [
            {
              id: 'c1',
              title: 'Dark mode contrast fix for tag chips',
              summary: 'Tag labels are hard to read on OLED displays.',
              votes: 66,
              comments: 14,
            },
            {
              id: 'c2',
              title: 'Export comments as markdown',
              summary: 'Needed for weekly product review docs.',
              votes: 41,
              comments: 7,
            },
          ],
        },
        {
          id: 'building',
          name: 'Building',
          items: [
            {
              id: 'c3',
              title: 'Downvote support on public board',
              summary: 'Separate enthusiasm from priority using two-way voting.',
              votes: 122,
              comments: 29,
            },
            {
              id: 'c4',
              title: 'Team mentions in board comments',
              summary: 'Tag product leads directly from feedback discussions.',
              votes: 89,
              comments: 12,
            },
          ],
        },
        {
          id: 'released',
          name: 'Released',
          items: [
            {
              id: 'c5',
              title: 'Public roadmap tab',
              summary: 'Visitors can now track shipped items from the board.',
              votes: 198,
              comments: 33,
            },
          ],
        },
      ],
    }
  },
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap');

.design-three {
  font-family: 'Rajdhani', sans-serif;
  background:
    radial-gradient(circle at 15% 10%, rgba(245, 158, 11, 0.2), transparent 35%),
    radial-gradient(circle at 85% 0%, rgba(14, 165, 233, 0.2), transparent 32%),
    #060b1a;
}

.header-shell,
.panel,
.lane {
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.68);
  border-radius: 1rem;
  padding: 1rem;
}

.route-link {
  border: 1px solid rgba(245, 158, 11, 0.5);
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  color: #fde68a;
}

.route-link:hover {
  background: rgba(245, 158, 11, 0.2);
}

.panel-kicker {
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(252, 211, 77, 0.8);
}

.panel-title {
  margin-top: 0.25rem;
  font-size: 1.25rem;
  color: #fff;
}

.panel-copy {
  margin-top: 0.45rem;
  font-size: 0.9rem;
  color: #cbd5e1;
}

.launch-btn {
  margin-top: 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgba(252, 211, 77, 0.45);
  border-radius: 999px;
  background: rgba(217, 119, 6, 0.22);
  color: #fef3c7;
  padding: 0.4rem 0.85rem;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.35);
  padding-bottom: 0.35rem;
}

.lane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.count {
  border: 1px solid rgba(252, 211, 77, 0.45);
  border-radius: 999px;
  color: #fde68a;
  padding: 0.1rem 0.45rem;
  font-size: 0.75rem;
}

.thread {
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 0.8rem;
  background: rgba(2, 6, 23, 0.45);
  padding: 0.7rem;
}
</style>
