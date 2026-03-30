export default defineNuxtPlugin(() => {
  const event = useRequestEvent()
  const teamSlug = event?.context?.teamSubdomain ?? null
  const publicProjectSlug = event?.context?.publicProjectSlug ?? null
  useState('teamSubdomain', () => teamSlug)
  useState('publicProjectSlug', () => publicProjectSlug)
})
