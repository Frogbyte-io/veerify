export default defineNuxtPlugin(() => {
  const event = useRequestEvent()
  const orgSlug = event?.context?.publicOrgSlug ?? null
  const publicProjectSlug = event?.context?.publicProjectSlug ?? null
  useState('publicOrgSlug', () => orgSlug)
  useState('publicProjectSlug', () => publicProjectSlug)
})
