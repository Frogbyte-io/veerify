<template>
  <main class="design-five min-h-screen px-4 py-8 sm:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <header class="hero">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.2em]">Concept 05</p>
            <h1 class="mt-2 text-4xl font-black leading-none sm:text-5xl">Feedback Playground</h1>
            <p class="mt-3 max-w-2xl text-sm">
              Bold, loud, and impossible to ignore. Votes and comments become visual noise with intent.
            </p>
          </div>
          <nav class="flex items-center gap-2 text-xs font-bold">
            <NuxtLink v-for="route in routes" :key="route" :to="`/${route}`" class="route-box">/{{ route }}</NuxtLink>
          </nav>
        </div>
      </header>

      <section class="grid gap-4 md:grid-cols-12">
        <article class="tile md:col-span-4 bg-lime-300">
          <p class="tile-kicker">Drop a thought</p>
          <h2 class="text-2xl font-black">What should we build next?</h2>
          <button class="action black">
            <Icon name="lucide:megaphone" class="h-4 w-4" />
            Submit Feedback
          </button>
        </article>

        <article class="tile md:col-span-8 bg-cyan-300">
          <p class="tile-kicker">Board Health</p>
          <div class="mt-3 grid gap-3 sm:grid-cols-3">
            <div class="chunk">
              <p class="text-xs">Open</p>
              <p class="text-3xl font-black">29</p>
            </div>
            <div class="chunk">
              <p class="text-xs">Closed</p>
              <p class="text-3xl font-black">412</p>
            </div>
            <div class="chunk">
              <p class="text-xs">Comment Rate</p>
              <p class="text-3xl font-black">84%</p>
            </div>
          </div>
        </article>

        <article v-for="item in items" :key="item.id" class="tile rotate-note" :class="item.bgClass">
          <div class="flex items-center justify-between">
            <p class="tile-kicker">{{ item.type }}</p>
            <span class="status">{{ item.status }}</span>
          </div>
          <h3 class="mt-2 text-xl font-black leading-tight">{{ item.title }}</h3>
          <p class="mt-2 text-sm">{{ item.summary }}</p>
          <div class="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold">
            <button class="vote-pill">
              <Icon name="lucide:arrow-up" class="h-3.5 w-3.5" />
              {{ item.up }}
            </button>
            <button class="vote-pill">
              <Icon name="lucide:arrow-down" class="h-3.5 w-3.5" />
              {{ item.down }}
            </button>
            <span class="inline-flex items-center gap-1">
              <Icon name="lucide:message-circle" class="h-3.5 w-3.5" />
              {{ item.comments }}
            </span>
          </div>
        </article>
      </section>
    </div>
  </main>
</template>

<script>
export default {
  name: 'DesignFivePage',
  data() {
    return {
      routes: [1, 2, 3, 4, 5],
      items: [
        {
          id: 'e1',
          type: 'Bug',
          title: 'Keyboard shortcut panel closes mid-edit',
          summary: 'Shortcut palette disappears if focus changes after selecting a key combo.',
          up: 54,
          down: 3,
          comments: 16,
          status: 'Open',
          bgClass: 'md:col-span-6 bg-rose-300',
        },
        {
          id: 'e2',
          type: 'Feature',
          title: 'Board templates by industry',
          summary: 'Need starter boards for SaaS, gaming, and ecommerce launch teams.',
          up: 117,
          down: 8,
          comments: 21,
          status: 'Planned',
          bgClass: 'md:col-span-3 bg-amber-300',
        },
        {
          id: 'e3',
          type: 'Praise',
          title: 'Comment moderation controls are excellent now',
          summary: 'The hide/unhide flow finally feels lightweight and intuitive.',
          up: 38,
          down: 1,
          comments: 4,
          status: 'Noted',
          bgClass: 'md:col-span-3 bg-fuchsia-300',
        },
        {
          id: 'e4',
          type: 'Feature',
          title: 'Downvote reasons for product teams',
          summary: 'Collect why users disagree, not only that they disagree.',
          up: 91,
          down: 12,
          comments: 26,
          status: 'In Review',
          bgClass: 'md:col-span-12 bg-orange-300',
        },
      ],
    }
  },
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@500;700&display=swap');

.design-five {
  font-family: 'Space Grotesk', sans-serif;
  background:
    radial-gradient(circle at 18% 6%, rgba(254, 240, 138, 0.8), transparent 25%),
    radial-gradient(circle at 88% 14%, rgba(125, 211, 252, 0.8), transparent 28%),
    #fffbe6;
  color: #111827;
}

.hero,
.tile {
  border: 3px solid #111827;
  box-shadow: 6px 6px 0 #111827;
  border-radius: 0.9rem;
}

.hero {
  background: #ffffff;
  padding: 1rem;
}

h1,
h2,
h3 {
  font-family: 'Archivo Black', sans-serif;
}

.route-box {
  border: 2px solid #111827;
  background: #fff;
  padding: 0.25rem 0.55rem;
}

.route-box:hover {
  transform: translate(-1px, -1px);
}

.tile {
  padding: 1rem;
}

.tile-kicker {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.action.black {
  margin-top: 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 2px solid #111827;
  background: #111827;
  color: #fff;
  padding: 0.4rem 0.8rem;
  font-weight: 700;
}

.chunk {
  border: 2px solid #111827;
  background: #fff;
  padding: 0.6rem;
}

.rotate-note:nth-child(odd) {
  transform: rotate(-0.6deg);
}

.rotate-note:nth-child(even) {
  transform: rotate(0.5deg);
}

.status {
  border: 2px solid #111827;
  background: #fff;
  padding: 0.1rem 0.5rem;
  font-size: 0.66rem;
  font-weight: 700;
}

.vote-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border: 2px solid #111827;
  background: #fff;
  padding: 0.15rem 0.45rem;
}
</style>
