/**
 * Bot-challenge hook for the public (browser) form endpoint.
 *
 * Veerify has no CAPTCHA/Turnstile integration yet, so this accepts every
 * request; the browser endpoint relies on the origin allowlist, the honeypot
 * and per-IP and per-form rate limits. To add Cloudflare Turnstile, verify
 * `token` here against https://challenges.cloudflare.com/turnstile/v0/siteverify
 * with a secret from the environment (and add it to `.env.example`), and return
 * false when verification fails. The route already passes the token
 * (`challengeToken` in JSON, `_challenge` in form-encoded bodies) and answers
 * 403 `CHALLENGE_FAILED` on false.
 */
import type { SupportFormRow } from './submit'

export interface FormChallengeInput {
  form: Pick<SupportFormRow, 'id' | 'projectId'>
  token: string | null
  clientIp: string | null
}

// eslint-disable-next-line no-unused-vars
export async function verifyFormChallenge(_input: FormChallengeInput): Promise<boolean> {
  return true
}
