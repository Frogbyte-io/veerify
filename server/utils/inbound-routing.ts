interface InboundProjectInput {
  addressProjectId: string | null | undefined
  /** Legacy inbox-wide mapping retained for migration/UI compatibility. */
  inboxProjectId: string | null | undefined
}

/**
 * New inbound conversations are attributed only by the receiving address.
 * An unmapped address is deliberately left for an agent to classify.
 */
export function resolveInboundProjectId({ addressProjectId }: InboundProjectInput): string | null {
  return addressProjectId ?? null
}
