import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { db } from './helpers/db'
import { feedback, project } from '../../server/database/schema/feedback'
import { contact, contactLink, supportTeamSettings } from '../../server/database/schema/support'
import { team } from '../../server/database/schema/auth'
import { signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

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
      expect(timeline.ok()).toBeTruthy()
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
})
