import { robotsTxt } from '~/server/services/public-site/documents'

export default defineEventHandler((event) => robotsTxt(event))
