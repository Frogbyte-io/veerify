import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { isPrivateWebhookAddress, validateWebhookUrlSyntax } from './webhook-url'

export type SafeFetchErrorKind = 'blocked_address' | 'invalid_url' | 'timeout' | 'too_many_redirects' | 'network'

export class SafeFetchError extends Error {
  constructor(
    readonly kind: SafeFetchErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Return 3xx responses (with their Location header) instead of following them, so the caller can vet each hop. */
  manualRedirects?: boolean
  accept?: string
  userAgent?: string
  signal?: AbortSignal
}

export interface SafeFetchResult {
  status: number
  finalUrl: string
  headers: IncomingHttpHeaders
  body: string
  /** True when the body was cut at maxBytes */
  truncated: boolean
  contentType: string | null
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '')
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

/** Syntax + scheme + port policy. Throws SafeFetchError. */
function checkUrl(value: string, allowedExplicitPort: string | null): URL {
  let normalized: string
  try {
    normalized = validateWebhookUrlSyntax(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid URL'
    throw new SafeFetchError(
      message.includes('private or local') ? 'blocked_address' : 'invalid_url',
      message.replace(/webhook url/i, 'URL')
    )
  }
  const url = new URL(normalized)
  const port = effectivePort(url)
  if (port !== '80' && port !== '443' && port !== allowedExplicitPort) {
    throw new SafeFetchError('blocked_address', `Port ${port} is not allowed`)
  }
  return url
}

async function resolvePinned(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const literal = isIP(hostname)
  if (literal) {
    if (isPrivateWebhookAddress(hostname)) throw new SafeFetchError('blocked_address', 'Address is private or local')
    return { address: hostname, family: literal as 4 | 6 }
  }
  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new SafeFetchError('network', `Could not resolve ${hostname}`)
  }
  if (!addresses.length) throw new SafeFetchError('network', `Could not resolve ${hostname}`)
  if (addresses.some(({ address }) => isPrivateWebhookAddress(address))) {
    throw new SafeFetchError('blocked_address', 'Host resolves to a private or local address')
  }
  return { address: addresses[0].address, family: addresses[0].family as 4 | 6 }
}

interface HopResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
  truncated: boolean
}

async function requestOnce(
  url: URL,
  options: Required<Pick<SafeFetchOptions, 'timeoutMs' | 'maxBytes'>> & SafeFetchOptions
): Promise<HopResponse> {
  const hostname = hostOf(url)
  const { address, family } = await resolvePinned(hostname)
  const transport = url.protocol === 'https:' ? https : http
  const headers: Record<string, string> = {
    'accept-encoding': 'identity',
    accept: options.accept || '*/*',
  }
  if (options.userAgent) headers['user-agent'] = options.userAgent

  return await new Promise<HopResponse>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      finish(() => reject(new SafeFetchError('network', 'Request aborted')))
      request.destroy()
    }
    const timer = setTimeout(() => {
      finish(() => reject(new SafeFetchError('timeout', 'Request timed out')))
      request.destroy()
    }, options.timeoutMs)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        servername: isIP(hostname) ? undefined : hostname,
        lookup: (_host: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (lookupOptions?.all) callback(null, [{ address, family }])
          else callback(null, address, family)
        },
      } as http.RequestOptions,
      (response) => {
        const chunks: Buffer[] = []
        let received = 0
        let truncated = false
        const done = () =>
          finish(() =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: new TextDecoder('utf-8').decode(Buffer.concat(chunks)),
              truncated,
            })
          )
        response.on('error', (error) => finish(() => reject(new SafeFetchError('network', error.message))))
        if (REDIRECT_STATUSES.has(response.statusCode ?? 0)) {
          response.resume()
          response.on('end', done)
          return
        }
        response.on('data', (chunk: Buffer) => {
          if (truncated) return
          const room = options.maxBytes - received
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room))
            received += room
            truncated = true
            done()
            request.destroy()
            return
          }
          chunks.push(chunk)
          received += chunk.length
        })
        response.on('end', done)
      }
    )
    request.on('error', (error) => finish(() => reject(new SafeFetchError('network', error.message))))
    if (options.signal?.aborted) return onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    request.end()
  })
}

/**
 * SSRF-safe GET. Every hop is validated and connects to the address that was
 * checked, so DNS rebinding cannot swap in a private address.
 */
export async function safeFetchText(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const options = {
    ...opts,
    timeoutMs: opts.timeoutMs ?? 10_000,
    maxBytes: opts.maxBytes ?? 2_000_000,
  }
  const maxRedirects = opts.maxRedirects ?? 5

  let initial: URL
  try {
    initial = new URL(url)
  } catch {
    throw new SafeFetchError('invalid_url', 'A valid URL is required')
  }
  const explicitPort = initial.port || null
  let current = checkUrl(url, explicitPort)

  for (let hop = 0; ; hop++) {
    const response = await requestOnce(current, options)
    const location = response.headers.location
    if (REDIRECT_STATUSES.has(response.status) && location && !opts.manualRedirects) {
      if (hop >= maxRedirects) throw new SafeFetchError('too_many_redirects', 'Too many redirects')
      let next: string
      try {
        next = new URL(location, current).toString()
      } catch {
        throw new SafeFetchError('invalid_url', 'Redirect to an invalid URL')
      }
      current = checkUrl(next, explicitPort)
      continue
    }
    const contentType = response.headers['content-type']
    return {
      status: response.status,
      finalUrl: current.toString(),
      headers: response.headers,
      body: response.body,
      truncated: response.truncated,
      contentType: typeof contentType === 'string' ? contentType : null,
    }
  }
}
