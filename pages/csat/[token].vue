<template>
  <NuxtLayout name="clean">
    <main class="csat-shell">
      <div class="csat-orbit orbit-one" aria-hidden="true" />
      <div class="csat-orbit orbit-two" aria-hidden="true" />

      <section class="csat-card" aria-live="polite" data-testid="csat-card">
        <div class="csat-brandline">
          <span class="brand-mark"><Icon name="lucide:sparkles" class="h-4 w-4" /></span>
          <span>VEE / FEEDBACK LOOP</span>
          <span class="brand-rule" />
          <span class="brand-live"><span class="live-dot" /> LIVE</span>
        </div>

        <div v-if="isLoading" class="state-panel">
          <Icon name="lucide:loader-2" class="h-8 w-8 animate-spin text-cyan-300" />
          <p>Opening your private feedback link…</p>
        </div>

        <div v-else-if="errorMessage" class="state-panel state-error">
          <Icon name="lucide:link-2-off" class="h-10 w-10" />
          <h1>This link is no longer available</h1>
          <p>{{ errorMessage }}</p>
        </div>

        <div v-else-if="isComplete" class="state-panel state-success" data-testid="csat-thanks">
          <div class="success-glyph"><Icon name="lucide:check" class="h-7 w-7" /></div>
          <p class="eyebrow">SIGNAL RECEIVED</p>
          <h1>Thank you for the clarity.</h1>
          <p>Your response is attached to the support conversation. It helps the team tune the next reply.</p>
        </div>

        <template v-else-if="survey">
          <div class="hero-copy">
            <p class="eyebrow">A QUICK CHECK-IN</p>
            <h1>{{ survey.question }}</h1>
            <p class="hero-subtitle">One tap is all we need. Your answer goes straight to the support team.</p>
          </div>

          <div class="rating-grid" :class="{ 'rating-grid-wide': survey.scale === 'nps_10' }">
            <button
              v-for="rating in ratings"
              :key="rating"
              type="button"
              class="rating-button"
              :class="{ selected: selectedRating === rating, compact: survey.scale === 'nps_10' }"
              :aria-label="`Rate ${ratingLabel(rating)}`"
              :data-testid="`csat-rating-${rating}`"
              :disabled="isSubmitting"
              @click="submitRating(rating)"
            >
              <span class="rating-number">{{ ratingLabel(rating) }}</span>
              <span v-if="survey.scale === 'nps_10'" class="rating-caption">
                {{ rating === 0 ? 'not likely' : rating === 10 ? 'very likely' : '' }}
              </span>
            </button>
          </div>

          <p v-if="submitError" class="form-error">{{ submitError }}</p>
          <p v-if="isSubmitting" class="submit-status">
            <Icon name="lucide:loader-2" class="h-4 w-4 animate-spin" /> Saving your signal…
          </p>

          <form v-if="response?.status === 'comment_open'" class="comment-panel" @submit.prevent="submitComment">
            <div class="comment-heading">
              <div>
                <p class="eyebrow">OPTIONAL FOLLOW-UP</p>
                <h2>{{ survey.followUpQuestion || 'Want to tell us a little more?' }}</h2>
              </div>
              <span class="window-pill">OPEN {{ commentWindowLabel }}</span>
            </div>
            <textarea
              v-model="comment"
              data-testid="csat-comment"
              class="comment-input"
              maxlength="2000"
              rows="4"
              placeholder="The useful details are usually the small ones…"
              aria-label="Follow-up comment"
            />
            <div class="comment-footer">
              <span>{{ comment.length }}/2000</span>
              <button
                type="submit"
                class="comment-submit"
                data-testid="csat-comment-submit"
                :disabled="isSubmitting || !comment.trim()"
              >
                {{ isSubmitting ? 'Sending…' : 'Send note' }}
                <Icon name="lucide:arrow-up-right" class="h-4 w-4" />
              </button>
            </div>
          </form>
        </template>
      </section>

      <p class="privacy-note">
        <Icon name="lucide:lock-keyhole" class="h-3.5 w-3.5" /> Private, one-time response link
      </p>
    </main>
  </NuxtLayout>
</template>

<script setup lang="ts">
type Survey = {
  scale: 'csat_5' | 'thumbs' | 'nps_10'
  question: string
  followUpQuestion: string | null
}

type ResponseState = {
  status: 'pending_rating' | 'comment_open' | 'complete'
  rating: number | null
  comment: string | null
  respondedAt: string | null
  commentWindowEndsAt: string | null
}

type CsatApiPayload = {
  data?: {
    survey?: Survey
    response?: ResponseState
  }
}

const route = useRoute()
const token = String(route.params.token || '')
const isLoading = ref(true)
const errorMessage = ref('')
const submitError = ref('')
const isSubmitting = ref(false)
const survey = ref<Survey | null>(null)
const response = ref<ResponseState | null>(null)
const selectedRating = ref<number | null>(null)
const comment = ref('')

