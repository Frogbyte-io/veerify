/** Rate limits for form submissions. Buckets are per identifier and subject (`server/utils/rate-limit.ts`). */

/** Server API, per caller IP before the key is checked: bounds credential guessing. */
export const FORM_API_IP_LIMIT = { maxRequests: 120, windowSeconds: 60, identifier: 'form-api-ip' }
/** Server API, per server key: a site's whole traffic. */
export const FORM_API_KEY_LIMIT = { maxRequests: 600, windowSeconds: 3600, identifier: 'form-api-key' }
/** Server API, per form and visitor IP (when the site forwards `metadata.clientIp`). */
export const FORM_API_VISITOR_LIMIT = { maxRequests: 10, windowSeconds: 600, identifier: 'form-api-visitor' }

/** Browser endpoint, per form and visitor IP. */
export const FORM_BROWSER_VISITOR_LIMIT = { maxRequests: 5, windowSeconds: 600, identifier: 'form-browser-visitor' }
/** Browser endpoint, per form across all visitors: caps what a botnet can file. */
export const FORM_BROWSER_FORM_LIMIT = { maxRequests: 200, windowSeconds: 3600, identifier: 'form-browser-form' }
