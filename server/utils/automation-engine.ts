import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import {
  automationRule,
  automationRuleRun,
  cannedResponse,
  contact,
  conversation,
  conversationMessage,
  conversationTag,
  supportTag,
  type AutomationRuleAction,
  type AutomationRuleTrigger,
  type AutomationConditionGroup,
} from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'
import { db } from '~/server/database/drizzle'
import { executeAutomationActions, type AutomationActionRegistry } from '~/server/utils/automation-actions'
import { evaluateAutomationConditions, type AutomationConversationContext } from '~/server/utils/automation-conditions'
import { applyConversationStatusTransition } from '~/server/utils/conversation-activity'
import { postWebhookJson } from '~/server/utils/webhook-url'

export const DEFAULT_AUTOMATION_CASCADE_DEPTH = 3

export type AutomationRunInput = {
  conversationId: string
  trigger: AutomationRuleTrigger
  depth?: number
  maxDepth?: number
  dryRun?: boolean
  actorUserId?: string | null
}

export type AutomationRuleEvaluation = {
  ruleId: string
  ruleName: string
  status: 'applied' | 'skipped' | 'failed'
  matched: boolean
  actions: AutomationRuleAction[]
  errors: string[]
  cascadeTruncated: boolean
}

export type AutomationRunResult = {
  conversationId: string
  trigger: AutomationRuleTrigger
  depth: number
  dryRun: boolean
  evaluations: AutomationRuleEvaluation[]
}

type ConversationAutomationState = {
  id: string
  teamId: string
  inboxId: string
  contactId: string
  subject: string | null
  status: string
  priority: string | null
  assigneeUserId: string | null
  companyId: string | null
  lastActivityAt: Date | null
  tagIds: string[]
  latestBody: string | null
}

function actionValue(action: AutomationRuleAction, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in action) return action[key]
  }
  return undefined
}

