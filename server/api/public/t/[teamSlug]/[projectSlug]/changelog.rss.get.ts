/**
 * Served at `/api/public/t/{teamSlug}/{projectSlug}/changelog.rss`. Nitro
 * strips only the trailing `.get.ts`, so the `.rss` stays in the route path.
 *
 * @openapi
 * /api/public/t/{teamSlug}/{projectSlug}/changelog.rss:
 *   get:
 *     tags: [Public]
 *     summary: RSS 2.0 feed of the latest 30 published changelog entries
 *     operationId: getPublicChangelogRss
 *     parameters:
 *       - { in: path, name: teamSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: RSS feed
 *         content:
 *           application/rss+xml:
 *             schema: { type: string }
 *       404: { description: Not found or Changelog disabled }
 */
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { markdownToPlainText } from '~/server/utils/markdown'
import { listPublishedEntries, resolvePublicChangelogProject, RSS_ITEM_LIMIT } from '~/server/services/changelog/public'
import { buildRssFeed, decodeBasicEntities } from '~/server/services/changelog/rss'

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')
  const { team, project } = await resolvePublicChangelogProject(teamSlug!, projectSlug!)

  const { rows } = await listPublishedEntries(project.id, { limit: RSS_ITEM_LIMIT })

  const requestUrl = getRequestURL(event)
  const boardUrl = buildPublicBoardUrl({
    project: { slug: project.slug, customDomain: project.customDomain, settings: project.settings },
    teamSlug: team.slug,
    projectSlug: project.slug,
    appDomain: useRuntimeConfig().public.appDomain || 'localhost',
    protocol: requestUrl.protocol,
    port: requestUrl.port,
  })

  const xml = buildRssFeed({
    title: `${project.name} changelog`,
    link: `${boardUrl}/changelog`,
    description: `Release notes and product updates for ${project.name}`,
    selfUrl: requestUrl.href,
    items: rows.map((row) => ({
      title: row.title,
      link: `${boardUrl}/changelog/${row.slug}`,
      guid: row.id,
      pubDate: row.publishedAt ?? row.createdAt,
      description: decodeBasicEntities(markdownToPlainText(row.body, 1000) || row.summary || ''),
      categories: row.labels,
    })),
  })

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return xml
})
