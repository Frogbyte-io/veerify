import { auth } from '~/lib/auth'
import { getAuthHeaders } from '~/server/utils/auth-headers'

export default defineNuxtPlugin(async () => {
  const event = useRequestEvent()
  if (!event) return

  try {
    const session = await auth.api.getSession({
      headers: getAuthHeaders(event),
    })

    const sessionRecord = session?.session as { activeOrganizationId?: string | null } | null | undefined
    useState('hasActiveOrganization', () => (session?.user ? !!sessionRecord?.activeOrganizationId : null))
  } catch {
    useState('hasActiveOrganization', () => null)
  }
})