function stringActionValue(action: AutomationRuleAction, ...keys: string[]): string | null {
  const value = actionValue(action, ...keys)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function actionFailure(message: string) {
  return { success: false, error: message }
}

async function loadConversationState(conversationId: string): Promise<ConversationAutomationState | null> {
  const [row] = await db
    .select({
      id: conversation.id,
      teamId: conversation.teamId,
      inboxId: conversation.inboxId,
      contactId: conversation.contactId,
      subject: conversation.subject,
      status: conversation.status,
      priority: conversation.priority,
      assigneeUserId: conversation.assigneeUserId,
      companyId: contact.companyId,
      lastActivityAt: conversation.lastActivityAt,
    })
    .from(conversation)
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(eq(conversation.id, conversationId))
    .limit(1)

  if (!row) return null

  const [latestMessage] = await db
    .select({ body: conversationMessage.body })
    .from(conversationMessage)
    .where(eq(conversationMessage.conversationId, conversationId))
    .orderBy(desc(conversationMessage.createdAt), desc(conversationMessage.id))
    .limit(1)
  const tags = await db
    .select({ tagId: conversationTag.tagId })
    .from(conversationTag)
    .where(eq(conversationTag.conversationId, conversationId))

  return {
    ...row,
    tagIds: tags.map((tag) => tag.tagId),
    latestBody: latestMessage?.body ?? null,
  }
}

function buildConditionContext(state: ConversationAutomationState): AutomationConversationContext {
  return {
    inboxId: state.inboxId,
    status: state.status,
    priority: state.priority,
    tagIds: state.tagIds,
    assigneeUserId: state.assigneeUserId,
    contactId: state.contactId,
    companyId: state.companyId,
    subject: state.subject,
    body: state.latestBody,
    channel: 'email',
    hoursSinceLastActivity: state.lastActivityAt
      ? Math.max(0, (Date.now() - state.lastActivityAt.getTime()) / 3_600_000)
      : null,
  }
}

function buildActionRegistry(state: ConversationAutomationState, actorUserId: string | null): AutomationActionRegistry {
  const registry: Record<string, AutomationActionRegistry[string]> = {
    set_status: async (action) => {
      const status = stringActionValue(action, 'status', 'value')
      if (!status || !['open', 'pending', 'resolved', 'snoozed', 'closed'].includes(status)) {
        return actionFailure('A valid status is required')
      }
      await db.transaction(async (tx) => {
        await applyConversationStatusTransition(tx, {
          conversationId: state.id,
          teamId: state.teamId,
          inboxId: state.inboxId,
          toStatus: status,
          actorUserId,
          occurredAt: new Date(),
        })
      })
    },
    set_priority: async (action) => {
      const priority = stringActionValue(action, 'priority', 'value')
      if (!priority || !['low', 'normal', 'high', 'urgent'].includes(priority)) {
        return actionFailure('A valid priority is required')
      }
      await db
        .update(conversation)
        .set({ priority, updatedAt: new Date(), lastActivityAt: new Date() })
        .where(eq(conversation.id, state.id))
    },
    assign_to_agent: async (action) => {
      const userId = stringActionValue(action, 'userId', 'assigneeUserId', 'value')
      if (!userId) return actionFailure('An assignee user id is required')
      const [member] = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(and(eq(teamMember.teamId, state.teamId), eq(teamMember.userId, userId)))
        .limit(1)
      if (!member) return actionFailure('Assignee is not a member of the conversation team')
      await db
        .update(conversation)
        .set({ assigneeUserId: userId, updatedAt: new Date(), lastActivityAt: new Date() })
        .where(eq(conversation.id, state.id))
    },
    assign_round_robin: async () => {
      const [member] = await db
        .select({ userId: teamMember.userId })
        .from(teamMember)
        .where(eq(teamMember.teamId, state.teamId))
        .orderBy(asc(teamMember.createdAt), asc(teamMember.userId))
        .limit(1)
      if (!member) return actionFailure('No team member is available for assignment')
      await db
        .update(conversation)
        .set({ assigneeUserId: member.userId, updatedAt: new Date(), lastActivityAt: new Date() })
        .where(eq(conversation.id, state.id))
    },
    add_tag: async (action) => {
      const tagId = stringActionValue(action, 'tagId', 'value')
      if (!tagId) return actionFailure('A tag id is required')
      const [tag] = await db
        .select({ id: supportTag.id })
        .from(supportTag)
        .where(and(eq(supportTag.id, tagId), eq(supportTag.teamId, state.teamId)))
        .limit(1)
      if (!tag) return actionFailure('Tag is not part of the conversation team')
      await db
        .insert(conversationTag)
        .values({ id: randomUUID(), conversationId: state.id, tagId, createdAt: new Date() })
        .onConflictDoNothing()
    },
    remove_tag: async (action) => {
      const tagId = stringActionValue(action, 'tagId', 'value')
      if (!tagId) return actionFailure('A tag id is required')
      await db
        .delete(conversationTag)
        .where(and(eq(conversationTag.conversationId, state.id), eq(conversationTag.tagId, tagId)))
    },
    add_private_note: async (action) => {
      const body = stringActionValue(action, 'body', 'value')
      if (!body) return actionFailure('A private note body is required')
      await db.insert(conversationMessage).values({
        id: randomUUID(),
        conversationId: state.id,
        kind: 'note',
        body,
        bodyHtml: null,
        senderKind: actorUserId ? 'agent' : 'system',
        senderContactId: null,
        senderUserId: actorUserId,
        isPrivate: true,
        deliveryStatus: 'delivered',
        createdAt: new Date(),
      })
    },
    call_webhook: async (action) => {
      const url = stringActionValue(action, 'url', 'value')
      if (!url) return actionFailure('A valid webhook URL is required')
      try {
        const status = await postWebhookJson(url, action.payload ?? { conversationId: state.id })
        if (status < 200 || status >= 300) return actionFailure(`Webhook returned HTTP ${status}`)
      } catch (error) {
        return actionFailure(error instanceof Error ? error.message : 'Webhook request failed')
      }
    },
    send_canned_reply: async (action) => {
      const cannedResponseId = stringActionValue(action, 'cannedResponseId', 'value')
      if (!cannedResponseId) return actionFailure('A canned response id is required')
      const [response] = await db
        .select({ id: cannedResponse.id })
        .from(cannedResponse)
        .where(and(eq(cannedResponse.id, cannedResponseId), eq(cannedResponse.teamId, state.teamId)))
        .limit(1)
      return response
        ? actionFailure('Canned reply delivery is not available to the automation worker yet')
        : actionFailure('Canned response not found')
    },
    run_macro: async () => actionFailure('Macro actions are not available to the automation worker yet'),
  }
  return registry
}

async function recordRuleRun(input: {
  ruleId: string
  conversationId: string
  status: 'applied' | 'skipped' | 'failed'
  matchedConditions: AutomationConditionGroup
  appliedActions: AutomationRuleAction[]
  error?: string
}): Promise<void> {
  await db.insert(automationRuleRun).values({
    id: randomUUID(),
    ruleId: input.ruleId,
    conversationId: input.conversationId,
    status: input.status,
    matchedConditions: input.matchedConditions,
    appliedActions: input.appliedActions,
    error: input.error ?? null,
    createdAt: new Date(),
  })
}

/**
 * Evaluate enabled rules for one committed event. The dry-run path only reads
 * state and returns the same action plan; it never inserts audit rows, updates
 * rules, or executes handlers.
 */
export async function runAutomationRules(input: AutomationRunInput): Promise<AutomationRunResult> {
  const depth = input.depth ?? 0
  const maxDepth = input.maxDepth ?? DEFAULT_AUTOMATION_CASCADE_DEPTH
  const dryRun = input.dryRun === true
  const state = await loadConversationState(input.conversationId)
  const result: AutomationRunResult = {
    conversationId: input.conversationId,
    trigger: input.trigger,
    depth,
    dryRun,
    evaluations: [],
  }
  if (!state) return result

  const rules = await db
    .select()
    .from(automationRule)
    .where(
      and(
        eq(automationRule.teamId, state.teamId),
        eq(automationRule.trigger, input.trigger),
        eq(automationRule.isEnabled, true),
        or(isNull(automationRule.inboxId), eq(automationRule.inboxId, state.inboxId))
      )
    )
    .orderBy(asc(automationRule.sortOrder), asc(automationRule.createdAt), asc(automationRule.id))

  const conditionContext = buildConditionContext(state)
  let followUpRequired = false

  for (const rule of rules) {
    const matched = evaluateAutomationConditions(rule.conditions, conditionContext)
    if (!matched) {
      result.evaluations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'skipped',
        matched: false,
        actions: [],
        errors: [],
        cascadeTruncated: false,
      })
      continue
    }

    if (depth >= maxDepth) {
      const truncation: AutomationRuleAction = { type: 'cascade_truncated', depth, maxDepth }
      const error = `Automation cascade depth limit (${maxDepth}) reached`
      if (!dryRun) {
        await recordRuleRun({
          ruleId: rule.id,
          conversationId: state.id,
          status: 'skipped',
          matchedConditions: rule.conditions,
          appliedActions: [truncation],
          error,
        })
      }
      result.evaluations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'skipped',
        matched: true,
        actions: [truncation],
        errors: [error],
        cascadeTruncated: true,
      })
      continue
    }

    if (dryRun) {
      result.evaluations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'applied',
        matched: true,
        actions: rule.actions,
        errors: [],
        cascadeTruncated: false,
      })
      continue
    }

    if (input.trigger === 'time_based') {
      // A threshold remains true on every scheduler tick. Execute it once per
      // conversation activity cycle so notes and webhooks do not repeat until
      // a later conversation activity gives the rule a new reason to run.
      const [previousAttempt] = await db
        .select({ id: automationRuleRun.id })
        .from(automationRuleRun)
        .where(
          and(
            eq(automationRuleRun.ruleId, rule.id),
            eq(automationRuleRun.conversationId, state.id),
            state.lastActivityAt ? gte(automationRuleRun.createdAt, state.lastActivityAt) : undefined
          )
        )
        .limit(1)
      if (previousAttempt) {
        result.evaluations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          status: 'skipped',
          matched: true,
          actions: [],
          errors: [],
          cascadeTruncated: false,
        })
        continue
      }
    }

    const executions = await executeAutomationActions(
      rule.actions,
      {
        conversationId: state.id,
        teamId: state.teamId,
        inboxId: state.inboxId,
        actorUserId: input.actorUserId ?? undefined,
        cascadeDepth: depth,
      },
      buildActionRegistry(state, input.actorUserId ?? null)
    )
    const appliedActions = executions
      .filter((execution) => execution.status === 'applied')
      .map((execution) => execution.action)
    const errors = executions
      .filter((execution) => execution.status === 'failed')
      .map((execution) => execution.error || 'Automation action failed')
    const stateChangingAction = rule.actions.some((action) =>
      ['set_status', 'set_priority', 'assign_to_agent', 'assign_round_robin', 'add_tag', 'remove_tag'].includes(
        action.type
      )
    )
    followUpRequired ||= stateChangingAction && appliedActions.length > 0
    const status = errors.length > 0 ? 'failed' : 'applied'
    await recordRuleRun({
      ruleId: rule.id,
      conversationId: state.id,
      status,
      matchedConditions: rule.conditions,
      appliedActions,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    })
    await db
      .update(automationRule)
      .set({ runCount: rule.runCount + 1, lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(automationRule.id, rule.id))
    result.evaluations.push({
      ruleId: rule.id,
      ruleName: rule.name,
      status,
      matched: true,
      actions: appliedActions,
      errors,
      cascadeTruncated: false,
    })
  }

  if (followUpRequired && !dryRun) {
    const nested = await runAutomationRules({
      conversationId: input.conversationId,
      trigger: 'conversation_updated',
      depth: depth + 1,
      maxDepth,
      actorUserId: input.actorUserId,
    })
    result.evaluations.push(...nested.evaluations)
  }

  return result
}

