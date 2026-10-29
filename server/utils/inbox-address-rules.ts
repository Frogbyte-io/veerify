/**
 * Rules for the receiving addresses an inbox admin enters by hand
 * (`/api/support/inboxes/[id]/addresses`): address syntax including the
 * catch-all form, the project mail domain an address sits on, and the product
 * tag. See docs/plans/2026-10-28-email-addresses/design.md.
 */
import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import type { projectMailAddress } from '~/server/database/schema/support'
import { projectMailDomain } from '~/server/database/schema/support'
import { CATCH_ALL_LOCAL_PART, isCatchAllAddress, splitMailAddress } from '~/lib/mail-address'
import { createErrorResponse } from './response'

type Executor = Pick<typeof db, 'select'>

const emailSchema = z.string().email()

/** Longest address accepted, as before the catch-all form existed. */
export const MAX_ADDRESS_LENGTH = 320

export type ParsedReceivingAddress =
  | { ok: true; address: string; domain: string; isCatchAll: boolean }
  | { ok: false; message: string }

/**
 * Validate and normalize (trim, lowercase) a receiving address. Accepts an
 * ordinary email address, or the catch-all form `*@domain` whose local part is
 * exactly `*`. zod's `.email()` rejects `*`, so the catch-all domain is checked
 * by validating a stand-in local part on the same domain instead.
 */
export function parseReceivingAddress(raw: unknown): ParsedReceivingAddress {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter an email address.' }
  const address = raw.trim().toLowerCase()
  if (!address || address.length > MAX_ADDRESS_LENGTH) return { ok: false, message: 'Enter an email address.' }

  const parts = splitMailAddress(address)
  if (!parts) return { ok: false, message: 'Enter an email address.' }

  if (parts.localPart === CATCH_ALL_LOCAL_PART) {
    if (!emailSchema.safeParse(`catch-all@${parts.domain}`).success) {
      return { ok: false, message: 'Enter a valid domain after *@.' }
    }
    return { ok: true, address, domain: parts.domain, isCatchAll: true }
  }
  if (parts.localPart.includes('*')) {
    return { ok: false, message: 'A catch-all address is written *@domain, with nothing else before the @.' }
  }
  if (!emailSchema.safeParse(address).success) return { ok: false, message: 'Enter a valid email address.' }
  return { ok: true, address, domain: parts.domain, isCatchAll: false }
}

export function addressError(statusCode: number, code: string, message: string) {
  const statusMessage =
    statusCode === 400
      ? 'Bad Request'
      : statusCode === 404
        ? 'Not Found'
        : statusCode === 409
          ? 'Conflict'
          : 'Unprocessable Entity'
  return createError({ statusCode, statusMessage, data: { ...createErrorResponse(code, message), code } })
}

/** The project's mail domain row whose name equals `domain` exactly, ignoring rows being deleted. */
export async function findProjectMailDomain(
  projectId: string,
  domain: string,
  executor: Executor = db
): Promise<{ id: string; status: string } | null> {
  const [row] = await executor
    .select({ id: projectMailDomain.id, status: projectMailDomain.status })
    .from(projectMailDomain)
    .where(
      and(
        eq(projectMailDomain.projectId, projectId),
        eq(projectMailDomain.domain, domain),
        ne(projectMailDomain.status, 'deleting')
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The `domainId` to store for a custom address: the project's mail domain the
 * address is exactly on, or null. A catch-all needs one: 422
 * `CATCH_ALL_DOMAIN_REQUIRED` otherwise, because `*@domain` routes every
 * unlisted address of a domain and must only exist on a domain the project
 * has connected.
 */
export async function resolveAddressDomainId(
  projectId: string,
  parsed: { domain: string; isCatchAll: boolean },
  executor: Executor = db
): Promise<string | null> {
  const domain = await findProjectMailDomain(projectId, parsed.domain, executor)
  if (parsed.isCatchAll && !domain) {
    throw addressError(
      422,
      'CATCH_ALL_DOMAIN_REQUIRED',
      `A catch-all needs ${parsed.domain} to be one of this project's email domains. Connect the domain first.`
    )
  }
  return domain?.id ?? null
}

/** 422 `PRODUCT_NOT_IN_PROJECT` unless `productId` is a product of `projectId`. */
export async function assertProductInProject(projectId: string, productId: string, executor: Executor = db) {
  const [row] = await executor
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.id, productId), eq(product.projectId, projectId)))
    .limit(1)
  if (!row) {
    throw addressError(422, 'PRODUCT_NOT_IN_PROJECT', "The product does not belong to this inbox's project.")
  }
}

export type InboxAddressRow = typeof projectMailAddress.$inferSelect

/** An address row as the address API returns it. */
export function toInboxAddressResponse(row: InboxAddressRow) {
  return { ...row, isCatchAll: isCatchAllAddress(row.address) }
}