const ratings = computed(() => {
  if (survey.value?.scale === 'thumbs') return [1, 2]
  if (survey.value?.scale === 'nps_10') return Array.from({ length: 11 }, (_, index) => index)
  return [1, 2, 3, 4, 5]
})

const isComplete = computed(() => response.value?.status === 'complete')

const commentWindowLabel = computed(() => {
  if (!response.value?.commentWindowEndsAt) return ''
  const endsAt = new Date(response.value.commentWindowEndsAt).getTime()
  const hours = Math.max(1, Math.ceil((endsAt - Date.now()) / 3_600_000))
  return hours < 24 ? `${hours}H` : `${Math.ceil(hours / 24)}D`
})

function ratingLabel(rating: number) {
  if (survey.value?.scale === 'thumbs') return rating === 2 ? 'Helpful' : 'Not helpful'
  return String(rating)
}

function readResponse(payload: CsatApiPayload) {
  survey.value = payload?.data?.survey || null
  response.value = payload?.data?.response || null
  selectedRating.value = response.value?.rating ?? null
  comment.value = response.value?.comment || ''
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('data' in error)) return fallback
  const data = error.data
  if (typeof data !== 'object' || data === null || !('error' in data)) return fallback
  const details = data.error
  if (typeof details !== 'object' || details === null || !('message' in details)) return fallback
  return typeof details.message === 'string' ? details.message : fallback
}

async function loadSurvey() {
  try {
    const payload = await $fetch<CsatApiPayload>(`/api/public/csat/${encodeURIComponent(token)}`)
    readResponse(payload)
  } catch (error: unknown) {
    errorMessage.value = readErrorMessage(error, 'Please ask the support team for a fresh link.')
  } finally {
    isLoading.value = false
  }
}

async function submitRating(rating: number) {
  if (isSubmitting.value) return
  isSubmitting.value = true
  submitError.value = ''
  try {
    const payload = await $fetch<CsatApiPayload>(`/api/public/csat/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { rating },
    })
    selectedRating.value = rating
    const refreshed = await $fetch<CsatApiPayload>(`/api/public/csat/${encodeURIComponent(token)}`)
    readResponse(refreshed)
    if (!response.value) readResponse(payload)
  } catch (error: unknown) {
    submitError.value = readErrorMessage(error, 'We could not save that signal. Please try again.')
  } finally {
    isSubmitting.value = false
  }
}

async function submitComment() {
  if (isSubmitting.value || !comment.value.trim()) return
  isSubmitting.value = true
  submitError.value = ''
  try {
    await $fetch<CsatApiPayload>(`/api/public/csat/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { comment: comment.value.trim() },
    })
    const refreshed = await $fetch<CsatApiPayload>(`/api/public/csat/${encodeURIComponent(token)}`)
    readResponse(refreshed)
  } catch (error: unknown) {
    submitError.value = readErrorMessage(error, 'We could not save your note. Please try again.')
  } finally {
    isSubmitting.value = false
  }
}

await loadSurvey()
</script>

<style scoped>
.csat-shell {
  --ink: #07141d;
  --panel: rgba(7, 20, 29, 0.88);
  --cyan: #8ff4ff;
  --lime: #c8f56c;
  --muted: #91a8b1;
  position: relative;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 2rem 1rem;
  background: #061019;
  color: #f5fbfc;
  font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
}

.csat-shell::before {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(143, 244, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(143, 244, 255, 0.035) 1px, transparent 1px);
  background-size: 38px 38px;
  content: '';
  mask-image: linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent);
}

.csat-orbit {
  position: absolute;
  border: 1px solid rgba(143, 244, 255, 0.15);
  border-radius: 999px;
  pointer-events: none;
}

.orbit-one {
  width: 46rem;
  height: 46rem;
  transform: translate(42%, -48%) rotate(24deg);
}
.orbit-two {
  width: 32rem;
  height: 32rem;
  transform: translate(-54%, 48%) rotate(-18deg);
  border-color: rgba(200, 245, 108, 0.16);
}

.csat-card {
  position: relative;
  z-index: 1;
  width: min(100%, 42rem);
  border: 1px solid rgba(143, 244, 255, 0.2);
  border-radius: 1.5rem;
  background: var(--panel);
  box-shadow:
    0 28px 90px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px);
  padding: clamp(1.5rem, 5vw, 3rem);
  animation: rise-in 500ms ease-out both;
}

