import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { changelogEntry, changelogEntryFeedback } from '../server/database/schema/changelog'
import {
  gscConnection,
  gscDailyMetric,
  gscQueryStat,
  marketingAnnouncementDraft,
  marketingDataConsent,
  marketingEmailSuppression,
  reviewRequest,
  reviewRequestSettings,
} from '../server/database/schema/marketing'

type AnyTable = Parameters<typeof getTableConfig>[0]

function uniqueIndexColumns(table: AnyTable): string[][] {
  return getTableConfig(table)
    .indexes.filter((index) => index.config.unique)
    .map((index) => index.config.columns.map((column) => ('name' in column ? String(column.name) : String(column))))
}

function pkColumns(table: AnyTable): string[] {
  const config = getTableConfig(table)
  const compound = config.primaryKeys[0]
  if (compound) return compound.columns.map((column) => column.name)
  return config.columns.filter((column) => column.primary).map((column) => column.name)
}

describe('M5 schema', () => {
  it('keeps changelog slugs unique per product', () => {
    expect(uniqueIndexColumns(changelogEntry)).toContainEqual(['project_id', 'slug'])
  })

  it('identifies shipped feedback links by (entry, feedback)', () => {
    expect(pkColumns(changelogEntryFeedback)).toEqual(['entry_id', 'feedback_id'])
  })

  it('allows one announcement draft per entry and channel', () => {
    expect(uniqueIndexColumns(marketingAnnouncementDraft)).toContainEqual(['entry_id', 'channel'])
  })

  it('never queues the same review request event twice, and tokens are unique', () => {
    const unique = uniqueIndexColumns(reviewRequest)
    expect(unique).toContainEqual(['project_id', 'trigger', 'source_id', 'email'])
    expect(unique).toContainEqual(['token'])
  })

  it('keeps the dedupe slot of anonymised rows through the email hash, and one suppression per team and hash', () => {
    expect(uniqueIndexColumns(reviewRequest)).toContainEqual(['project_id', 'trigger', 'source_id', 'email_hash'])
    expect(uniqueIndexColumns(marketingEmailSuppression)).toContainEqual(['organization_id', 'email_hash'])
  })

  it('uses natural primary keys for settings, consent, suppression and GSC tables', () => {
    expect(pkColumns(reviewRequestSettings)).toEqual(['project_id'])
    expect(pkColumns(marketingDataConsent)).toEqual(['organization_id'])
    expect(pkColumns(marketingEmailSuppression)).toEqual(['organization_id', 'email'])
    expect(pkColumns(gscConnection)).toEqual(['site_id'])
    expect(pkColumns(gscDailyMetric)).toEqual(['site_id', 'date'])
    expect(pkColumns(gscQueryStat)).toEqual(['site_id', 'period_end', 'query'])
  })
})
