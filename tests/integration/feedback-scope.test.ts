import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { feedback, product, project } from '../../server/database/schema/feedback'
import { changelogEntry, changelogEntryProduct } from '../../server/database/schema/changelog'
import { resolveFeedbackListScope } from '../../server/utils/feedback-access'
import { listEntries } from '../../server/services/changelog/entries'
import { listPublishedEntries } from '../../server/services/changelog/public'

const key = randomUUID().slice(0, 8)
const ids = {
  org: `scope_org_${key}`,
  member: `scope_member_${key}`,
  outsider: `scope_outsider_${key}`,
  pubProject: `scope_pub_${key}`,
  privProject: `scope_priv_${key}`,
  prodA: `scope_prod_a_${key}`,
  prodB: `scope_prod_b_${key}`,
  prodPriv: `scope_prod_priv_${key}`,
  fbVisible: `scope_fb_visible_${key}`,
  fbHidden: `scope_fb_hidden_${key}`,
  fbPrivateProduct: `scope_fb_privprod_${key}`,
  fbPrivateProject: `scope_fb_privproj_${key}`,
}
const entryIds = {
  whole: `scope_entry_whole_${key}`,
  a: `scope_entry_a_${key}`,
  privOnly: `scope_entry_privonly_${key}`,
  both: `scope_entry_both_${key}`,
}

const now = new Date()

async function visibleFeedbackIds(projectIds: string[], userId: string | null) {
  const { condition } = await resolveFeedbackListScope(projectIds, userId)
  const rows = await db.select({ id: feedback.id }).from(feedback).where(condition)
  return rows.map((r) => r.id).sort()
}

beforeAll(async () => {
  await db.insert(organization).values({ id: ids.org, name: 'Scope Org', slug: `scope-org-${key}` })
  await db.insert(user).values([
    { id: ids.member, name: 'Member', email: `member-${key}@example.test` },
    { id: ids.outsider, name: 'Outsider', email: `outsider-${key}@example.test` },
  ])
  await db.insert(member).values({ id: `scope_m_${key}`, organizationId: ids.org, userId: ids.member, role: 'member' })
  await db.insert(project).values([
    { id: ids.pubProject, organizationId: ids.org, slug: 'pub', name: 'Public', isPublic: true },
    { id: ids.privProject, organizationId: ids.org, slug: 'priv', name: 'Private', isPublic: false },
  ])
  await db.insert(product).values([
    { id: ids.prodA, projectId: ids.pubProject, name: 'A', slug: 'a', isPublic: true, sortOrder: 0 },
    { id: ids.prodB, projectId: ids.pubProject, name: 'B', slug: 'b', isPublic: false, sortOrder: 1 },
    { id: `${ids.prodPriv}`, projectId: ids.privProject, name: 'P', slug: 'p', isPublic: true, sortOrder: 0 },
  ])
  const base = { body: 'x', createdAt: now, updatedAt: now }
  await db.insert(feedback).values([
    { ...base, id: ids.fbVisible, projectId: ids.pubProject, productId: ids.prodA, title: 'Visible' },
    { ...base, id: ids.fbHidden, projectId: ids.pubProject, productId: ids.prodA, title: 'Hidden', isHidden: true },
    { ...base, id: ids.fbPrivateProduct, projectId: ids.pubProject, productId: ids.prodB, title: 'In private product' },
    {
      ...base,
      id: ids.fbPrivateProject,
      projectId: ids.privProject,
      productId: ids.prodPriv,
      title: 'Private project',
    },
  ])

  const entry = (id: string, slug: string) => ({
    id,
    projectId: ids.pubProject,
    title: slug,
    slug,
    body: 'body',
    status: 'published' as const,
    publishedAt: new Date(now.getTime() + 1000),
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(changelogEntry)
    .values([
      entry(entryIds.whole, 'whole'),
      entry(entryIds.a, 'only-a'),
      entry(entryIds.privOnly, 'only-private'),
      entry(entryIds.both, 'a-and-private'),
    ])
  await db.insert(changelogEntryProduct).values([
    { entryId: entryIds.a, productId: ids.prodA },
    { entryId: entryIds.privOnly, productId: ids.prodB },
    { entryId: entryIds.both, productId: ids.prodA },
    { entryId: entryIds.both, productId: ids.prodB },
  ])
})

afterAll(async () => {
  await db.delete(project).where(inArray(project.id, [ids.pubProject, ids.privProject]))
  await db.delete(user).where(inArray(user.id, [ids.member, ids.outsider]))
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('feedback list scope', () => {
  it('members see everything in their projects, including hidden and private-product items', async () => {
    expect(await visibleFeedbackIds([ids.pubProject], ids.member)).toEqual(
      [ids.fbVisible, ids.fbHidden, ids.fbPrivateProduct].sort()
    )
    expect(await visibleFeedbackIds([ids.privProject], ids.member)).toEqual([ids.fbPrivateProject])
  })

  it('anonymous callers and non-members only see non-hidden items of public products', async () => {
    expect(await visibleFeedbackIds([ids.pubProject], null)).toEqual([ids.fbVisible])
    expect(await visibleFeedbackIds([ids.pubProject], ids.outsider)).toEqual([ids.fbVisible])
  })

  it('refuses private projects the caller cannot open, and unknown ids', async () => {
    await expect(resolveFeedbackListScope([ids.privProject], null)).rejects.toMatchObject({ statusCode: 403 })
    await expect(resolveFeedbackListScope([ids.privProject], ids.outsider)).rejects.toMatchObject({ statusCode: 403 })
    await expect(resolveFeedbackListScope([ids.pubProject, ids.privProject], ids.outsider)).rejects.toMatchObject({
      statusCode: 403,
    })
    await expect(resolveFeedbackListScope(['nope'], ids.member)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('membersOnly (export) refuses public viewers', async () => {
    await expect(resolveFeedbackListScope([ids.pubProject], null, { membersOnly: true })).rejects.toMatchObject({
      statusCode: 403,
    })
    await expect(resolveFeedbackListScope([ids.pubProject], ids.outsider, { membersOnly: true })).rejects.toMatchObject(
      { statusCode: 403 }
    )
  })
})

describe('changelog product tagging', () => {
  it('dashboard list filters by product: tagged with it or untagged', async () => {
    const { entries } = await listEntries(ids.pubProject, { productId: ids.prodA })
    expect(entries.map((e) => e.id).sort()).toEqual([entryIds.whole, entryIds.a, entryIds.both].sort())

    const forB = await listEntries(ids.pubProject, { productId: ids.prodB })
    expect(forB.entries.map((e) => e.id).sort()).toEqual([entryIds.whole, entryIds.privOnly, entryIds.both].sort())

    const all = await listEntries(ids.pubProject, {})
    expect(all.entries).toHaveLength(4)
  })

  it('public list excludes entries tagged only with private products and hides private product ids', async () => {
    const { entries } = await listPublishedEntries(ids.pubProject)
    expect(entries.map((e) => e.id).sort()).toEqual([entryIds.whole, entryIds.a, entryIds.both].sort())
    const both = entries.find((e) => e.id === entryIds.both)
    expect(both?.productIds).toEqual([ids.prodA])
  })

  it('public list with a product filter keeps untagged entries', async () => {
    const { entries } = await listPublishedEntries(ids.pubProject, { productId: ids.prodA })
    expect(entries.map((e) => e.id).sort()).toEqual([entryIds.whole, entryIds.a, entryIds.both].sort())
  })
})
