<template>
  <NuxtLayout name="clean">
    <AuthCard title="Connect an agent" description="Approve or deny a device login request">
      <div class="grid gap-6" data-testid="device-page">
        <div v-if="isLoading" class="grid gap-3" data-testid="device-loading">
          <Skeleton class="h-6 w-3/4 mx-auto" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-10 w-1/2 mx-auto" />
          <Skeleton class="h-9 w-full" />
        </div>

        <div v-else-if="result" class="text-center grid gap-2" data-testid="device-result">
          <Icon
            :name="result === 'approved' ? 'lucide:circle-check' : 'lucide:circle-x'"
            class="mx-auto h-8 w-8"
            :class="result === 'approved' ? 'text-primary' : 'text-muted-foreground'"
          />
          <p v-if="result === 'approved'" class="text-sm">Approved — you can close this tab and return to the agent.</p>
          <p v-else class="text-sm">Denied.</p>
        </div>

        <div v-else-if="request" class="grid gap-4" data-testid="device-request">
          <h2 class="text-lg font-semibold text-center">
            <strong data-testid="device-client-name">{{ clientDisplayName }}</strong> wants to act as you in Veerify
          </h2>
          <p class="text-sm text-muted-foreground text-center">
            It will be able to do anything you can do. You can revoke it any time in Settings → API keys.
          </p>
          <p class="text-sm font-medium text-center">Only approve if you started this request yourself.</p>
          <p data-testid="device-user-code" class="text-center font-mono text-3xl tracking-widest">
            {{ request.userCode }}
          </p>

          <p v-if="isExpired" class="text-sm text-destructive text-center" role="alert" data-testid="device-expired">
            This code has expired. Ask the agent for a new one.
          </p>
          <p v-else class="text-xs text-muted-foreground text-center">
            Expires in <span data-testid="device-countdown">{{ countdownText }}</span>
          </p>

          <div v-if="actionError" class="text-center grid gap-2" role="alert" data-testid="device-action-error">
            <p class="text-sm text-destructive">{{ actionError }}</p>
            <NuxtLink v-if="actionErrorIsCap" to="/settings#api-keys" class="text-sm underline underline-offset-4">
              Manage API keys
            </NuxtLink>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <Button data-testid="device-allow" :disabled="isExpired || !!isSubmitting" @click="submit('approve')">
              <Icon v-if="isSubmitting === 'approve'" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Allow
            </Button>
            <Button
              data-testid="device-deny"
              variant="outline"
              :disabled="isExpired || !!isSubmitting"
              @click="submit('deny')"
            >
              <Icon v-if="isSubmitting === 'deny'" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Deny
            </Button>
          </div>
        </div>

        <form v-else class="grid gap-4" data-testid="device-entry" @submit.prevent="continueWithInput">
          <div v-if="loadError" class="grid gap-2 text-center" role="alert" data-testid="device-load-error">
            <p class="text-sm text-destructive">{{ loadError }}</p>
            <Button v-if="canRetry" type="button" variant="outline" size="sm" @click="lookup(code)">Retry</Button>
          </div>
          <div class="grid gap-3">
            <Label for="device-code-input">Code</Label>
            <Input
              id="device-code-input"
              v-model="codeInput"
              data-testid="device-code-input"
              class="font-mono tracking-widest text-center"
              placeholder="XXXX-XXXX"
              maxlength="9"
              autocomplete="off"
            />
          </div>
          <Button type="submit" data-testid="device-continue" :disabled="!codeInput.trim()">Continue</Button>
        </form>
      </div>
    </AuthCard>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
const INVALID_CODE_MESSAGE = 'This code is invalid or has expired. Ask the agent for a new one.'

function formatUserCode(raw) {
  const chars = String(raw || '')
    .toUpperCase()
    .split('')
    .filter((char) => CODE_ALPHABET.includes(char))
    .slice(0, 8)
    .join('')
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars
}

export default {
  name: 'DevicePage',
  data() {
    return {
      codeInput: '',
      code: '',
      isLoading: false,
      loadError: '',
      canRetry: false,
      request: null,
      result: null,
      isSubmitting: null,
      actionError: '',
      actionErrorIsCap: false,
      now: Date.now(),
      timer: null,
    }
  },
  computed: {
    clientDisplayName() {
      return this.request?.clientName || 'An agent'
    },
    remainingMs() {
      if (!this.request?.expiresAt) return 0
      return Math.max(0, new Date(this.request.expiresAt).getTime() - this.now)
    },
    isExpired() {
      return this.remainingMs <= 0
    },
    countdownText() {
      const total = Math.ceil(this.remainingMs / 1000)
      const minutes = String(Math.floor(total / 60)).padStart(2, '0')
      const seconds = String(total % 60).padStart(2, '0')
      return `${minutes}:${seconds}`
    },
  },
  mounted() {
    const raw = this.$route.query.code
    const code = formatUserCode(typeof raw === 'string' ? raw : '')
    if (code) {
      this.codeInput = code
      this.lookup(code)
    }
  },
  beforeUnmount() {
    this.stopTimer()
  },
  methods: {
    startTimer() {
      this.stopTimer()
      this.now = Date.now()
      this.timer = setInterval(() => {
        this.now = Date.now()
      }, 1000)
    },
    stopTimer() {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    },
    continueWithInput() {
      const code = formatUserCode(this.codeInput)
      if (!code) return
      this.codeInput = code
      this.lookup(code)
    },
    async lookup(code) {
      this.isLoading = true
      this.loadError = ''
      this.canRetry = false
      this.request = null
      this.actionError = ''
      this.code = code
      try {
        const response = await $fetch(`/api/device/requests/${encodeURIComponent(code)}`)
        this.request = response?.data || null
        this.startTimer()
      } catch (err) {
        const status = apiErrorStatus(err)
        if (status === 401) {
          // Signed out: send the user to login and keep the code across it
          await navigateTo('/login?redirect=' + encodeURIComponent('/device?code=' + code))
          return
        }
        if (status === 404) {
          this.loadError = INVALID_CODE_MESSAGE
        } else {
          this.loadError = apiErrorMessage(err, 'Failed to look up this code.')
          this.canRetry = true
        }
      } finally {
        this.isLoading = false
      }
    },
    async submit(action) {
      if (this.isSubmitting || this.isExpired) return
      this.isSubmitting = action
      this.actionError = ''
      this.actionErrorIsCap = false
      try {
        await $fetch(`/api/device/requests/${encodeURIComponent(this.code)}/${action}`, { method: 'POST' })
        this.result = action === 'approve' ? 'approved' : 'denied'
        this.stopTimer()
      } catch (err) {
        const status = apiErrorStatus(err)
        if (status === 404) {
          this.request = null
          this.loadError = INVALID_CODE_MESSAGE
        } else {
          this.actionErrorIsCap = status === 409
          this.actionError = apiErrorMessage(err, 'Something went wrong. Try again.')
        }
      } finally {
        this.isSubmitting = null
      }
    },
  },
}
</script>
