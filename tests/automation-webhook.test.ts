import { describe, expect, it } from 'vitest'
import { validateAutomationWebhookActions } from '~/server/utils/automation-webhook'

describe('automation webhook action validation', () => {
  it('rejects unsafe webhook URLs for updates as well as creates', () => {
    expect(() => validateAutomationWebhookActions([{ type: 'call_webhook', url: 'http://127.0.0.1/hook' }])).toThrow(
      'private or local'
    )
  })

  it('ignores non-webhook actions', () => {
    expect(() => validateAutomationWebhookActions([{ type: 'set_status' }])).not.toThrow()
  })
})
