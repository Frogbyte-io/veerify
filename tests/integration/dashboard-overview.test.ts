import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, user } from '../../server/database/schema/auth'
import { feedback, feedbackStatus, product, project, vote } from '../../server/database/schema/feedback'
import { changelogEntry } from '../../server/database/schema/changelog'
import { contact, conversation, supportInbox } from '../../server/database/schema/support'
import { getOverview } from '../../server/services/overview/overview'

const key = randomUUID().slice(0, 8)
const ids = {
  org: `ov_org_${key}`,
  user: `ov_user_${key}`,
  a: `ov_a_${key}`,
  b: `ov_b_${key}`,
  prodA: `ov_prod_a_${key}`,
  prodB: `ov_prod_b_${key}`,
  inboxA: `ov_inbox_a_${key}`,
  inboxB: `ov_inbox_b_${key}`,
  contactA: `ov_contact_a_${key}`,
  contactB: `ov_contact_b_${key}`,
}

const now = new Date()
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
const DAY = 24 * 60

let displayId = 0
const conv = (
  id: string,
  over: Partial<typeof conversation.$inferInsert> & { createdAt: Date; inboxId?: string; projectId?: string }
): typeof conversation.$inferInsert => ({
  id: `${id}_${key}`,
  inboxId: ids.inboxA,
  contactId: ids.contactA,
  projectId: ids.a,
  displayId: ++displayId,
  subject: id,
  status: 'open',
  updatedAt: now,
  ...over,
})

const projectsInScope = (roleB: 'admin' | 'member') => [
  {
    id: ids.a,
    name: 'A',
    slug: 'a',
    role: 'admin' as const,
    settings: { supportEnabled: true, feedbackEnabled: true, changelogEnabled: true },
  },
  { id: ids.b, name: 'B', slug: 'b', role: roleB, settings: { supportEnabled: true, feedbackEnabled: false } },
]

beforeAll(async () => {
  await db.insert(organization).values({ id: ids.org, name: 'Overview Org', slug: `ov-org-${key}` })
  await db.insert(user).values({ id: ids.user, name: 'Agent', email: `agent-${key}@example.test` })
  await db.insert(project).values([
    { id: ids.a, organizationId: ids.org, slug: 'a', name: 'A' },
    { id: ids.b, organizationId: ids.org, slug: 'b', name: 'B' },
  ])
  await db.insert(product).values([
    { id: ids.prodA, projectId: ids.a, name: 'A', slug: 'a', sortOrder: 0 },
    { id: ids.prodB, projectId: ids.b, name: 'B', slug: 'b', sortOrder: 0 },
  ])
  await db.insert(supportInbox).values([
    { id: ids.inboxA, projectId: ids.a, name: 'A inbox', slug: 'a' },
    { id: ids.inboxB, projectId: ids.b, name: 'B inbox', slug: 'b' },
  ])
  await db.insert(contact).values([
    { id: ids.contactA, projectId: ids.a, name: 'Marta', email: 'marta@example.test' },
    { id: ids.contactB, projectId: ids.b, name: 'Jon', email: 'jon@example.test' },
  ])

  // Project A. Replied: c1 (30 min), c2 (90 min). Waiting: c3 (SLA due in 10 min), c4, c8 (customer wrote last).
  await db.insert(conversation).values([
    conv('c1', { createdAt: ago(DAY), firstResponseAt: ago(DAY - 30), lastAgentReplyAt: ago(DAY - 30) }),
    conv('c2', { createdAt: ago(2 * DAY), firstResponseAt: ago(2 * DAY - 90), lastAgentReplyAt: ago(2 * DAY - 90) }),
    conv('c3', { createdAt: ago(180), firstResponseDueAt: new Date(now.getTime() + 10 * 60_000) }),
    conv('c4', { createdAt: ago(300) }),
    // Previous 7 days: answered after 120 minutes
    conv('c5', {
      createdAt: ago(10 * DAY),
      firstResponseAt: ago(10 * DAY - 120),
      lastAgentReplyAt: ago(10 * DAY - 120),
    }),
    // Spam and resolved conversations never wait
    conv('c6', { createdAt: ago(60), spamAt: ago(30) }),
    conv('c7', { createdAt: ago(DAY), status: 'resolved' }),
    conv('c8', {
      createdAt: ago(6 * DAY),
      lastAgentReplyAt: ago(5 * DAY),
      lastCustomerReplyAt: ago(DAY),
      firstResponseAt: ago(6 * DAY - 60),
    }),
    // Project B: the user has no access to this inbox as a plain member
    conv('b1', { createdAt: ago(120), inboxId: ids.inboxB, contactId: ids.contactB, projectId: ids.b }),
  ])

  await db.insert(feedbackStatus).values([
    { id: `ov_s_new_${key}`, projectId: ids.a, name: 'New', value: 'new', sortOrder: 0, isDefault: true },
    { id: `ov_s_open_${key}`, projectId: ids.a, name: 'Open', value: 'open', sortOrder: 1, isDefault: false },
  ])
  const post = (id: string, status: string, createdAt: Date, over: Partial<typeof feedback.$inferInsert> = {}) => ({
    id: `${id}_${key}`,
    projectId: ids.a,
    productId: ids.prodA,
    title: id,
    status,
    createdAt,
    updatedAt: now,
    ...over,
  })
  await db.insert(feedback).values([
    post('f1', 'new', ago(DAY)),
    post('f2', 'new', ago(2 * DAY)),
    post('f3', 'open', ago(DAY)),
    post('f4', 'new', ago(DAY), { isHidden: true }),
    post('f5', 'new', ago(10 * DAY)),
    // Project B has Feedback off
    post('fb', 'open', ago(DAY), { projectId: ids.b, productId: ids.prodB }),
  ])
  const ballot = (id: string, feedbackId: string, createdAt: Date, type = 'upvote') => ({
    id: `${id}_${key}`,
    feedbackId: `${feedbackId}_${key}`,
    createdAt,
    type,
  })
  await db
    .insert(vote)
    .values([
      ballot('v1', 'f1', ago(60)),
      ballot('v2', 'f1', ago(120)),
      ballot('v3', 'f3', ago(DAY)),
      ballot('v4', 'f5', ago(9 * DAY)),
      ballot('v5', 'f4', ago(60)),
      ballot('v6', 'f1', ago(60), 'downvote'),
    ])

  await db.insert(changelogEntry).values([
    { id: `ov_d1_${key}`, projectId: ids.a, title: 'Draft', slug: 'draft', status: 'draft', createdAt: ago(3 * DAY) },
    {
      id: `ov_p1_${key}`,
      projectId: ids.a,
      title: 'Older release',
      slug: 'older',
      status: 'published',
      publishedAt: ago(5 * DAY),
    },
    {
      id: `ov_p2_${key}`,
      projectId: ids.a,
      title: 'Latest release',
      slug: 'latest',
      status: 'published',
      publishedAt: ago(DAY),
    },
    // Project B has the changelog off
    { id: `ov_d2_${key}`, projectId: ids.b, title: 'Hidden draft', slug: 'hidden', status: 'draft' },
  ])
})

