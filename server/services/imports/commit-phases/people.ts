import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { importedPerson } from '~/server/database/schema/feedback'
import type { ImportPerson } from '../format'
import { PERSON_SYNC_FIELDS, personIncoming, planFieldSync } from '../planner'
import { isEmailSuppressed, organizationOfProject } from '../suppression'
import type { CommitPhase } from './context'

/**
 * Imported people, upserted on (projectId, source, externalId). People have no snapshot: the stored row is its own
 * snapshot, so source changes always apply (same as the preview). Never linked to a user here (claimedByUserId stays
 * null; claiming is Task 7). A new person whose email is suppressed in the organization (contact erasure) is
 * created already tombstoned: no name, email or avatar, `erasedAt` set (see ../suppression.ts; the preview agrees).
 */
export const peoplePhase: CommitPhase<{ organizationId: string | null }, ImportPerson> = {
  name: 'people',
  items: (ctx) => ctx.batch.people,
  load: async (ctx) => ({ organizationId: await organizationOfProject(ctx.run.projectId) }),
  async apply(ctx, state, rec) {
    const { projectId, source } = ctx.run
    const now = ctx.now()
    const outcome = await db.transaction(async (tx) => {
      const erased = await isEmailSuppressed(state.organizationId, rec.email, tx)
      const [inserted] = await tx
        .insert(importedPerson)
        .values({
          id: randomUUID(),
          projectId,
          source,
          externalId: rec.externalId,
          name: erased ? null : (rec.name ?? null),
          email: erased ? null : (rec.email ?? null),
          avatarUrl: erased ? null : (rec.avatarUrl ?? null),
          erasedAt: erased ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [importedPerson.projectId, importedPerson.source, importedPerson.externalId] })
        .returning({ id: importedPerson.id })
      if (inserted) return 'create'
      // A suppressed address never comes back onto an existing person either.
      if (!ctx.sync || erased) return 'unchanged'

      const [row] = await tx
        .select()
        .from(importedPerson)
        .where(
          and(
            eq(importedPerson.projectId, projectId),
            eq(importedPerson.source, source),
            eq(importedPerson.externalId, rec.externalId)
          )
        )
        .for('update')
        .limit(1)
      if (!row || row.erasedAt) return 'unchanged'
      const plan = planFieldSync(row, row, personIncoming(rec), PERSON_SYNC_FIELDS)
      if (!Object.keys(plan.apply).length) return 'unchanged'
      await tx
        .update(importedPerson)
        .set({ ...plan.apply, updatedAt: now })
        .where(and(eq(importedPerson.id, row.id), isNull(importedPerson.erasedAt)))
      return 'update'
    })
    ctx.counts.people[outcome]++
  },
}
