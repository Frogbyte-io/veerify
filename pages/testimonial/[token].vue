<template>
  <NuxtLayout name="clean">
    <main data-testid="testimonial-page">
      <AuthCard v-if="isLoading" wide title="Your testimonial" data-testid="testimonial-loading">
        <div class="space-y-4">
          <Skeleton class="h-8 w-2/3" />
          <Skeleton class="h-24 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
      </AuthCard>

      <AuthCard v-else-if="invalid" wide title="This link is not valid" data-testid="testimonial-invalid">
        <div class="space-y-2 text-center">
          <Icon name="lucide:link-2-off" class="mx-auto h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            It may have been mistyped or is no longer available. Use the link from your email.
          </p>
        </div>
      </AuthCard>

      <AuthCard v-else-if="loadError" wide title="Something went wrong" data-testid="testimonial-error">
        <div class="space-y-3 text-center">
          <p class="text-sm text-destructive">{{ loadError }}</p>
          <Button variant="outline" size="sm" @click="load">Retry</Button>
        </div>
      </AuthCard>

      <AuthCard
        v-else-if="(done || info.alreadySubmitted) && isWithdrawn"
        wide
        title="Your testimonial has been removed from the public page"
        data-testid="testimonial-thanks"
      >
        <div class="space-y-2 text-center">
          <Icon name="lucide:eye-off" class="mx-auto h-8 w-8 text-muted-foreground" />
          <p
            ref="status"
            tabindex="-1"
            class="text-sm text-muted-foreground outline-none"
            role="status"
            data-testid="testimonial-withdrawn"
          >
            {{ info.productName }} still holds it privately. Contact them if you would like it deleted.
          </p>
        </div>
      </AuthCard>

      <AuthCard
        v-else-if="done || info.alreadySubmitted"
        wide
        :title="'Thank you' + (info.firstName ? ', ' + info.firstName : '') + '!'"
        data-testid="testimonial-thanks"
      >
        <div class="space-y-2 text-center">
          <Icon name="lucide:heart" class="mx-auto h-8 w-8 text-primary" />
          <p class="text-sm text-muted-foreground">
            {{ done ? 'Your testimonial was received.' : 'You already sent a testimonial with this link.' }}
            {{ info.productName }} will review it before anything is shown publicly.
          </p>
          <div class="pt-3" data-testid="testimonial-withdraw">
            <p v-if="confirmingWithdraw" class="mb-2 text-sm text-muted-foreground">
              Remove your testimonial from the public page? You can still contact us to have it deleted.
            </p>
            <div class="flex justify-center gap-2">
              <Button
                v-if="confirmingWithdraw"
                size="sm"
                :disabled="withdrawing"
                data-testid="testimonial-withdraw-confirm"
                @click="withdraw"
              >
                <Icon v-if="withdrawing" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
                Yes, remove it
              </Button>
              <Button
                v-if="confirmingWithdraw"
                size="sm"
                variant="outline"
                :disabled="withdrawing"
                @click="confirmingWithdraw = false"
              >
                Cancel
              </Button>
              <button
                v-else
                type="button"
                class="text-xs text-muted-foreground underline"
                data-testid="testimonial-withdraw-link"
                @click="confirmingWithdraw = true"
              >
                Remove my testimonial from the public page
              </button>
            </div>
            <p v-if="withdrawError" class="mt-2 text-sm text-destructive" role="alert">{{ withdrawError }}</p>
          </div>
        </div>
      </AuthCard>

      <AuthCard
        v-else-if="!info.canSubmit"
        wide
        title="This link is no longer accepting testimonials"
        data-testid="testimonial-closed"
      >
        <div class="space-y-2 text-center">
          <Icon name="lucide:clock" class="mx-auto h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            It may have expired. You are welcome to contact {{ info.productName }} directly.
          </p>
        </div>
      </AuthCard>

      <AuthCard v-else wide :title="'Share your experience with ' + info.productName">
        <p class="mb-4 text-sm text-muted-foreground">
          {{ info.firstName ? `Hi ${info.firstName}, a` : 'A' }} few honest words help other people decide. It takes
          about a minute.
        </p>
        <form class="space-y-4" novalidate @submit.prevent="submit">
          <div>
            <Label for="testimonial-quote">Your testimonial</Label>
            <Textarea
              id="testimonial-quote"
              v-model="form.quote"
              rows="5"
              maxlength="1000"
              class="mt-1"
              :disabled="submitting"
              data-testid="testimonial-quote"
            />
            <p class="mt-1 text-xs text-muted-foreground">{{ form.quote.trim().length }} / 1000 (at least 20)</p>
          </div>

          <div>
            <Label for="testimonial-name">Your name</Label>
            <Input
              id="testimonial-name"
              v-model="form.authorName"
              maxlength="80"
              class="mt-1"
              :disabled="submitting"
              data-testid="testimonial-name"
            />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <Label for="testimonial-title">Job title (optional)</Label>
              <Input
                id="testimonial-title"
                v-model="form.authorTitle"
                maxlength="80"
                class="mt-1"
                :disabled="submitting"
              />
            </div>
            <div>
              <Label for="testimonial-company">Company (optional)</Label>
              <Input
                id="testimonial-company"
                v-model="form.authorCompany"
                maxlength="80"
                class="mt-1"
                :disabled="submitting"
              />
            </div>
          </div>

          <div>
            <p class="text-sm font-medium">Rating (optional)</p>
            <div class="mt-1 flex gap-1" role="radiogroup" aria-label="Rating">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="form.rating === n"
                :aria-label="`${n} out of 5`"
                class="rounded p-1"
                :disabled="submitting"
                @click="form.rating = form.rating === n ? null : n"
              >
                <Icon
                  name="lucide:star"
                  mode="svg"
                  class="h-6 w-6"
                  :class="n <= (form.rating || 0) ? 'text-amber-500 [&_path]:fill-amber-400' : 'text-muted-foreground'"
                />
              </button>
            </div>
          </div>

          <label class="flex items-start gap-2 text-sm">
            <input
              v-model="form.consentPublic"
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-input"
              :disabled="submitting"
              data-testid="testimonial-consent"
            />
            <span>
              {{ info.productName }} may show this testimonial publicly, with my name, title and company.
              <span class="block text-xs text-muted-foreground">
                Leave unticked to keep it private. Your email address is never shown.
              </span>
            </span>
          </label>

          <p v-if="submitError" class="text-sm text-destructive" role="alert" data-testid="testimonial-submit-error">
            {{ submitError }}
          </p>

          <Button type="submit" :disabled="submitting" data-testid="testimonial-submit">
            <Icon v-if="submitting" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
            Send testimonial
          </Button>
        </form>
      </AuthCard>
    </main>
  </NuxtLayout>
