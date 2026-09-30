export type CannedResponseSubstitutionContext = {
  contact?: {
    name?: string | null
  } | null
  agent?: {
    name?: string | null
  } | null
}

export function substituteCannedResponse(body: string, context: CannedResponseSubstitutionContext) {
  return body
    .replaceAll('{{contact.name}}', context.contact?.name || '')
    .replaceAll('{{agent.name}}', context.agent?.name || '')
}

export function insertTextAtCursor(value: string, insertion: string, cursor: number, replaceStart = cursor) {
  const safeCursor = Math.min(Math.max(0, cursor), value.length)
  const safeReplaceStart = Math.min(Math.max(0, replaceStart), safeCursor)
  return {
    value: `${value.slice(0, safeReplaceStart)}${insertion}${value.slice(safeCursor)}`,
    cursor: safeReplaceStart + insertion.length,
  }
}
