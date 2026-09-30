/**
 * Storage contract for the sliding-window rate limiter in
 * `server/utils/rate-limit.ts`.
 */
export interface RateLimitStore {
  readonly name: string

  /**
   * Record a request against `key` and report whether it falls within the
   * sliding window of `maxRequests` per `windowMs`.
   *
   * Must fail open: if the store cannot produce an answer (e.g. Redis is
   * unreachable), it must return `true`. The rate limiter guards public
   * endpoints (feedback submission, votes, comments) — a backing-store
   * outage must not turn into a public API outage.
   */
  consume(key: string, windowMs: number, maxRequests: number): Promise<boolean>
}
