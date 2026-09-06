import { describe, expect, it, vi } from 'vitest'

import { attachmentCleanupTask, ATTACHMENT_CLEANUP_TASK_NAME, runScheduledAttachmentCleanup } from '../server/services/scheduler/tasks/attachment-cleanup'
import { clearScheduledTasks, defineScheduledTask } from '../server/services/scheduler/registry'

describe('runScheduledAttachmentCleanup', () => {
  it('registers the expected bounded task name and cadence', () => {
    expect(attachmentCleanupTask.name).toBe(ATTACHMENT_CLEANUP_TASK_NAME)
    expect(attachmentCleanupTask.cron).toBe('*/5 * * * *')
  })

  it('runs one bounded cleanup pass', async () => {
    const runCleanup = vi.fn().mockResolvedValue({ claimed: 2, expired: 1, restored: 1, consumedTempDeleted: 0, deleted: 2, retried: 0 })
    await expect(runScheduledAttachmentCleanup({ runCleanup })).resolves.toMatchObject({ claimed: 2 })
    expect(runCleanup).toHaveBeenCalledOnce()
  })

  it('rethrows a closed failure reason without provider details', async () => {
    const runCleanup = vi.fn().mockRejectedValue(new Error('secret/path/provider detail'))
    await expect(runScheduledAttachmentCleanup({ runCleanup })).rejects.toThrow('ATTACHMENT_CLEANUP_FAILED')
    await expect(runScheduledAttachmentCleanup({ runCleanup })).rejects.not.toThrow('secret/path')
  })

  it('requires cron authentication before invoking a registered task', async () => {
    const { createCronHttpHandler } = await import('../server/services/scheduler/http-handler')
    const originalSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'cron-test-secret'
    const getHeader = vi.fn().mockReturnValue(undefined)
    vi.stubGlobal('getHeader', getHeader)
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input.statusMessage), input))
    clearScheduledTasks()
    const run = vi.fn().mockResolvedValue({ claimed: 0 })
    defineScheduledTask('test:attachment-cleanup', '* * * * *', run)
    const handler = createCronHttpHandler('test:attachment-cleanup')
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(run).not.toHaveBeenCalled()
    getHeader.mockReturnValue('Bearer cron-test-secret')
    await expect(handler({} as never)).resolves.toMatchObject({ success: true, data: { task: 'test:attachment-cleanup' } })
    expect(run).toHaveBeenCalledOnce()
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })
})
