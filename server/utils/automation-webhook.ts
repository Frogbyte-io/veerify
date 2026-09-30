import { validateWebhookUrlSyntax } from '~/server/utils/webhook-url'

type AutomationAction = {
  type: string
  url?: unknown
  value?: unknown
}

export function validateAutomationWebhookActions(actions: readonly AutomationAction[]) {
  for (const action of actions) {
    if (action.type !== 'call_webhook') continue
    const url = typeof action.url === 'string' ? action.url : typeof action.value === 'string' ? action.value : ''
    validateWebhookUrlSyntax(url)
  }
}
