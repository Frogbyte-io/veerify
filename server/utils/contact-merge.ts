/**
 * Pure decision logic for contact merge.
 *
 * Split from the endpoint so the rules can be tested without a database. Merge
 * moves rows between contacts irreversibly, so the guards matter more than the
 * mechanics.
 */

export interface MergeableContact {
  id: string
  teamId: string
  mergedIntoContactId: string | null
  attributes: Record<string, unknown> | null
  name: string | null
  email: string | null
  phone: string | null
  companyId: string | null
}

export type MergeCheck = { ok: true } | { ok: false; reason: string }

/**
 * May `loser` be merged into `survivor`?
 *
 * The cross-team check is the important one: merging contacts from different
 * teams would move one tenant's identities and links under another tenant's
 * contact. Both ids arrive from the request, so team equality cannot be assumed
 * from the caller having access to one of them.
 */
export function canMerge(survivor: MergeableContact, loser: MergeableContact): MergeCheck {
  if (survivor.id === loser.id) {
    return { ok: false, reason: 'A contact cannot be merged into itself' }
  }

  if (survivor.teamId !== loser.teamId) {
    return { ok: false, reason: 'Contacts belong to different teams' }
  }

  if (loser.mergedIntoContactId) {
    return { ok: false, reason: 'Source contact has already been merged' }
  }

  if (survivor.mergedIntoContactId) {
    return { ok: false, reason: 'Target contact has already been merged' }
  }

  return { ok: true }
}

/**
 * A tombstone remains addressable for stale references, but it is no longer a
 * writable contact. Callers must evaluate this after locking the row so a
 * merge that wins the race cannot be followed by an update to the loser.
 */
export function canUpdateContact(candidate: MergeableContact): MergeCheck {
  if (candidate.mergedIntoContactId) {
    return { ok: false, reason: 'Contact has already been merged' }
  }

  return { ok: true }
}

/**
 * Combine attributes, survivor winning on key collisions.
 *
 * The survivor is the record an agent chose to keep, so its values are the more
 * trusted ones. Keys only the loser had are carried over rather than dropped —
 * that is the point of merging rather than deleting.
 */
export function mergeAttributes(
  survivor: Record<string, unknown> | null,
  loser: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!survivor && !loser) return null
  return { ...(loser ?? {}), ...(survivor ?? {}) }
}

/**
 * Fill blank survivor fields from the loser.
 *
 * Only fills what is empty — never overwrites. A merge should not silently
 * replace the name or email an agent was looking at when they chose the
 * survivor, but recovering a phone number the survivor lacked is free value.
 */
export function backfillContactFields(survivor: MergeableContact, loser: MergeableContact) {
  return {
    name: survivor.name ?? loser.name ?? null,
    phone: survivor.phone ?? loser.phone ?? null,
    companyId: survivor.companyId ?? loser.companyId ?? null,
    // `email` is deliberately absent: it is uniquely indexed per team and backed
    // by a contactIdentity row, so changing it here would either collide or
    // desync the identity. The loser's email survives as an identity instead.
  }
}