.csat-brandline {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--muted);
  font:
    600 0.68rem/1 'IBM Plex Mono',
    monospace;
  letter-spacing: 0.13em;
}
.brand-mark {
  display: grid;
  height: 1.55rem;
  width: 1.55rem;
  place-items: center;
  border: 1px solid rgba(143, 244, 255, 0.35);
  border-radius: 0.45rem;
  color: var(--cyan);
}
.brand-rule {
  height: 1px;
  flex: 1;
  background: rgba(143, 244, 255, 0.16);
}
.brand-live {
  color: var(--lime);
}
.live-dot {
  display: inline-block;
  height: 0.38rem;
  width: 0.38rem;
  margin-right: 0.25rem;
  border-radius: 999px;
  background: var(--lime);
  box-shadow: 0 0 10px var(--lime);
}
.eyebrow {
  color: var(--cyan);
  font:
    600 0.7rem/1 'IBM Plex Mono',
    monospace;
  letter-spacing: 0.16em;
}
.hero-copy {
  margin: 3rem 0 2rem;
  max-width: 34rem;
}
.hero-copy h1,
.state-panel h1 {
  margin: 0.8rem 0;
  color: #f5fbfc;
  font:
    600 clamp(2rem, 6vw, 3.6rem)/0.98 'DM Serif Display',
    Georgia,
    serif;
  letter-spacing: -0.035em;
}
.hero-subtitle,
.state-panel p {
  max-width: 31rem;
  color: var(--muted);
  font-size: 0.98rem;
  line-height: 1.6;
}
.rating-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.65rem;
}
.rating-grid-wide {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.rating-button {
  display: flex;
  min-height: 5.7rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  border: 1px solid rgba(143, 244, 255, 0.18);
  border-radius: 0.8rem;
  background: rgba(255, 255, 255, 0.035);
  color: #f5fbfc;
  cursor: pointer;
  transition: 180ms ease;
}
.rating-button:hover,
.rating-button:focus-visible {
  border-color: var(--cyan);
  background: rgba(143, 244, 255, 0.11);
  transform: translateY(-3px);
}
.rating-button.selected {
  border-color: var(--lime);
  background: rgba(200, 245, 108, 0.15);
  color: var(--lime);
  box-shadow: 0 0 0 3px rgba(200, 245, 108, 0.08);
}
.rating-button.compact {
  min-height: 4.7rem;
}
.rating-number {
  font:
    600 1.4rem/1 'IBM Plex Mono',
    monospace;
}
.rating-caption {
  color: var(--muted);
  font:
    0.55rem/1 'IBM Plex Mono',
    monospace;
  text-transform: uppercase;
}
.comment-panel {
  margin-top: 2.5rem;
  border-top: 1px solid rgba(143, 244, 255, 0.15);
  padding-top: 1.4rem;
  animation: rise-in 400ms ease-out both;
}
.comment-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.comment-heading h2 {
  margin-top: 0.5rem;
  color: #f5fbfc;
  font-size: 1.05rem;
  font-weight: 600;
}
.window-pill {
  flex: none;
  border: 1px solid rgba(200, 245, 108, 0.34);
  border-radius: 999px;
  padding: 0.35rem 0.55rem;
  color: var(--lime);
  font:
    600 0.58rem/1 'IBM Plex Mono',
    monospace;
  letter-spacing: 0.08em;
}
.comment-input {
  display: block;
  width: 100%;
  margin-top: 1rem;
  resize: vertical;
  border: 1px solid rgba(143, 244, 255, 0.16);
  border-radius: 0.75rem;
  background: rgba(0, 0, 0, 0.18);
  padding: 0.9rem;
  color: #f5fbfc;
  outline: none;
}
.comment-input:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 0 3px rgba(143, 244, 255, 0.08);
}
.comment-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.65rem;
  color: var(--muted);
  font:
    0.68rem/1 'IBM Plex Mono',
    monospace;
}
.comment-submit {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 0;
  border-radius: 999px;
  background: var(--lime);
  padding: 0.65rem 0.9rem;
  color: var(--ink);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 180ms ease,
    filter 180ms ease;
}
.comment-submit:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-2px);
}
.comment-submit:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.state-panel {
  display: grid;
  min-height: 24rem;
  place-items: center;
  align-content: center;
  gap: 0.8rem;
  text-align: center;
}
.state-panel h1 {
  max-width: 28rem;
  font-size: clamp(2rem, 7vw, 3.2rem);
}
.state-panel p {
  margin: 0;
}
.state-error {
  color: #ff9b9b;
}
.state-success {
  color: var(--cyan);
}
.success-glyph {
  display: grid;
  height: 4rem;
  width: 4rem;
  place-items: center;
  border: 1px solid rgba(200, 245, 108, 0.5);
  border-radius: 1rem;
  background: rgba(200, 245, 108, 0.12);
  color: var(--lime);
}
.form-error {
  margin-top: 0.9rem;
  color: #ff9b9b;
  font-size: 0.84rem;
}
.submit-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin-top: 0.9rem;
  color: var(--muted);
  font-size: 0.8rem;
}
.privacy-note {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 1.2rem;
  color: rgba(145, 168, 177, 0.75);
  font:
    0.67rem/1 'IBM Plex Mono',
    monospace;
  letter-spacing: 0.05em;
}
@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 520px) {
  .csat-card {
    border-radius: 1.1rem;
    padding: 1.35rem;
  }
  .csat-brandline {
    font-size: 0.58rem;
  }
  .rating-grid {
    gap: 0.4rem;
  }
  .rating-button {
    min-height: 4.7rem;
  }
  .rating-grid-wide {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .rating-number {
    font-size: 1.1rem;
  }
  .comment-heading {
    flex-direction: column;
  }
}
</style>
