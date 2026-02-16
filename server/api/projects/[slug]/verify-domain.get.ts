import { promises as dns } from 'dns'
import { auth } from '~/lib/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const domain = (query.domain as string | undefined)?.trim()

  if (!domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain query parameter is required' })
  }

  const cnameTarget = useRuntimeConfig().public.cnameTarget as string

  try {
    const cnames = await dns.resolveCname(domain)
    const matched = cnames.some(
      (c) => c.toLowerCase().replace(/\.$/, '') === cnameTarget.toLowerCase().replace(/\.$/, ''),
    )
    return {
      verified: matched,
      resolvedTo: cnames,
      expected: cnameTarget,
    }
  } catch (err: any) {
    // ENOTFOUND = domain doesn't exist; ENODATA = no CNAME record found
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'ESERVFAIL') {
      return {
        verified: false,
        resolvedTo: [],
        expected: cnameTarget,
      }
    }
    throw createError({ statusCode: 500, statusMessage: 'DNS lookup failed' })
  }
})
