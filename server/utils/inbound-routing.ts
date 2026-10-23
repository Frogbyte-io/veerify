interface InboundProjectInput {
  addressProjectId: string | null | undefined
  /** Legacy inbox-wide mapping retained for migration/UI compatibility. */
  inboxProjectId: string | null | undefined
  /** `kind` of the address row the inbox was resolved through. */
  addressKind?: string | null
  /**
   * The resolved inbox's own custom addresses. Only consulted for a platform
   * address, and only ever this inbox's - never another tenant's.
   */
  inboxCustomAddresses?: { address: string; projectId: string | null }[]
  /** `To` then `Cc` header recipients of the message, in that order. */
  headerRecipients?: { address: string }[]
}

/**
 * New inbound conversations are attributed only by the receiving address.
 * An unmapped address is deliberately left for an agent to classify.
 *
 * Forwarding changes what "receiving address" means: mail forwarded from
 * `support@acme.com` to a platform address carries the platform address as the
 * envelope recipient, which identifies the inbox but no product. For that case
 * the `To`/`Cc` headers are tried against the same inbox's custom addresses to
 * recover the per-product mapping (delta D-27). The inbox is already fixed by
 * the envelope, so a header naming some other tenant's address attributes
 * nothing.
 */
export function resolveInboundProjectId({
  addressProjectId,
  addressKind,
  inboxCustomAddresses,
  headerRecipients,
}: InboundProjectInput): string | null {
  if (addressKind !== 'platform') return addressProjectId ?? null

  if (addressProjectId) return addressProjectId

  const byAddress = new Map<string, string | null>()
  for (const custom of inboxCustomAddresses ?? []) byAddress.set(custom.address.trim().toLowerCase(), custom.projectId)

  for (const recipient of headerRecipients ?? []) {
    const projectId = byAddress.get(recipient.address.trim().toLowerCase())
    if (projectId) return projectId
  }
  return null
}

/**
 * Structural, like `ThreadableMessage` in `inbound-threading.ts`, so
 * `server/utils` does not depend on the channel adapter's types.
 */
interface InboundAddress {
  address: string
  name?: string
}

interface RoutableMessage {
  envelopeRecipients: InboundAddress[]
  to: InboundAddress[]
  cc: InboundAddress[]
}

/**
 * The addresses an inbound message is matched against an inbox by, in the
 * order they are tried. The first one that resolves wins.
 *
 * The envelope recipients come first and, when the provider reported any,
 * exclusively: they are where the mail was actually delivered. A Bcc'd,
 * forwarded or aliased copy reaches the inbox only by envelope, and a To/Cc
 * header naming some other Veerify inbox must not pull the message there.
 * Only a provider that reports no envelope falls back to To, then Cc - the
 * support address is frequently in Cc on a reply-all.
 *
 * Duplicates are dropped keeping the first occurrence, so the order (and
 * therefore the chosen inbox) is a pure function of the payload.
 */
export function inboundRoutingRecipients(message: RoutableMessage): InboundAddress[] {
  const candidates = message.envelopeRecipients.length > 0 ? message.envelopeRecipients : [...message.to, ...message.cc]

  const seen = new Set<string>()
  const ordered: InboundAddress[] = []
  for (const candidate of candidates) {
    const address = candidate.address.trim().toLowerCase()
    if (!address || seen.has(address)) continue
    seen.add(address)
    ordered.push({ ...candidate, address })
  }
  return ordered
}
