import { llmsTxt } from '~/server/services/public-site/documents'

// A project's llms.txt on a workspace subdomain (`<org>.<appDomain>/<project>/llms.txt`)
export default defineEventHandler((event) =>
  llmsTxt(event, { full: false, projectSlug: getRouterParam(event, 'project') })
)
