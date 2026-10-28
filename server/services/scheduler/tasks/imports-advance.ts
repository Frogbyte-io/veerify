import { advanceImportRuns } from '~/server/services/imports/committer'
import { defineScheduledTask } from '../registry'

/** Applies committing import runs (those too large to commit inline) within a time budget. */
export const IMPORTS_ADVANCE_TASK_NAME = 'imports:advance'

export const importsAdvanceTask = defineScheduledTask(IMPORTS_ADVANCE_TASK_NAME, '* * * * *', () => advanceImportRuns())
