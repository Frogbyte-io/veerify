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
