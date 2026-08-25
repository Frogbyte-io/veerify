import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { supportInbox, supportInboxMember } from '../../server/database/schema/support'

const orgId = `schema_contract_org_${randomUUID()}`
const teamId = `schema_contract_team_${randomUUID()}`
const inboxId = `schema_contract_inbox_${randomUUID()}`
const userId = `schema_contract_user_${randomUUID()}`
const now = new Date()

beforeAll(async () => {
  await db.insert(organization).values({
    id: orgId,
    name: 'Schema Contract Org',
    slug: `schema-contract-org-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(team).values({
    id: teamId,
    name: 'Schema Contract Team',
    slug: `schema-contract-team-${randomUUID()}`,
    organizationId: orgId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(user).values({
    id: userId,
    name: 'Schema Contract User',
    email: `schema-contract-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportInbox).values({
    id: inboxId,
    teamId,
    name: 'Schema Contract Inbox',
    slug: `schema-contract-inbox-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(user).where(eq(user.id, userId))
  await db.delete(organization).where(eq(organization.id, orgId))
})

async function acceptsInboxRole(role: string) {
  class AcceptedProbe extends Error {}

  try {
    await db.transaction(async (tx) => {
      await tx.insert(supportInboxMember).values({
        id: `schema_contract_member_${randomUUID()}`,
        inboxId,
        userId,
        role,
        createdAt: now,
      })
      throw new AcceptedProbe()
    })
    return false
  } catch (error) {
    return error instanceof AcceptedProbe
  }
}

async function tableColumns(tableName: string) {
  const rows = await db.execute<{ column_name: string }>(
    sql`select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = ${tableName}
      order by ordinal_position`
  )
  return rows.rows.map((row) => row.column_name)
}

describe('support hardening schema contracts (real Postgres)', () => {
  it('owns upload, delivery, index, foreign-key, and role contracts', async () => {
    const uploadStatusConstraint = await db.execute<{ constraint_name: string }>(
      sql`select constraint_name
        from information_schema.table_constraints
        where table_schema = 'public' and table_name = 'support_attachment_upload'
        and constraint_type = 'CHECK'`
    )
    expect(uploadStatusConstraint.rows.map((row) => row.constraint_name)).toContain(
      'support_attachment_upload_status_check'
    )
    const uploadColumns = await tableColumns('support_attachment_upload')
    const uploadForeignKeys = await db.execute<{ column_name: string; referenced_table: string }>(
      sql`select source.attname as column_name, target.relname as referenced_table
        from pg_constraint constraint_row
        join pg_class source_table on source_table.oid = constraint_row.conrelid
        join pg_class target on target.oid = constraint_row.confrelid
        cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
        join pg_attribute source on source.attrelid = source_table.oid and source.attnum = source_key.attnum
        where source_table.relname = 'support_attachment_upload'
          and constraint_row.contype = 'f'
        order by source.attname`
    )
    const uploadIndexes = await db.execute<{ columns: string }>(
      sql`select string_agg(attribute.attname, ',' order by indexed_column.ordinality) as columns
        from pg_class table_row
        join pg_index index_row on index_row.indrelid = table_row.oid
        cross join lateral unnest(index_row.indkey) with ordinality indexed_column(attnum, ordinality)
        join pg_attribute attribute on attribute.attrelid = table_row.oid and attribute.attnum = indexed_column.attnum
        where table_row.relname = 'support_attachment_upload'
        group by index_row.indexrelid`
    )
    const channelMessageIndex = await db.execute<{ indexdef: string }>(
      sql`select indexdef
        from pg_indexes
        where schemaname = 'public' and indexname = 'conversation_message_channel_message_id_idx'`
    )
    const providerAccountColumn = await db.execute<{ is_nullable: string; column_default: string | null }>(
      sql`select is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public' and table_name = 'support_delivery_event'
          and column_name = 'provider_account_key'`
    )
    const outboundDeliveryColumns = await tableColumns('support_outbound_delivery')
    const deliveryEventColumns = await tableColumns('support_delivery_event')
    const deliveryEventUnique = await db.execute<{ columns: string }>(
      sql`select string_agg(attribute.attname, ',' order by indexed_column.ordinality) as columns
        from pg_class table_row
        join pg_index index_row on index_row.indrelid = table_row.oid and index_row.indisunique
        cross join lateral unnest(index_row.indkey) with ordinality indexed_column(attnum, ordinality)
        join pg_attribute attribute on attribute.attrelid = table_row.oid and attribute.attnum = indexed_column.attnum
        where table_row.relname = 'support_delivery_event'
          and index_row.indexrelid::regclass::text = 'support_delivery_event_provider_event_id_idx'
        group by index_row.indexrelid
        `
    )

    expect(uploadColumns).toEqual(
      expect.arrayContaining([
        'id',
        'conversation_id',
        'user_id',
        'temp_storage_key',
        'final_storage_key',
        'file_name',
        'requested_content_type',
        'requested_size_bytes',
        'stored_content_type',
        'actual_size_bytes',
        'object_version',
        'status',
        'expires_at',
        'uploaded_at',
        'consumed_at',
        'temp_deleted_at',
        'finalize_lease_expires_at',
        'cleanup_attempt_count',
        'cleanup_last_error',
        'message_id',
        'created_at',
        'updated_at',
      ])
    )
    expect(channelMessageIndex.rows[0]?.indexdef).toContain('UNIQUE')
    expect(uploadForeignKeys.rows.map((row) => `${row.column_name} -> ${row.referenced_table}`)).toEqual(
      expect.arrayContaining([
        'conversation_id -> conversation',
        'user_id -> user',
        'message_id -> conversation_message',
      ])
    )
    expect(uploadIndexes.rows.map((row) => row.columns.split(','))).toEqual(
      expect.arrayContaining([
        ['conversation_id', 'status'],
        ['user_id', 'status'],
        ['status', 'expires_at'],
      ])
    )
    expect(await acceptsInboxRole('agent')).toBe(true)
    expect(await acceptsInboxRole('supervisor')).toBe(true)
    expect(await acceptsInboxRole('admin')).toBe(true)
    expect(await acceptsInboxRole('member')).toBe(false)
    expect(providerAccountColumn.rows[0]).toMatchObject({ is_nullable: 'NO', column_default: "'legacy'::text" })
    expect(outboundDeliveryColumns).toEqual(
      expect.arrayContaining(['provider', 'provider_account_key', 'provider_message_id', 'next_attempt_at'])
    )
    expect(deliveryEventColumns).toEqual(
      expect.arrayContaining(['provider_account_key', 'correlation_key', 'occurred_at'])
    )
    expect(deliveryEventUnique.rows[0]?.columns.split(',')).toEqual(['provider', 'provider_event_id'])
  })
})
