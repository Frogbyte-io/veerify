import { randomInt, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportInbox, supportInboxAddress } from '~/server/database/schema/support'

/**
 * Platform forwarding addresses (design §9.1).
 *
 * A customer forwards `support@acme.com` to `<project>-<inbox>-<random>@<platform
 * domain>`. The envelope recipient then identifies the inbox, so no DNS change
 * is needed on the customer's domain. The random suffix stops people guessing
 * addresses to spam an inbox. Only active when `SUPPORT_PLATFORM_MAIL_DOMAIN`
 * is set.
 */

type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const SUFFIX_LENGTH = 6
const MAX_LOCAL_PART_LENGTH = 64
const MAX_INSERT_ATTEMPTS = 5

export type PlatformAddressRow = typeof supportInboxAddress.$inferSelect

/** The normalized platform receiving domain, or null when the feature is off. */
export function getPlatformMailDomain(): string | null {
  const domain = (process.env.SUPPORT_PLATFORM_MAIL_DOMAIN ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\.+$/, '')
  return domain.length > 0 ? domain : null
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function randomSuffix(random: (max: number) => number): string {
  let out = ''
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) out += BASE32_ALPHABET[random(BASE32_ALPHABET.length)]
  return out
}

/**
 * `<projectSlug>-<inboxSlug>-<6 random base32>@<domain>`. The readable prefix is
 * trimmed so the whole local part stays within 64 characters; the random
 * suffix is never trimmed.
 */
export function buildPlatformAddress(
  input: { projectSlug: string; inboxSlug: string; domain: string },
  random: (max: number) => number = randomInt
): string {
  const suffix = randomSuffix(random)
  const prefix = [slugPart(input.projectSlug), slugPart(input.inboxSlug)].filter(Boolean).join('-') || 'inbox'
  const maxPrefix = MAX_LOCAL_PART_LENGTH - suffix.length - 1
  const trimmed = prefix.slice(0, maxPrefix).replace(/-+$/, '') || 'inbox'
  return `${trimmed}-${suffix}@${input.domain}`
}

export async function findPlatformAddress(
  inboxId: string,
  executor: Executor = db
): Promise<PlatformAddressRow | null> {
  const [row] = await executor
    .select()
    .from(supportInboxAddress)
    .where(and(eq(supportInboxAddress.inboxId, inboxId), eq(supportInboxAddress.kind, 'platform')))
    .limit(1)
  return row ?? null
}

/**
 * Create the inbox's platform address unless it already has one (idempotent).
 * With `regenerate`, the existing row is removed and a fresh address issued.
 * Returns null when no platform domain is configured. When regenerating, an
 * inbox whose From (`emailAddress`) is the old platform address is moved to the
 * new one in the same transaction, so its replies keep authorizing.
 *
 * Must run inside a transaction (the caller's `tx`): a transaction-scoped
 * advisory lock per inbox serializes concurrent requests, since the schema has
 * no unique index on (inbox, kind). A collision on the globally unique address
 * is retried with a new random suffix.
 */
export async function ensurePlatformAddress(
  executor: Executor,
  inbox: { id: string; slug: string; projectId: string },
  projectSlug: string,
  options: { regenerate?: boolean; random?: (max: number) => number } = {}
): Promise<PlatformAddressRow | null> {
  const domain = getPlatformMailDomain()
  if (!domain) return null

  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform_address:${inbox.id}`}, 0))`)

  let replaced: string | null = null
  if (!options.regenerate) {
    const existing = await findPlatformAddress(inbox.id, executor)
    if (existing) return existing
  } else {
    replaced = (await findPlatformAddress(inbox.id, executor))?.address ?? null
    await executor
      .delete(supportInboxAddress)
      .where(and(eq(supportInboxAddress.inboxId, inbox.id), eq(supportInboxAddress.kind, 'platform')))
  }

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const address = buildPlatformAddress({ projectSlug, inboxSlug: inbox.slug, domain }, options.random)
    const [created] = await executor
      .insert(supportInboxAddress)
      .values({
        id: randomUUID(),
        inboxId: inbox.id,
        projectId: inbox.projectId,
        address,
        kind: 'platform',
        isPrimary: false,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning()
    if (created) {
      if (replaced) {
        await executor
          .update(supportInbox)
          .set({ emailAddress: created.address, updatedAt: new Date() })
          .where(
            and(eq(supportInbox.id, inbox.id), sql`lower(${supportInbox.emailAddress}) = ${replaced.toLowerCase()}`)
          )
      }
      return created
    }

    // The random address collided with an existing one: try another suffix.
  }

  throw new Error('Could not allocate a unique platform address')
}
