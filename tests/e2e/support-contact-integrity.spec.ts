import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray, ne } from 'drizzle-orm'
import { db } from '../../server/database/drizzle'
import { contact, contactIdentity, contactLink, supportCompany } from '../../server/database/schema/support'
import { team } from '../../server/database/schema/auth'
import { signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

async function activeTeamId(request: Parameters<typeof signInAndGetSessionCookie>[0], sessionCookie: string) {
  const response = await request.get('/api/teams/active', { headers: withAuthHeaders(sessionCookie) })
  const payload = await response.json()
  expect(response.ok()).toBeTruthy()
  return payload.data.id as string
}

test.describe.serial('support contact integrity', () => {
  test('rejects a company from another team on create and update', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const teamId = await activeTeamId(request, sessionCookie)
    const [otherTeam] = await db.select({ id: team.id }).from(team).where(ne(team.id, teamId)).limit(1)

    // A deployment with only one seeded team cannot exercise cross-team FK
    // isolation; the production check is still covered by the transaction.
    if (!otherTeam) test.skip()

    const companyId = randomUUID()
    await db.insert(supportCompany).values({ id: companyId, teamId: otherTeam.id, name: `foreign-${companyId}` })

    try {
      const createResponse = await request.post('/api/support/contacts', {
        headers: withAuthHeaders(sessionCookie),
        data: { teamId, name: 'cross-team create', companyId },
      })
      expect(createResponse.status()).toBe(400)

      const createOwnResponse = await request.post('/api/support/contacts', {
        headers: withAuthHeaders(sessionCookie),
        data: { teamId, name: 'cross-team update' },
      })
      expect(createOwnResponse.ok()).toBeTruthy()
      const created = await createOwnResponse.json()
      const updateResponse = await request.put(`/api/support/contacts/${created.data.contact.id}`, {
        headers: withAuthHeaders(sessionCookie),
        data: { companyId },
      })
      expect(updateResponse.status()).toBe(400)
      await db.delete(contact).where(eq(contact.id, created.data.contact.id))
    } finally {
      await db.delete(supportCompany).where(eq(supportCompany.id, companyId))
    }
  })

  test('paginates equal-timestamp contacts without skipping the id tie-breaker', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const teamId = await activeTeamId(request, sessionCookie)
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    const ids: string[] = [randomUUID(), randomUUID(), randomUUID()]

    await db.insert(contact).values(
      ids.map((id) => ({ id, teamId, name: `cursor-${id}`, createdAt, updatedAt: createdAt }))
    )

    try {
      const seen: string[] = []
      let cursor: string | null = null
      do {
        const response = await request.get(
          `/api/support/contacts?teamId=${teamId}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { headers: withAuthHeaders(sessionCookie) }
        )
        expect(response.ok()).toBeTruthy()
        const payload = await response.json()
        seen.push(...payload.data.contacts.filter((item: { id: string }) => ids.includes(item.id)).map((item: { id: string }) => item.id))
        cursor = payload.data.nextCursor
      } while (cursor)

      expect(new Set(seen)).toEqual(new Set(ids))
    } finally {
      await db.delete(contact).where(inArray(contact.id, ids))
    }
  })

  test('rejects updates to a merged tombstone', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const teamId = await activeTeamId(request, sessionCookie)
    const ids: string[] = [randomUUID(), randomUUID()]

    await db.insert(contact).values(
      ids.map((id) => ({ id, teamId, name: id, createdAt: new Date(), updatedAt: new Date() }))
    )

    try {
      const mergeResponse = await request.post(`/api/support/contacts/${ids[0]}/merge`, {
        headers: withAuthHeaders(sessionCookie),
        data: { sourceContactId: ids[1] },
      })
      expect(mergeResponse.status()).toBe(200)

      const updateResponse = await request.put(`/api/support/contacts/${ids[1]}`, {
        headers: withAuthHeaders(sessionCookie),
        data: { name: 'must remain a tombstone' },
      })
      expect(updateResponse.status()).toBe(400)

      const [tombstone] = await db.select().from(contact).where(eq(contact.id, ids[1]))
      expect(tombstone.mergedIntoContactId).toBe(ids[0])
      expect(tombstone.name).toBe(ids[1])
    } finally {
      await db.delete(contact).where(inArray(contact.id, ids))
    }
  })

  test('serializes concurrent inverse merges and preserves identities and links', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const teamId = await activeTeamId(request, sessionCookie)

    // Repeat the actual inverse race. The a/b prefixes make the first request
    // and second request acquire rows in opposite request order when an
    // implementation omits stable lock ordering, exposing a deadlock instead
    // of allowing the test to silently become sequential.
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const ids: string[] = [`merge-race-${iteration}-a-${randomUUID()}`, `merge-race-${iteration}-b-${randomUUID()}`]
      const createdAt = new Date()
      await db.insert(contact).values(
        ids.map((id) => ({ id, teamId, name: id, createdAt, updatedAt: createdAt }))
      )
      await db.insert(contactIdentity).values(
        ids.map((id, index) => ({
          id: randomUUID(),
          contactId: id,
          teamId,
          kind: 'email',
          value: `merge-${iteration}-${index}-${id}@example.com`,
          createdAt,
        }))
      )
      await db.insert(contactLink).values(
        ids.map((id, index) => ({
          id: randomUUID(),
          contactId: id,
          entityType: 'feedback',
          entityId: `merge-${iteration}-${index}-${id}`,
          source: 'agent',
          createdAt,
        }))
      )

      try {
        const [first, inverse] = await Promise.all([
          request.post(`/api/support/contacts/${ids[0]}/merge`, {
            headers: withAuthHeaders(sessionCookie),
            data: { sourceContactId: ids[1] },
            timeout: 15_000,
          }),
          request.post(`/api/support/contacts/${ids[1]}/merge`, {
            headers: withAuthHeaders(sessionCookie),
            data: { sourceContactId: ids[0] },
            timeout: 15_000,
          }),
        ])
        expect([first.status(), inverse.status()].sort()).toEqual([200, 400])

        const rows = await db.select().from(contact).where(inArray(contact.id, ids))
        expect(rows).toHaveLength(2)
        const activeRows = rows.filter((row) => row.mergedIntoContactId === null)
        expect(activeRows).toHaveLength(1)
        const survivorId = activeRows[0].id
        const tombstone = rows.find((row) => row.id !== survivorId)
        expect(tombstone?.mergedIntoContactId).toBe(survivorId)

        const identities = await db.select().from(contactIdentity).where(inArray(contactIdentity.contactId, ids))
        const links = await db.select().from(contactLink).where(inArray(contactLink.contactId, ids))
        expect(identities).toHaveLength(2)
        expect(identities.every((identity) => identity.contactId === survivorId)).toBe(true)
        expect(links).toHaveLength(2)
        expect(links.every((link) => link.contactId === survivorId)).toBe(true)
      } finally {
        await db.delete(contact).where(inArray(contact.id, ids))
      }
    }
  })
})
