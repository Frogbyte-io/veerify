/**
 * Turns language suggestions into real terms and prompts, using the same
 * validation and caps as the terms and prompts endpoints. Duplicates and items
 * over a cap are skipped and reported, never an error for the whole batch.
 */

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt, marketingTerm } from '~/server/database/schema/marketing'
import { MAX_ACTIVE_PROMPTS, MAX_TOTAL_PROMPTS, promptTextSchema } from '~/server/services/marketing/visibility/prompts'
import { createTermSchema, MAX_TERMS_PER_SITE } from '~/server/utils/marketing-terms'

export type SkipReason = 'duplicate' | 'invalid' | 'cap'

export interface ApplyInput {
  terms?: { kind: 'keyword' | 'competitor'; label: string }[]
  prompts?: string[]
}

export interface ApplyExisting {
  termLabels: string[]
  promptTexts: string[]
  activePromptCount: number
}

export interface ApplyPlan {
  termsToAdd: { kind: 'keyword' | 'competitor'; label: string }[]
  promptsToAdd: string[]
  skippedTerms: { value: string; reason: SkipReason }[]
  skippedPrompts: { value: string; reason: SkipReason }[]
}

export function planLanguageApply(input: ApplyInput, existing: ApplyExisting): ApplyPlan {
  const plan: ApplyPlan = { termsToAdd: [], promptsToAdd: [], skippedTerms: [], skippedPrompts: [] }

  const termSeen = new Set(existing.termLabels.map((l) => l.trim().toLowerCase()))
  let termCount = existing.termLabels.length
  for (const raw of input.terms ?? []) {
    const parsed = createTermSchema.safeParse({ kind: raw.kind, label: raw.label })
    if (!parsed.success) {
      plan.skippedTerms.push({ value: raw.label, reason: 'invalid' })
      continue
    }
    const key = parsed.data.label.toLowerCase()
    if (termSeen.has(key)) {
      plan.skippedTerms.push({ value: parsed.data.label, reason: 'duplicate' })
      continue
    }
    if (termCount >= MAX_TERMS_PER_SITE) {
      plan.skippedTerms.push({ value: parsed.data.label, reason: 'cap' })
      continue
    }
    termSeen.add(key)
    termCount++
    plan.termsToAdd.push({ kind: parsed.data.kind as 'keyword' | 'competitor', label: parsed.data.label })
  }

  const promptSeen = new Set(existing.promptTexts.map((t) => t.trim().toLowerCase()))
  let total = existing.promptTexts.length
  let active = existing.activePromptCount
  for (const raw of input.prompts ?? []) {
    const parsed = promptTextSchema.safeParse(raw)
    if (!parsed.success) {
      plan.skippedPrompts.push({ value: raw, reason: 'invalid' })
      continue
    }
    const key = parsed.data.toLowerCase()
    if (promptSeen.has(key)) {
      plan.skippedPrompts.push({ value: parsed.data, reason: 'duplicate' })
      continue
    }
    if (total >= MAX_TOTAL_PROMPTS || active >= MAX_ACTIVE_PROMPTS) {
      plan.skippedPrompts.push({ value: parsed.data, reason: 'cap' })
      continue
    }
    promptSeen.add(key)
    total++
    active++
    plan.promptsToAdd.push(parsed.data)
  }

  return plan
}

export async function applyLanguageSuggestions(siteId: string, input: ApplyInput) {
  const [terms, prompts] = await Promise.all([
    db.select({ label: marketingTerm.label }).from(marketingTerm).where(eq(marketingTerm.siteId, siteId)),
    db
      .select({ text: aiVisibilityPrompt.text, active: aiVisibilityPrompt.active })
      .from(aiVisibilityPrompt)
      .where(eq(aiVisibilityPrompt.siteId, siteId)),
  ])

  const plan = planLanguageApply(input, {
    termLabels: terms.map((t) => t.label),
    promptTexts: prompts.map((p) => p.text),
    activePromptCount: prompts.filter((p) => p.active).length,
  })

  const now = new Date()
  if (plan.termsToAdd.length > 0) {
    await db.insert(marketingTerm).values(
      plan.termsToAdd.map((t) => ({
        id: randomUUID(),
        siteId,
        kind: t.kind,
        label: t.label,
        aliases: [],
        competitorDomain: null,
        createdAt: now,
      }))
    )
  }
  if (plan.promptsToAdd.length > 0) {
    await db
      .insert(aiVisibilityPrompt)
      .values(
        plan.promptsToAdd.map((text) => ({
          id: randomUUID(),
          siteId,
          text,
          active: true,
          source: 'suggested' as const,
        }))
      )
  }

  return {
    terms: { added: plan.termsToAdd.map((t) => t.label), skipped: plan.skippedTerms },
    prompts: { added: plan.promptsToAdd, skipped: plan.skippedPrompts },
  }
}
