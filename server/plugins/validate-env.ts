export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.uploadTokenSecret) {
    console.error(
      '[veerify] UPLOAD_TOKEN_SECRET is not set. '
      + 'This variable is required for signing upload tokens. '
      + 'Generate a random secret and add it to your .env file.',
    )
    throw new Error('Missing required environment variable: UPLOAD_TOKEN_SECRET')
  }
})
