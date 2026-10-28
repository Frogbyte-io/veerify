import { sitemapXml } from '~/server/services/public-site/documents'

export default defineEventHandler((event) => sitemapXml(event))
