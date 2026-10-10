import {
  LlmProviderError,
  type KeyValidationResult,
  type LlmCitation,
  type LlmErrorKind,
  type LlmProviderId,
} from './types'

export const ANSWER_TIMEOUT_MS = 90_000
export const EXTRACT_TIMEOUT_MS = 30_000
export const VALIDATE_TIMEOUT_MS = 30_000

const MAX_ERROR_BODY_CHARS = 300

/**
 * Billing/quota exhaustion is not retryable and is not a bad key:
 * - OpenAI: 429 with error.code/type `insufficient_quota` (or `billing_*`)
 * - Anthropic: 400 invalid_request_error "credit balance is too low", or 402/429 billing errors
 */
export function isQuotaError(status: number, body: string): boolean {
  if (status !== 400 && status !== 402 && status !== 429) return false
  if (status === 402) return true
  let code = ''
  let message = body
  try {
    const err = (JSON.parse(body) as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error
    code = `${typeof err?.code === 'string' ? err.code : ''} ${typeof err?.type === 'string' ? err.type : ''}`
    message = typeof err?.message === 'string' ? err.message : body
  } catch {
    // non-JSON body: fall back to text matching below
  }
  if (/insufficient_quota|billing/i.test(code)) return true
  return /insufficient[_ ]quota|exceeded your current quota|credit balance is too low|billing (hard )?limit|purchase credits/i.test(
    message
  )
}

export function kindForStatus(status: number, body = ''): LlmErrorKind {
  if (isQuotaError(status, body)) return 'quota'
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  // 400/404/422 and any other 4xx
  return 'bad_request'
}

/** Remove the key (and anything key-shaped) and truncate. */
export function sanitize(text: string, apiKey: string): string {
  let out = text
  if (apiKey) out = out.split(apiKey).join('[redacted]')
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
  return out.length > MAX_ERROR_BODY_CHARS ? `${out.slice(0, MAX_ERROR_BODY_CHARS)}...` : out
}

export interface JsonRequest {
  provider: LlmProviderId
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
  apiKey: string
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * fetch + JSON with timeout, caller signal and error mapping to LlmProviderError.
 * Error messages never contain the API key.
 */
export async function requestJson(req: JsonRequest): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(req.timeoutMs)
  const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal

  let res: Response
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: req.body === undefined ? req.headers : { ...req.headers, 'content-type': 'application/json' },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal,
    })
  } catch (err) {
    if (signal.aborted) {
      const who = req.signal?.aborted ? 'aborted by caller' : `timed out after ${req.timeoutMs}ms`
      throw new LlmProviderError(req.provider, 'timeout', `${req.provider} request ${who}`)
    }
    const name = err instanceof Error ? err.name : 'Error'
    throw new LlmProviderError(req.provider, 'network', `${req.provider} network error (${name})`)
  }

  let text: string
  try {
    text = await res.text()
  } catch {
    if (signal.aborted) {
      throw new LlmProviderError(req.provider, 'timeout', `${req.provider} request timed out`)
    }
    throw new LlmProviderError(req.provider, 'network', `${req.provider} failed reading response body`)
  }

  if (!res.ok) {
    throw new LlmProviderError(
      req.provider,
      kindForStatus(res.status, text),
      `${req.provider} API error ${res.status}: ${sanitize(text, req.apiKey)}`,
      res.status
    )
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new LlmProviderError(req.provider, 'server', `${req.provider} returned non-JSON response`, res.status)
  }
}

/** Map a thrown provider error to a validateKey result; rethrow anything else. */
export function validateResult(err: unknown): KeyValidationResult {
  if (err instanceof LlmProviderError) return { ok: false, kind: err.kind, message: err.message }
  throw err
}

/** Add a citation if its URL is new (first title wins). */
export function addCitation(list: LlmCitation[], seen: Set<string>, url: unknown, title: unknown) {
  if (typeof url !== 'string' || !url || seen.has(url)) return
  seen.add(url)
  list.push(typeof title === 'string' && title ? { url, title } : { url })
}