export async function triggerAutomationEvent(input: Omit<AutomationRunInput, 'dryRun'>): Promise<void> {
  try {
    await runAutomationRules(input)
  } catch {
    // Automation must never turn a committed support write into a 500. Every
    // action failure is audited by the engine; this guard covers unexpected
    // persistence/configuration failures around the audit itself.
  }
}

/** Run enabled time-based rules against active conversations once per sweep. */
export async function runTimeBasedAutomationSweep(): Promise<{
  scanned: number
  evaluations: number
  failures: number
}> {
  const rules = await db
    .select({ teamId: automationRule.teamId, inboxId: automationRule.inboxId })
    .from(automationRule)
    .where(and(eq(automationRule.trigger, 'time_based'), eq(automationRule.isEnabled, true)))

  const conversationIds = new Set<string>()
  for (const rule of rules) {
    const rows = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        and(
          eq(conversation.teamId, rule.teamId),
          rule.inboxId ? eq(conversation.inboxId, rule.inboxId) : undefined,
          inArray(conversation.status, ['open', 'pending', 'snoozed'])
        )
      )
    for (const row of rows) conversationIds.add(row.id)
  }

  let evaluations = 0
  let failures = 0
  for (const conversationId of conversationIds) {
    const result = await runAutomationRules({ conversationId, trigger: 'time_based' })
    evaluations += result.evaluations.length
    failures += result.evaluations.filter((evaluation) => evaluation.status === 'failed').length
  }

  return { scanned: conversationIds.size, evaluations, failures }
}
