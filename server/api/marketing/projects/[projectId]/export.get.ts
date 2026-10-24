/**
 * @openapi
 * /api/marketing/projects/{projectId}/export:
 *   get:
 *     tags: [Marketing]
 *     summary: Export a product's Marketing data
 *     description: >
 *       Project admins only; works while Marketing is switched off. Returns a JSON download of the
 *       product's Marketing data. Never contains encrypted keys, refresh tokens, the site
 *       verification token or review request tokens. Audit pages are reduced to url, status and title.
 *     operationId: exportMarketingData
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: JSON attachment
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       403: { description: Project admin required }
 *       404: { description: Product not found }
 */
import { exportProductMarketingData } from '~/server/services/marketing/data-export'
import { requireMarketingDataAdmin } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project } = await requireMarketingDataAdmin(projectId, session.user.id)

  const data = await exportProductMarketingData(projectId, project.slug)
  const fileName = `marketing-${project.slug.replace(/[^a-z0-9-]/gi, '-')}.json`
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${fileName}"`)
  setHeader(event, 'cache-control', 'no-store')
  return data
})
