import { expect, request as createRequest, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from './helpers/db'
import { feedback, project } from '../../server/database/schema/feedback'
import { contact, contactLink, supportTeamSettings } from '../../server/database/schema/support'
import { team, teamMember, user } from '../../server/database/schema/auth'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

async function activeTeamId(request: Parameters<typeof signInAndGetSessionCookie>[0], sessionCookie: string) {
  const response = await request.get('/api/teams/active', { headers: withAuthHeaders(sessionCookie) })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data.id as string
}

test.describe.serial('support contact timeline', () => {
  test('keeps probable feedback tenant-scoped and separate until an agent links it', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const teamId = await activeTeamId(request, sessionCookie)
    const [ownProject] = await db.select().from(project).where(eq(project.teamId, teamId)).limit(1)
    const [otherTeam] = await db
      .select({ id: team.id, organizationId: team.organizationId })
      .from(team)
      .where(ne(team.id, teamId))
      .limit(1)
    if (!ownProject || !otherTeam) {
      test.skip()
      return
    }
    const [originalSupportSettings] = await db
      .select()
      .from(supportTeamSettings)
      .where(eq(supportTeamSettings.teamId, teamId))
      .limit(1)

    const contactId = randomUUID()
    const ownFeedbackId = randomUUID()
    const foreignFeedbackId = randomUUID()
    const otherProjectId = randomUUID()
    const email = `timeline-${contactId}@example.com`
    const now = new Date()
    let settingsFixtureCreated = false

    try {
      await db.insert(project).values({
        id: otherProjectId,
        organizationId: otherTeam.organizationId,
        teamId: otherTeam.id,
        slug: `e2e-support-timeline-${otherProjectId}`,
        name: `E2E Support Timeline ${otherProjectId}`,
        description: 'Created for support contact timeline isolation coverage',
        createdAt: now,
        updatedAt: now,
      })
      await db
        .insert(contact)
        .values({ id: contactId, teamId, name: 'Timeline contact', email, createdAt: now, updatedAt: now })
      await db.insert(feedback).values([
        {
          id: ownFeedbackId,
          projectId: ownProject.id,
          title: 'Own probable feedback',
          authorEmail: email,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: foreignFeedbackId,
          projectId: otherProjectId,
          title: 'Foreign feedback',
          authorEmail: email,
          createdAt: now,
          updatedAt: now,
        },
      ])

      const timeline = await request.get(`/api/support/contacts/${contactId}/timeline`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(timeline.ok(), await timeline.text()).toBeTruthy()
      const initial = (await timeline.json()).data
      expect(initial.linked).toEqual([])
      expect(initial.probableFeedback.map((item: { id: string }) => item.id)).toEqual([ownFeedbackId])

      const crossTenant = await request.post(`/api/support/contacts/${contactId}/links`, {
        headers: withAuthHeaders(sessionCookie),
        data: { entityType: 'feedback', entityId: foreignFeedbackId },
      })
      expect(crossTenant.status()).toBe(400)

      const linkResponse = await request.post(`/api/support/contacts/${contactId}/links`, {
        headers: withAuthHeaders(sessionCookie),
        data: { entityType: 'feedback', entityId: ownFeedbackId },
      })
      expect(linkResponse.ok()).toBeTruthy()
      const link = (await linkResponse.json()).data.link
      expect(link.source).toBe('agent')
      expect(link.createdByUserId).toBeTruthy()

      const duplicate = await request.post(`/api/support/contacts/${contactId}/links`, {
        headers: withAuthHeaders(sessionCookie),
        data: { entityType: 'feedback', entityId: ownFeedbackId },
      })
      expect(duplicate.status()).toBe(409)

      const linkedTimeline = await request.get(`/api/support/contacts/${contactId}/timeline`, {
        headers: withAuthHeaders(sessionCookie),
      })
      const linkedPayload = (await linkedTimeline.json()).data
      expect(linkedPayload.linked).toHaveLength(1)
      expect(linkedPayload.probableFeedback).toEqual([])

      const defaultSettings = await request.get(`/api/support/teams/${teamId}/settings`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect((await defaultSettings.json()).data.settings.autoLinkFeedback).toBe(false)
      settingsFixtureCreated = !originalSupportSettings
      const settingResponse = await request.put(`/api/support/teams/${teamId}/settings`, {
        headers: withAuthHeaders(sessionCookie),
        data: { autoLinkFeedback: true },
      })
      expect(settingResponse.ok()).toBeTruthy()

      const unlink = await request.delete(`/api/support/contacts/${contactId}/links/${link.id}`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(unlink.ok()).toBeTruthy()
      const unlinkAgain = await request.delete(`/api/support/contacts/${contactId}/links/${link.id}`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(unlinkAgain.status()).toBe(404)

      const deleteContact = await request.delete(`/api/support/contacts/${contactId}`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(deleteContact.ok()).toBeTruthy()
      const feedbackAfterContactDelete = await db
        .select({ id: feedback.id })
        .from(feedback)
        .where(and(eq(feedback.id, ownFeedbackId), eq(feedback.projectId, ownProject.id)))
      expect(feedbackAfterContactDelete).toEqual([{ id: ownFeedbackId }])
    } finally {
      if (originalSupportSettings) {
        await db
          .insert(supportTeamSettings)
          .values({
            teamId: originalSupportSettings.teamId,
            autoLinkFeedback: originalSupportSettings.autoLinkFeedback,
            createdAt: originalSupportSettings.createdAt,
            updatedAt: originalSupportSettings.updatedAt,
          })
          .onConflictDoUpdate({
            target: supportTeamSettings.teamId,
            set: {
              autoLinkFeedback: originalSupportSettings.autoLinkFeedback,
              createdAt: originalSupportSettings.createdAt,
              updatedAt: originalSupportSettings.updatedAt,
            },
          })
      } else if (settingsFixtureCreated) {
        await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, teamId))
      }
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(feedback).where(and(eq(feedback.id, ownFeedbackId), eq(feedback.projectId, ownProject.id)))
      await db.delete(feedback).where(and(eq(feedback.id, foreignFeedbackId), eq(feedback.projectId, otherProjectId)))
      await db.delete(contactLink).where(eq(contactLink.contactId, contactId))
      await db.delete(project).where(eq(project.id, otherProjectId))
    }
  })

  test('auto-links authenticated feedback, never email-only or anonymous feedback, and supports unlinking', async ({
    request,
    page,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const teamId = await activeTeamId(request, sessionCookie)
    const [teamRow] = await db.select().from(team).where(eq(team.id, teamId)).limit(1)
    const [ownProject] = await db.select().from(project).where(eq(project.teamId, teamId)).limit(1)
    const [customer] = await db.select().from(user).where(eq(user.email, TEST_EMAIL)).limit(1)
    const [operatorMembership] = await db
      .select()
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, customer?.id || '')))
      .limit(1)
    if (!teamRow || !ownProject || !customer || !operatorMembership) {
      test.skip()
      return
    }

    const [originalSupportSettings] = await db
      .select()
      .from(supportTeamSettings)
      .where(eq(supportTeamSettings.teamId, teamId))
      .limit(1)
    const originalIsPublic = ownProject.isPublic
    const contactId = randomUUID()
    const feedbackIds: string[] = []
    const now = new Date()
    const anonymousRequest = await createRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4913',
    })

    try {
      await db.insert(contact).values({
        id: contactId,
        teamId,
        userId: customer.id,
        email: TEST_EMAIL,
        name: 'Authenticated auto-link customer',
        createdAt: now,
        updatedAt: now,
      })

      await db.update(teamMember).set({ role: 'admin' }).where(eq(teamMember.id, operatorMembership.id))

      const settingResponse = await request.put(`/api/support/teams/${teamId}/settings`, {
        headers: withAuthHeaders(sessionCookie),
        data: { autoLinkFeedback: true },
      })
      expect(settingResponse.ok()).toBeTruthy()

      const authenticated = await request.post('/api/feedback', {
        headers: withAuthHeaders(sessionCookie),
        data: { projectId: ownProject.id, title: 'Authenticated automatic link', body: 'Signed-in body' },
      })
      expect(authenticated.status()).toBe(201)
      const authenticatedId = (await authenticated.json()).data.id as string
      feedbackIds.push(authenticatedId)

      if (!originalIsPublic) {
        await db.update(project).set({ isPublic: true }).where(eq(project.id, ownProject.id))
      }

      const emailOnly = await anonymousRequest.post(`/api/public/t/${teamRow.slug}/${ownProject.slug}/feedback`, {
        headers: withOriginHeaders('/feedback'),
        data: {
          title: 'Email-only must remain unlinked',
          body: 'Email-only body',
          authorName: 'Email-only submitter',
          authorEmail: TEST_EMAIL,
        },
      })
      expect(emailOnly.status()).toBe(201)
      feedbackIds.push((await emailOnly.json()).data.id as string)

      const anonymous = await anonymousRequest.post(`/api/public/t/${teamRow.slug}/${ownProject.slug}/feedback`, {
        headers: withOriginHeaders('/feedback'),
        data: { title: 'Anonymous must remain unlinked', body: 'Anonymous body', authorName: 'Anonymous submitter' },
      })
      expect(anonymous.status()).toBe(201)
      feedbackIds.push((await anonymous.json()).data.id as string)

      const timelineResponse = await request.get(`/api/support/contacts/${contactId}/timeline`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(timelineResponse.ok()).toBeTruthy()
      const timeline = (await timelineResponse.json()).data
      expect(timeline.linked).toEqual(expect.arrayContaining([expect.objectContaining({
        entityId: authenticatedId,
        source: 'auto',
        createdByUserId: null,
      })]))
      expect(timeline.linked).toHaveLength(1)
      const probableIds = timeline.probableFeedback.map((item: { id: string }) => item.id)
      expect(probableIds).toContain(feedbackIds[1])
      expect(probableIds).not.toContain(feedbackIds[2])

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support/contacts/${contactId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByText('Automatically linked')).toBeVisible()
      await page.getByRole('button', { name: 'Remove automatic link' }).click()
      await expect(page.getByText('Automatically linked')).toHaveCount(0)

      const afterUnlink = await request.get(`/api/support/contacts/${contactId}/timeline`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect((await afterUnlink.json()).data.linked).toEqual([])
    } finally {
      if (originalSupportSettings) {
        await db
          .insert(supportTeamSettings)
          .values(originalSupportSettings)
          .onConflictDoUpdate({
            target: supportTeamSettings.teamId,
            set: {
              autoLinkFeedback: originalSupportSettings.autoLinkFeedback,
              createdAt: originalSupportSettings.createdAt,
              updatedAt: originalSupportSettings.updatedAt,
            },
          })
      } else {
        await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, teamId))
      }
      await db.update(teamMember).set({ role: operatorMembership.role }).where(eq(teamMember.id, operatorMembership.id))
      await db.delete(contactLink).where(eq(contactLink.contactId, contactId))
      await db.delete(contact).where(eq(contact.id, contactId))
      if (feedbackIds.length > 0) {
        await db.delete(feedback).where(and(eq(feedback.projectId, ownProject.id), inArray(feedback.id, feedbackIds)))
      }
      if (!originalIsPublic) {
        await db.update(project).set({ isPublic: false }).where(eq(project.id, ownProject.id))
      }
      await anonymousRequest.dispose()
    }
  })
})