</template>

<script>
import { apiErrorDetails, apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'TestimonialPage',

  data() {
    return {
      isLoading: true,
      invalid: false,
      loadError: null,
      info: { productName: '', firstName: null, alreadySubmitted: false, canSubmit: true },
      form: { quote: '', authorName: '', authorTitle: '', authorCompany: '', rating: null, consentPublic: false },
      submitting: false,
      submitError: null,
      done: false,
      confirmingWithdraw: false,
      withdrawing: false,
      withdrawn: false,
      withdrawError: null,
    }
  },

  computed: {
    isWithdrawn() {
      return this.withdrawn || this.info.withdrawn === true
    },
    pageTitle() {
      if (this.isLoading) return 'Your testimonial'
      if (this.invalid) return 'Link not valid'
      if (this.loadError) return 'Something went wrong'
      if (this.isWithdrawn) return 'Testimonial removed'
      if (this.done || this.info.alreadySubmitted) return 'Thank you'
      if (!this.info.canSubmit) return 'Link no longer accepting testimonials'
      return `Share your experience with ${this.info.productName}`
    },
    token() {
      return String(this.$route.params.token || '')
    },
  },

  created() {
    useHead({ title: () => this.pageTitle })
  },

  async mounted() {
    await this.load()
    // The email footer links here with ?withdraw=1; nothing is changed until the person confirms.
    if (this.$route.query.withdraw && this.info.alreadySubmitted) this.confirmingWithdraw = true
  },

  methods: {
    async load() {
      this.isLoading = true
      this.loadError = null
      this.invalid = false
      try {
        const response = await $fetch(`/api/marketing/r/${encodeURIComponent(this.token)}`)
        this.info = response.data
      } catch (err) {
        if (apiErrorStatus(err) === 404) this.invalid = true
        else this.loadError = apiErrorMessage(err, 'Something went wrong. Please try again.')
      } finally {
        this.isLoading = false
      }
    },

    async withdraw() {
      this.withdrawing = true
      this.withdrawError = null
      try {
        await $fetch(`/api/marketing/r/${encodeURIComponent(this.token)}/withdraw`, { method: 'POST' })
        this.withdrawn = true
        this.$nextTick(() => this.$refs.status?.focus())
      } catch (err) {
        this.withdrawError = apiErrorMessage(err, 'Could not remove your testimonial. Please try again.')
      } finally {
        this.withdrawing = false
      }
    },

    validate() {
      const quote = this.form.quote.trim()
      if (!this.form.authorName.trim()) return 'Please enter your name'
      if (quote.length < 20) return 'Please write at least 20 characters'
      if (quote.length > 1000) return 'Please keep it under 1000 characters'
      return null
    },

    async submit() {
      const problem = this.validate()
      if (problem) {
        this.submitError = problem
        return
      }
      this.submitting = true
      this.submitError = null
      try {
        await $fetch(`/api/marketing/r/${encodeURIComponent(this.token)}/testimonial`, {
          method: 'POST',
          body: {
            authorName: this.form.authorName,
            authorTitle: this.form.authorTitle,
            authorCompany: this.form.authorCompany,
            quote: this.form.quote,
            ...(this.form.rating ? { rating: this.form.rating } : {}),
            consentPublic: this.form.consentPublic === true,
          },
        })
        this.done = true
      } catch (err) {
        const status = apiErrorStatus(err)
        if (status === 409) {
          this.info = { ...this.info, alreadySubmitted: true }
        } else if (status === 410) {
          this.info = { ...this.info, canSubmit: false }
        } else if (status === 404) {
          this.invalid = true
        } else {
          const details = apiErrorDetails(err)
          const detail = Array.isArray(details) ? details.find((issue) => issue?.message)?.message : null
          this.submitError = detail || apiErrorMessage(err, 'Could not send your testimonial. Please try again.')
        }
      } finally {
        this.submitting = false
      }
    },
  },
}
</script>
