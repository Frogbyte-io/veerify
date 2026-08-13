import { desc, eq, and } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogPost } from '~/server/database/schema/changelog'
import { createSuccessResponse } from '~/server/utils/response'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const { team, project } = await resolvePublicProjectByTeam(teamSlug!, projectSlug!)
  const settings = project.settings && typeof project.settings === 'object' ? (project.settings as Record<string, any>) : {}
  const changelogEnabled = settings.changelogEnabled === true

  const posts = changelogEnabled
    ? await db
        .select()
        .from(changelogPost)
        .where(and(eq(changelogPost.projectId, project.id), eq(changelogPost.isDraft, false)))
        .orderBy(desc(changelogPost.publishedAt), desc(changelogPost.createdAt))
    : []

  return createSuccessResponse({
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      customDomain: project.customDomain,
      settings: project.settings,
    },
    team: {
      name: team.name,
      slug: team.slug,
    },
    posts,
  })
})
