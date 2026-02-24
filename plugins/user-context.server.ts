import { auth } from '~/lib/auth'

export default defineNuxtPlugin(async () => {
  const event = useRequestEvent()
  if (!event) return

  try {
    const session = await auth.api.getSession({
      headers: event.node.req.headers as any,
    })

    const sessionRecord = session?.session as { activeOrganizationId?: string | null } | null | undefined
    useState('hasActiveOrganization', () => (session?.user ? !!sessionRecord?.activeOrganizationId : null))
  } catch {
    useState('hasActiveOrganization', () => null)
  }
})
