export default defineNuxtPlugin(() => {
  const event = useRequestEvent()
  const teamSlug = event?.context?.teamSubdomain ?? null
  useState('teamSubdomain', () => teamSlug)
})
