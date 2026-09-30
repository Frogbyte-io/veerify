export function isLocalRedisUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return false
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === 'valkey'
  } catch {
    return false
  }
}

export function isDedicatedRedisUrl(value, env = process.env) {
  return isLocalRedisUrl(value) || env.REDIS_INTEGRATION_DEDICATED === '1'
}
