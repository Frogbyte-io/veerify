import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'

import { db } from '../../server/database/drizzle'
import { organization, team, teamMember, user } from '../../server/database/schema/auth'
import { feedback, project } from '../../server/database/schema/feedback'
import { contact, contactLink } from '../../server/database/schema/support'
import {
  DEFAULT_TIMELINE_LIMIT,
  getContactTimeline,
  MAX_TIMELINE_LIMIT,
} from '../../server/utils/support-timeline'

const ids = {
  org: `timeline_page_org_${randomUUID()}`,
  team: `timeline_page_team_${randomUUID()}`,
  member: `timeline_page_member_${randomUUID()}`,
  user: `timeline_page_user_${randomUUID()}`,
  project: `timeline_page_project_${randomUUID()}`,
  contact: `timeline_page_contact_${randomUUID()}`,
  otherContact: `timeline_page_other_contact_${randomUUID()}`,
}
const feedbackIds: string[] = []
const contactIds = [ids.contact, ids.otherContact]
const now = new Date('2026-08-26T12:00:00.000Z')

describe('support contact timeline pagination (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({
      id: ids.org,
      name: 'Timeline pagination org',
      slug: `timeline-pagination-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(team).values({
      id: ids.team,
      name: 'Timeline pagination team',
      slug: `timeline-pagination-team-${randomUUID()}`,
      organizationId: ids.org,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(user).values({
      id: ids.user,
      name: 'Timeline customer',
      email: `timeline-pagination-${randomUUID()}@example.com`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(teamMember).values({
      id: ids.member,
      teamId: ids.team,
      userId: ids.user,
      role: 'member',
      createdAt: now,
    })
    await db.insert(project).values({
      id: ids.project,
      organizationId: ids.org,
      teamId: ids.team,
      slug: `timeline-pagination-project-${randomUUID()}`,
      name: 'Timeline pagination project',
      description: 'Fixture',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(contact).values([
      { id: ids.contact, teamId: ids.team, name: 'Timeline contact', email: 'timeline@example.com', createdAt: now, updatedAt: now },
      { id: ids.otherContact, teamId: ids.team, name: 'Other timeline contact', createdAt: now, updatedAt: now },
    ])
  })

  beforeEach(async () => {
    await db.delete(contactLink).where(inArray(contactLink.entityId, feedbackIds))
    if (feedbackIds.length) await db.delete(feedback).where(inArray(feedback.id, feedbackIds))
    feedbackIds.length = 0
  })

  afterAll(async () => {
    await db.delete(contactLink).where(inArray(contactLink.contactId, contactIds))
    await db.delete(feedback).where(inArray(feedback.id, feedbackIds))
    await db.delete(contact).where(inArray(contact.id, contactIds))
    await db.delete(project).where(eq(project.id, ids.project))
    await db.delete(teamMember).where(eq(teamMember.id, ids.member))
    await db.delete(user).where(eq(user.id, ids.user))
    await db.delete(organization).where(eq(organization.id, ids.org))
  })

  async function addFeedback(id: string, createdAt: Date) {
    feedbackIds.push(id)
    await db.insert(feedback).values({
      id,
      projectId: ids.project,
      title: id,
      authorEmail: 'timeline@example.com',
      createdAt,
      updatedAt: createdAt,
    })
  }

  async function addLink(id: string, contactId: string, createdAt: Date) {
    await db.insert(contactLink).values({
      id: `timeline-page-link-${id}`,
      contactId,
      entityType: 'feedback',
      entityId: id,
      source: 'agent',
      createdAt,
    })
  }

  it('paginates linked and probable feedback independently, preserving ties and excluding links to any contact', async () => {
    const tied = new Date('2026-08-26T11:00:00.000Z')
    await addFeedback('timeline-page-linked-a', tied)
    await addFeedback('timeline-page-linked-b', tied)
    await addFeedback('timeline-page-probable-a', tied)
    await addFeedback('timeline-page-probable-b', tied)
    await addFeedback('timeline-page-excluded', tied)
    await addLink('timeline-page-linked-a', ids.contact, tied)
    await addLink('timeline-page-linked-b', ids.contact, tied)
    await addLink('timeline-page-excluded', ids.otherContact, tied)

    expect(DEFAULT_TIMELINE_LIMIT).toBe(25)
    expect(MAX_TIMELINE_LIMIT).toBe(100)

    const first = await getContactTimeline(
      { id: ids.contact, teamId: ids.team, email: 'timeline@example.com', userId: null },
      { limit: 1 }
    )
    expect(first.linked.map((row) => row.entityId)).toEqual(['timeline-page-linked-b'])
    expect(first.linkedHasMore).toBe(true)
    expect(first.probableFeedback.map((row) => row.id)).toEqual(['timeline-page-probable-b'])
    expect(first.probableHasMore).toBe(true)
    expect(first.probableFeedback.map((row) => row.id)).not.toContain('timeline-page-excluded')

    const linkedNext = await getContactTimeline(
      { id: ids.contact, teamId: ids.team, email: 'timeline@example.com', userId: null },
      { limit: 1, linkedCursor: first.linkedNextCursor! }
    )
    expect(linkedNext.linked.map((row) => row.entityId)).toEqual(['timeline-page-linked-a'])
    expect(linkedNext.probableFeedback.map((row) => row.id)).toEqual(['timeline-page-probable-b'])

    const probableNext = await getContactTimeline(
      { id: ids.contact, teamId: ids.team, email: 'timeline@example.com', userId: null },
      { limit: 1, probableCursor: first.probableNextCursor! }
    )
    expect(probableNext.linked.map((row) => row.entityId)).toEqual(['timeline-page-linked-b'])
    expect(probableNext.probableFeedback.map((row) => row.id)).toEqual(['timeline-page-probable-a'])
    expect(probableNext.probableFeedback.map((row) => row.id)).not.toContain('timeline-page-excluded')
  })
})
