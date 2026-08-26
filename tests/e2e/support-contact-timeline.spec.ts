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
    const [operator] = await db.select({ id: user.id }).from(user).where(eq(user.email, TEST_EMAIL)).limit(1)
    const [operatorMembership] = await db
      .select()
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, operator?.id || '')))
      .limit(1)
    const [ownProject] = await db.select().from(project).where(eq(project.teamId, teamId)).limit(1)
    const [otherTeam] = await db
      .select({ id: team.id, organizationId: team.organizationId })
      .from(team)
      .where(ne(team.id, teamId))
      .limit(1)
    if (!ownProject || !otherTeam || !operator || !operatorMembership) {
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
    let roleChanged = false
    let otherProjectOwned = false
    let contactOwned = false
    let feedbackOwned = false

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
      otherProjectOwned = true
      await db
        .insert(contact)
        .values({ id: contactId, teamId, name: 'Timeline contact', email, createdAt: now, updatedAt: now })
      contactOwned = true
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
      feedbackOwned = true

      await db.update(teamMember).set({ role: 'admin' }).where(eq(teamMember.id, operatorMembership.id))
      roleChanged = true

      const timeline = await request.get(`/api/support/contacts/${contactId}/timeline`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(timeline.ok(), await timeline.text()).toBeTruthy()
      const initial = (await timeline.json()).data
      expect(initial.linked).toEqual([])
      expect(initial.probableFeedback.map((item: { id: string }) => item.id)).toEqual([ownFeedbackId])
      expect(initial).toMatchObject({
        linkedHasMore: false,
        linkedNextCursor: null,
        probableHasMore: false,
        probableNextCursor: null,
      })

      const independentlyPaged = await request.get(`/api/support/contacts/${contactId}/timeline?limit=1`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect(independentlyPaged.ok()).toBeTruthy()
      expect((await independentlyPaged.json()).data).toMatchObject({
        linked: [],
        probableFeedback: [expect.objectContaining({ id: ownFeedbackId })],
        linkedHasMore: false,
        probableHasMore: false,
      })

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
      expect(linkedPayload).toMatchObject({
        linkedHasMore: false,
        linkedNextCursor: null,
        probableHasMore: false,
        probableNextCursor: null,
      })

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
      const cleanupErrors: string[] = []
      const cleanup = async (label: string, action: () => Promise<unknown>) => {
        try {
          await action()
        } catch (error) {
          cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      await cleanup('settings', async () => {
        if (originalSupportSettings) {
          await db.insert(supportTeamSettings).values(originalSupportSettings).onConflictDoUpdate({
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
      })
      await cleanup('role', async () => {
        if (roleChanged) {
          await db.update(teamMember).set({ role: operatorMembership.role }).where(eq(teamMember.id, operatorMembership.id))
        }
      })
      await cleanup('links', async () => {
        if (contactOwned) await db.delete(contactLink).where(eq(contactLink.contactId, contactId))
      })
      await cleanup('feedback', async () => {
        if (feedbackOwned) {
          await db.delete(feedback).where(eq(feedback.id, ownFeedbackId))
          await db.delete(feedback).where(eq(feedback.id, foreignFeedbackId))
        }
      })
      await cleanup('contact', async () => {
        if (contactOwned) await db.delete(contact).where(eq(contact.id, contactId))
      })
      await cleanup('project', async () => {
        if (otherProjectOwned) await db.delete(project).where(eq(project.id, otherProjectId))
      })

      expect(cleanupErrors, cleanupErrors.join('\n')).toEqual([])
      const [remainingContact] = await db.select({ id: contact.id }).from(contact).where(eq(contact.id, contactId)).limit(1)
      expect(remainingContact).toBeUndefined()
      const remainingFeedback = await db
        .select({ id: feedback.id })
        .from(feedback)
        .where(inArray(feedback.id, [ownFeedbackId, foreignFeedbackId]))
      expect(remainingFeedback).toEqual([])
      const [remainingProject] = await db.select({ id: project.id }).from(project).where(eq(project.id, otherProjectId)).limit(1)
      expect(remainingProject).toBeUndefined()
      const [restoredSettings] = await db
        .select({ autoLinkFeedback: supportTeamSettings.autoLinkFeedback })
        .from(supportTeamSettings)
        .where(eq(supportTeamSettings.teamId, teamId))
        .limit(1)
      expect(restoredSettings?.autoLinkFeedback ?? null).toBe(originalSupportSettings?.autoLinkFeedback ?? null)
      const [restoredMembership] = await db
        .select({ role: teamMember.role })
        .from(teamMember)
        .where(eq(teamMember.id, operatorMembership.id))
        .limit(1)
      expect(restoredMembership?.role).toBe(operatorMembership.role)
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
    let contactOwned = false
    let settingsCreated = false
    let roleChanged = false
    let projectChanged = false
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
      contactOwned = true

      await db.update(teamMember).set({ role: 'admin' }).where(eq(teamMember.id, operatorMembership.id))
      roleChanged = true

      const settingResponse = await request.put(`/api/support/teams/${teamId}/settings`, {
        headers: withAuthHeaders(sessionCookie),
        data: { autoLinkFeedback: true },
      })
      expect(settingResponse.ok()).toBeTruthy()
      settingsCreated = !originalSupportSettings

      const authenticated = await request.post('/api/feedback', {
        headers: withAuthHeaders(sessionCookie),
        data: { projectId: ownProject.id, title: 'Authenticated automatic link', body: 'Signed-in body' },
      })
      expect(authenticated.status()).toBe(201)
      const authenticatedId = (await authenticated.json()).data.id as string
      feedbackIds.push(authenticatedId)

      if (!originalIsPublic) {
        await db.update(project).set({ isPublic: true }).where(eq(project.id, ownProject.id))
        projectChanged = true
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
      await expect(page.getByText('Authenticated automatic link')).toBeVisible()

      const afterUnlink = await request.get(`/api/support/contacts/${contactId}/timeline`, {
        headers: withAuthHeaders(sessionCookie),
      })
      expect((await afterUnlink.json()).data.linked).toEqual([])
    } finally {
      const cleanupErrors: string[] = []
      const cleanup = async (label: string, action: () => Promise<unknown>) => {
        try {
          await action()
        } catch (error) {
          cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      await cleanup('settings', async () => {
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
        } else if (settingsCreated) {
          await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, teamId))
        }
      })
      await cleanup('role', async () => {
        if (roleChanged) {
          await db.update(teamMember).set({ role: operatorMembership.role }).where(eq(teamMember.id, operatorMembership.id))
        }
      })
      await cleanup('links', async () => {
        if (contactOwned) await db.delete(contactLink).where(eq(contactLink.contactId, contactId))
      })
      await cleanup('feedback', async () => {
        if (feedbackIds.length > 0) {
          await db.delete(feedback).where(and(eq(feedback.projectId, ownProject.id), inArray(feedback.id, feedbackIds)))
        }
      })
      await cleanup('contact', async () => {
        if (contactOwned) await db.delete(contact).where(eq(contact.id, contactId))
      })
      await cleanup('project', async () => {
        if (projectChanged) await db.update(project).set({ isPublic: originalIsPublic }).where(eq(project.id, ownProject.id))
      })
      await cleanup('request context', () => anonymousRequest.dispose())

      expect(cleanupErrors, cleanupErrors.join('\n')).toEqual([])
      const [remainingContact] = await db.select({ id: contact.id }).from(contact).where(eq(contact.id, contactId)).limit(1)
      expect(remainingContact).toBeUndefined()
      const remainingFeedback = feedbackIds.length
        ? await db.select({ id: feedback.id }).from(feedback).where(inArray(feedback.id, feedbackIds))
        : []
      expect(remainingFeedback).toEqual([])
      const [restoredSettings] = await db
        .select()
        .from(supportTeamSettings)
        .where(eq(supportTeamSettings.teamId, teamId))
        .limit(1)
      expect(restoredSettings?.autoLinkFeedback ?? null).toBe(originalSupportSettings?.autoLinkFeedback ?? null)
      const [restoredMembership] = await db
        .select({ role: teamMember.role })
        .from(teamMember)
        .where(eq(teamMember.id, operatorMembership.id))
        .limit(1)
      expect(restoredMembership?.role).toBe(operatorMembership.role)
      const [restoredProject] = await db
        .select({ isPublic: project.isPublic })
        .from(project)
        .where(eq(project.id, ownProject.id))
        .limit(1)
      expect(restoredProject?.isPublic).toBe(originalIsPublic)
    }
  })
})
