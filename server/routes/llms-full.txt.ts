import { llmsTxt } from '~/server/services/public-site/documents'

export default defineEventHandler((event) => llmsTxt(event, { full: true }))