afterAll(async () => {
  await db.delete(conversation).where(inArray(conversation.projectId, [ids.a, ids.b]))
  await db.delete(project).where(inArray(project.id, [ids.a, ids.b]))
  await db.delete(user).where(eq(user.id, ids.user))
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('getOverview', () => {
  it('counts what needs attention in the inboxes the user can work in', async () => {
    const { needsYou, projects } = await getOverview(ids.user, projectsInScope('admin'), now)

    expect(needsYou.slaAtRisk.total).toBe(1)
    expect(needsYou.slaAtRisk.items[0]).toMatchObject({
      conversationId: `c3_${key}`,
      inboxId: ids.inboxA,
      contactName: 'Marta',
      project: { id: ids.a },
    })
    // c4 and c8 (the customer wrote last); c3 is listed as SLA, spam and resolved never wait
    expect(needsYou.waiting.total).toBe(2 + 1)
    expect(needsYou.waiting.byProject.map((p) => [p.project.id, p.count])).toEqual([
      [ids.a, 2],
      [ids.b, 1],
    ])
    expect(needsYou.waiting.oldest).toMatchObject({ conversationId: `c8_${key}` })
    expect(projects.find((p) => p.project.id === ids.a)).toMatchObject({ waiting: 3, slaAtRisk: 1 })
  })

  it('leaves out an inbox the user is not a member of', async () => {
    const { needsYou, projects } = await getOverview(ids.user, projectsInScope('member'), now)
    expect(needsYou.waiting.byProject.map((p) => p.project.id)).toEqual([ids.a])
    expect(projects.find((p) => p.project.id === ids.b)).toMatchObject({ inboxAccess: false, waiting: 0 })
  })

  it('counts untriaged posts on the default status, not hidden ones, and only where Feedback is on', async () => {
    const { needsYou } = await getOverview(ids.user, projectsInScope('admin'), now)
    expect(needsYou.untriaged.byProject).toEqual([
      { project: { id: ids.a, name: 'A', slug: 'a' }, count: 3, statusValue: 'new', statusName: 'New' },
    ])
  })

  it('lists unpublished drafts of projects with the changelog on and the last release', async () => {
    const { needsYou, projects } = await getOverview(ids.user, projectsInScope('admin'), now)
    expect(needsYou.drafts.total).toBe(1)
    expect(needsYou.drafts.items.map((d) => d.id)).toEqual([`ov_d1_${key}`])
    expect(projects.find((p) => p.project.id === ids.a)!.lastRelease).toMatchObject({ title: 'Latest release' })
    expect(projects.find((p) => p.project.id === ids.b)!.lastRelease).toBeNull()
  })

  it('compares the last 7 days with the 7 before, with the median over conversations', async () => {
    const { week } = await getOverview(ids.user, projectsInScope('admin'), now)

    // A: c1, c2, c3, c4, c7, c8 (not spam, not the one 10 days ago); B: b1
    expect(week.received).toMatchObject({ current: 7, previous: 1, byProject: { [ids.a]: 6, [ids.b]: 1 } })
    // Answered conversations created in the period: c1 (30 min), c2 (90), c8 (60) -> 60; before: c5 (120)
    expect(week.firstReply).toMatchObject({ current: 60, previous: 120 })
    expect(week.firstReply.byProject[ids.a]).toBe(60)
    expect(week.firstReply.byProject[ids.b]).toBeNull()
    // Posts: f1, f2, f3 (f4 is hidden, B has Feedback off); before: f5
    expect(week.posts).toMatchObject({ current: 3, previous: 1, byProject: { [ids.a]: 3 } })
    // Upvotes on visible posts: v1, v2, v3; before: v4
    expect(week.votes).toMatchObject({ current: 3, previous: 1 })
  })

  it('is empty, not an error, for a project with every tool off', async () => {
    const result = await getOverview(
      ids.user,
      [{ id: ids.b, name: 'B', slug: 'b', role: 'admin', settings: { supportEnabled: false, feedbackEnabled: false } }],
      now
    )
    expect(result.needsYou.waiting.total).toBe(0)
    expect(result.week.received.available).toBe(false)
    expect(result.week.posts.available).toBe(false)
  })
})
