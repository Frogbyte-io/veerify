import { runTrashPurge } from '~/server/utils/support-trash'
import { defineScheduledTask } from '../registry'

export const TRASH_PURGE_TASK_NAME = 'support:trash-purge'

/** Hourly: conversations in Trash for 30 days are deleted permanently, one bounded batch per pass. */
export const trashPurgeTask = defineScheduledTask(TRASH_PURGE_TASK_NAME, '45 * * * *', () => runTrashPurge())
