import { llmsTxt } from '~/server/services/public-site/documents'

// https://llmstxt.org: what this site is, for AI agents
export default defineEventHandler((event) => llmsTxt(event, { full: false }))
