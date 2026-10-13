<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Support settings</h1>
        <p class="text-muted-foreground mt-1">Configure your team's shared inbox</p>
      </div>

      <div
        v-if="inboxAccessError"
        data-testid="support-inbox-access-error"
        class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        role="alert"
      >
        {{ inboxAccessError }}
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="space-y-6">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <!-- Error -->
      <Card v-else-if="error">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">Failed to load support settings</p>
          <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
          <Button variant="outline" @click="initPage">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <!-- No inbox yet -->
      <Card v-else-if="!hasInboxes && canManageTeamSupport">
        <CardHeader>
          <CardTitle>Create your support inbox</CardTitle>
          <CardDescription>
            Your team doesn't have a support inbox yet. Create one to start receiving and managing customer
            conversations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <Label for="new-inbox-name">Name</Label>
              <Input
                id="new-inbox-name"
                v-model="newInboxName"
                placeholder="e.g. Customer Support"
                class="mt-2"
                :disabled="isCreatingInbox"
                @input="onNewInboxNameInput"
              />
            </div>
            <div>
              <Label for="new-inbox-slug">Slug</Label>
              <Input
                id="new-inbox-slug"
                v-model="newInboxSlug"
                placeholder="customer-support"
                class="mt-2"
                :disabled="isCreatingInbox"
                @input="onNewInboxSlugInput"
              />
            </div>
          </div>
          <div class="flex justify-end mt-4">
            <Button :disabled="isCreatingInbox || !newInboxName.trim() || !newInboxSlug.trim()" @click="createInbox">
              <Icon v-if="isCreatingInbox" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Create inbox
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-else-if="!hasInboxes" data-testid="support-no-assignment">
        <CardHeader>
          <CardTitle>No support inboxes are assigned to you.</CardTitle>
          <CardDescription>Ask a support administrator to add you to an inbox.</CardDescription>
        </CardHeader>
      </Card>

      <Card v-else-if="!selectedInboxId" data-testid="support-no-assignment">
        <CardHeader>
          <CardTitle>No support inboxes are assigned to you.</CardTitle>
          <CardDescription>Ask a support administrator to add you to an inbox.</CardDescription>
        </CardHeader>
      </Card>

      <template v-else>
        <Card v-if="canManageTeamSupport" data-testid="support-team-policy">
          <CardHeader>
            <CardTitle>Team support policy</CardTitle>
            <CardDescription>Controls how signed-in customer feedback is linked to support contacts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center justify-between gap-4 rounded-lg border p-4">
              <Label for="support-team-policy-toggle" class="text-sm font-medium">
                Automatically link signed-in customer feedback
              </Label>
              <Switch
                id="support-team-policy-toggle"
                v-model="autoLinkFeedback"
                data-testid="support-team-policy-toggle"
                :disabled="isSavingTeamPolicy"
                @update:model-value="saveTeamPolicy"
              />
            </div>
          </CardContent>
        </Card>

        <Card v-if="canManageTeamSupport" data-testid="support-sla-settings">
          <CardHeader>
            <CardTitle>SLA commitments</CardTitle>
            <CardDescription>Set the working week and the default response and resolution targets.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-5">
            <div v-if="isLoadingSla" class="space-y-2">
              <Skeleton class="h-10 w-full" />
              <Skeleton class="h-24 w-full" />
            </div>
            <div v-else-if="slaError" class="text-sm">
              <p class="text-destructive mb-2">{{ slaError }}</p>
              <Button variant="outline" size="sm" @click="loadSlaSettings">Retry</Button>
            </div>
            <template v-else>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label for="sla-hours-name">Schedule name</Label>
                  <Input id="sla-hours-name" v-model="slaDraft.name" class="mt-2" />
                </div>
                <div>
                  <Label for="sla-hours-timezone">Timezone</Label>
                  <Input id="sla-hours-timezone" v-model="slaDraft.timezone" class="mt-2" placeholder="UTC" />
                </div>
              </div>

              <div>
                <Label>Weekly hours</Label>
                <div class="mt-2 divide-y rounded-md border">
                  <div
                    v-for="day in slaWeekdays"
                    :key="day"
                    class="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2 px-3 py-2"
                  >
                    <span class="text-xs font-medium capitalize">{{ day }}</span>
                    <Input
                      v-model="slaDraft.weeklySchedule[day][0].open"
                      type="time"
                      class="h-8 text-xs"
                      :aria-label="`${day} opens`"
                    />
                    <Input
                      v-model="slaDraft.weeklySchedule[day][0].close"
                      type="time"
                      class="h-8 text-xs"
                      :aria-label="`${day} closes`"
                    />
                  </div>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">Use 00:00–00:00 for a closed day.</p>
              </div>

              <div>
                <Label for="sla-holidays">Holidays</Label>
                <Input id="sla-holidays" v-model="slaHolidayText" class="mt-2" placeholder="2026-12-25, 2027-01-01" />
                <p class="mt-1 text-xs text-muted-foreground">Comma-separated dates excluded from the schedule.</p>
              </div>

              <div class="grid gap-4 sm:grid-cols-3">
                <div v-for="target in slaPolicyDraft.targets" :key="target.metric">
                  <Label :for="`sla-target-${target.metric}`">{{ formatSlaMetric(target.metric) }} (minutes)</Label>
                  <Input
                    :id="`sla-target-${target.metric}`"
                    v-model.number="target.targetMinutes"
                    type="number"
                    min="1"
                    class="mt-2"
                  />
                </div>
              </div>

              <div class="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-3">
                <div class="flex items-center gap-2">
                  <Switch id="sla-notify-assignee" v-model="slaPolicyDraft.escalation.notifyAssignee" />
                  <Label for="sla-notify-assignee" class="text-xs">Notify assignee</Label>
                </div>
                <div class="flex items-center gap-2">
                  <Switch id="sla-notify-supervisor" v-model="slaPolicyDraft.escalation.notifySupervisor" />
                  <Label for="sla-notify-supervisor" class="text-xs">Notify supervisor</Label>
                </div>
                <div>
                  <Label for="sla-raise-priority" class="text-xs">Raise priority on breach</Label>
                  <select
                    id="sla-raise-priority"
                    v-model="slaPolicyDraft.escalation.raisePriority"
                    :class="selectClasses + ' mt-2 h-8 text-xs'"
                  >
                    <option :value="null">No change</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3">
                <p class="text-xs text-muted-foreground">Applies to conversations without a more specific policy.</p>
                <Button data-testid="support-sla-save" :disabled="isSavingSla" @click="saveSlaSettings">
                  <Icon v-if="isSavingSla" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                  Save SLA settings
                </Button>
              </div>
            </template>
          </CardContent>
        </Card>

        <Card v-if="canManageTeamSupport" data-testid="support-csat-settings">
          <CardHeader>
            <div class="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Customer pulse</CardTitle>
                <CardDescription
                  >Ask for one focused signal after a conversation is resolved or closed.</CardDescription
                >
              </div>
              <span class="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                {{ csatSurveys.filter((survey) => survey.isEnabled).length }} live
              </span>
            </div>
          </CardHeader>
          <CardContent class="space-y-5">
            <div v-if="isLoadingCsatSurveys" class="space-y-2">
              <Skeleton v-for="i in 2" :key="i" class="h-12 w-full" />
            </div>
            <div v-else-if="csatSurveysError" class="text-sm">
              <p class="mb-2 text-destructive">{{ csatSurveysError }}</p>
              <Button variant="outline" size="sm" @click="loadCsatSurveys">Retry</Button>
            </div>
            <template v-else>
              <div v-if="csatSurveys.length" class="divide-y rounded-lg border">
                <div
                  v-for="survey in csatSurveys"
                  :key="survey.id"
                  class="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                  data-testid="support-csat-survey-row"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate font-medium">{{ survey.name }}</span>
                      <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {{ survey.scale.replace('_', ' ') }}
                      </span>
                    </div>
                    <p class="mt-1 truncate text-xs text-muted-foreground">
                      {{ survey.sendTrigger === 'on_resolve' ? 'On resolve' : 'On close' }} ·
                      {{ survey.delayMinutes }} min delay · {{ survey.contactCooldownMinutes / 1440 }} day cooldown
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button variant="ghost" size="sm" @click="editCsatSurvey(survey)">Edit</Button>
                    <Button variant="ghost" size="sm" class="text-destructive" @click="deleteCsatSurvey(survey)">
                      <Icon name="lucide:trash-2" class="h-4 w-4" />
                    </Button>
                    <Switch
                      :model-value="survey.isEnabled"
                      :aria-label="`${survey.isEnabled ? 'Disable' : 'Enable'} ${survey.name}`"
                      @update:model-value="toggleCsatSurvey(survey, $event)"
                    />
                  </div>
                </div>
              </div>
              <p v-else class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No survey configured yet. Keep the first question short and specific.
              </p>

              <div class="grid gap-4 rounded-xl border bg-muted/10 p-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-medium">{{ csatDraft.id ? 'Edit survey' : 'New survey' }}</p>
                    <p class="text-xs text-muted-foreground">Ratings are collected without requiring sign-in.</p>
                  </div>
                  <Button v-if="csatDraft.id" variant="ghost" size="sm" @click="resetCsatDraft">New</Button>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label for="csat-survey-name">Name</Label>
                    <Input id="csat-survey-name" v-model="csatDraft.name" class="mt-2" placeholder="Default CSAT" />
                  </div>
                  <div>
                    <Label for="csat-survey-inbox">Inbox scope</Label>
                    <select id="csat-survey-inbox" v-model="csatDraft.inboxId" :class="selectClasses + ' mt-2'">
                      <option :value="null">All inboxes</option>
                      <option v-for="inbox in inboxes" :key="inbox.id" :value="inbox.id">{{ inbox.name }}</option>
                    </select>
                  </div>
                  <div>
                    <Label for="csat-survey-scale">Scale</Label>
                    <select id="csat-survey-scale" v-model="csatDraft.scale" :class="selectClasses + ' mt-2'">
                      <option value="csat_5">1–5 satisfaction</option>
                      <option value="thumbs">Thumbs up / down</option>
                      <option value="nps_10">0–10 likelihood</option>
                    </select>
                  </div>
                  <div>
                    <Label for="csat-survey-trigger">Send after</Label>
                    <select id="csat-survey-trigger" v-model="csatDraft.sendTrigger" :class="selectClasses + ' mt-2'">
                      <option value="on_resolve">Conversation resolves</option>
                      <option value="on_close">Conversation closes</option>
                    </select>
                  </div>
                </div>
                <div>
                  <Label for="csat-survey-question">Question</Label>
                  <Input
                    id="csat-survey-question"
                    v-model="csatDraft.question"
                    class="mt-2"
                    placeholder="How was your support experience?"
                  />
                </div>
                <div>
                  <Label for="csat-survey-follow-up">Follow-up prompt (optional)</Label>
                  <Input
                    id="csat-survey-follow-up"
                    v-model="csatDraft.followUpQuestion"
                    class="mt-2"
                    placeholder="What could we improve?"
                  />
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label for="csat-survey-delay">Delay (minutes)</Label>
                    <Input
                      id="csat-survey-delay"
                      v-model.number="csatDraft.delayMinutes"
                      type="number"
                      min="0"
                      class="mt-2"
                    />
                  </div>
                  <div>
                    <Label for="csat-survey-cooldown">Contact cooldown (days)</Label>
                    <Input
                      id="csat-survey-cooldown"
                      v-model.number="csatDraft.cooldownDays"
                      type="number"
                      min="0"
                      class="mt-2"
                    />
                  </div>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <Switch id="csat-survey-enabled" v-model="csatDraft.isEnabled" />
                    <Label for="csat-survey-enabled">Enable dispatch</Label>
                  </div>
                  <Button data-testid="support-csat-save" :disabled="isSavingCsatSurvey" @click="saveCsatSurvey">
                    <Icon v-if="isSavingCsatSurvey" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                    {{ csatDraft.id ? 'Update survey' : 'Save survey' }}
                  </Button>
                </div>
              </div>
            </template>
          </CardContent>
        </Card>

        <!-- Automation control room -->
        <Card v-if="canManageTeamSupport" data-testid="support-automation-settings" class="overflow-hidden">
          <CardHeader class="border-b bg-[#16211f] text-[#f5f1e8] dark:bg-[#111917]">
            <div class="flex items-start justify-between gap-4">
              <div>
                <CardTitle class="font-mono tracking-tight">Automation control room</CardTitle>
                <CardDescription class="mt-1 text-[#a9b9ae]">
                  Turn triage intent into ordered, auditable moves across every inbox.
                </CardDescription>
              </div>
              <div
                class="rounded-full border border-[#b8d96b]/40 bg-[#b8d96b]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#cfe995]"
              >
                {{ automationRules.filter((rule) => rule.isEnabled).length }} live
              </div>
            </div>
          </CardHeader>
          <CardContent class="space-y-5 bg-[#f8f7f2] p-0 dark:bg-[#18201e]">
            <div v-if="isLoadingAutomationRules" class="space-y-2 p-5">
              <Skeleton v-for="i in 2" :key="i" class="h-16 w-full" />
            </div>
            <div v-else-if="automationRulesError" class="p-5 text-sm">
              <p class="mb-2 text-destructive">{{ automationRulesError }}</p>
              <Button variant="outline" size="sm" @click="loadAutomationRules">Retry</Button>
            </div>
            <template v-else>
              <div v-if="automationRules.length === 0" class="border-b border-dashed p-5 text-sm text-muted-foreground">
                No rules yet. Start with a narrow condition and one reversible action.
              </div>
              <div v-else class="divide-y border-b">
                <div
                  v-for="rule in automationRules"
                  :key="rule.id"
                  class="grid gap-3 px-5 py-4 transition-colors hover:bg-[#ebece4] dark:hover:bg-[#202b28] sm:grid-cols-[1fr_auto_auto] sm:items-center"
                  data-testid="support-automation-rule-row"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="h-2 w-2 rounded-full" :class="rule.isEnabled ? 'bg-[#8aa84c]' : 'bg-slate-300'" />
                      <p class="truncate font-medium">{{ rule.name }}</p>
                      <span
                        class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        {{ rule.trigger.replaceAll('_', ' ') }}
                      </span>
                    </div>
                    <p class="mt-1 truncate pl-4 font-mono text-[11px] text-muted-foreground">
                      {{ (rule.conditions?.all || rule.conditions?.any || []).length }} conditions ·
                      {{ rule.actions?.length || 0 }} actions · {{ rule.runCount || 0 }} runs
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button variant="ghost" size="sm" class="font-mono text-xs" @click="editAutomationRule(rule)"
                      >Edit</Button
                    >
                    <Button variant="ghost" size="sm" class="font-mono text-xs" @click="loadAutomationRuns(rule)">
                      History
                    </Button>
                    <Button variant="ghost" size="sm" class="text-destructive" @click="deleteAutomationRule(rule)">
                      <Icon name="lucide:trash-2" class="h-4 w-4" />
                    </Button>
                  </div>
                  <Switch
                    :model-value="rule.isEnabled"
                    :aria-label="`${rule.isEnabled ? 'Disable' : 'Enable'} ${rule.name}`"
                    @update:model-value="toggleAutomationRule(rule, $event)"
                  />
                </div>
              </div>

              <div class="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr]">
                <div class="space-y-4 rounded-xl border bg-background p-4 shadow-sm">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {{ automationDraft.id ? 'Edit rule' : 'New rule' }}
                      </p>
                      <p class="mt-1 text-sm text-muted-foreground">Conditions are evaluated top to bottom.</p>
                    </div>
                    <Button v-if="automationDraft.id" variant="ghost" size="sm" @click="resetAutomationDraft"
                      >New</Button
                    >
                  </div>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label for="automation-rule-name">Rule name</Label>
                      <Input
                        id="automation-rule-name"
                        v-model="automationDraft.name"
                        class="mt-2"
                        placeholder="Enterprise escalation"
                      />
                    </div>
                    <div>
                      <Label for="automation-rule-trigger">Trigger</Label>
                      <select
                        id="automation-rule-trigger"
                        v-model="automationDraft.trigger"
                        :class="selectClasses + ' mt-2'"
                      >
                        <option value="conversation_created">Conversation created</option>
                        <option value="conversation_updated">Conversation updated</option>
                        <option value="message_created">Message created</option>
                        <option value="time_based">Time based</option>
                      </select>
                    </div>
                    <div>
                      <Label for="automation-rule-order">Order</Label>
                      <Input
                        id="automation-rule-order"
                        v-model.number="automationDraft.sortOrder"
                        type="number"
                        min="0"
                        class="mt-2"
                      />
                    </div>
                  </div>

                  <div class="rounded-lg border border-dashed p-3">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <Label>Match</Label>
                      <select v-model="automationDraft.group" :class="selectClasses + ' h-8 w-auto text-xs'">
                        <option value="all">All conditions</option>
                        <option value="any">Any condition</option>
                      </select>
                    </div>
                    <div
                      v-for="(condition, index) in automationDraft.conditions"
                      :key="condition.key"
                      class="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                    >
                      <select v-model="condition.field" :class="selectClasses + ' h-9 text-xs'">
                        <option value="company">Company</option>
                        <option value="priority">Priority</option>
                        <option value="status">Status</option>
                        <option value="tag">Tag</option>
                        <option value="assignee">Assignee</option>
                        <option value="subject">Subject</option>
                        <option value="body">Body</option>
                      </select>
                      <select v-model="condition.operator" :class="selectClasses + ' h-9 text-xs'">
                        <option value="equals">Equals</option>
                        <option value="contains">Contains</option>
                        <option value="matches">Matches</option>
                        <option value="not_equals">Does not equal</option>
                      </select>
                      <Input v-model="condition.value" class="h-9 text-xs" placeholder="Value" />
                      <Button
                        variant="ghost"
                        size="icon"
                        :disabled="automationDraft.conditions.length === 1"
                        @click="removeAutomationCondition(index)"
                      >
                        <Icon name="lucide:x" class="h-4 w-4" />
                      </Button>
                    </div>
                    <Button variant="outline" size="sm" class="font-mono text-xs" @click="addAutomationCondition">
                      <Icon name="lucide:plus" class="mr-1 h-3 w-3" /> Add condition
                    </Button>
                  </div>

                  <div class="rounded-lg border border-dashed p-3">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <Label>Then do</Label>
                      <span class="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                        >ordered actions</span
                      >
                    </div>
                    <div
                      v-for="(action, index) in automationDraft.actions"
                      :key="action.key"
                      class="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <select v-model="action.type" :class="selectClasses + ' h-9 text-xs'">
                        <option value="set_status">Set status</option>
                        <option value="set_priority">Set priority</option>
                        <option value="assign_to_agent">Assign to agent</option>
                        <option value="add_tag">Add tag</option>
                        <option value="remove_tag">Remove tag</option>
                        <option value="add_private_note">Add private note</option>
                        <option value="call_webhook">Call webhook</option>
                      </select>
                      <Input v-model="action.value" class="h-9 text-xs" placeholder="Value or id" />
                      <Button
                        variant="ghost"
                        size="icon"
                        :disabled="automationDraft.actions.length === 1"
                        @click="removeAutomationAction(index)"
                      >
                        <Icon name="lucide:x" class="h-4 w-4" />
                      </Button>
                    </div>
                    <Button variant="outline" size="sm" class="font-mono text-xs" @click="addAutomationAction">
                      <Icon name="lucide:plus" class="mr-1 h-3 w-3" /> Add action
                    </Button>
                  </div>

                  <div class="flex justify-end">
                    <Button
                      data-testid="support-automation-save"
                      :disabled="isSavingAutomationRule"
                      @click="saveAutomationRule"
                    >
                      <Icon v-if="isSavingAutomationRule" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
                      {{ automationDraft.id ? 'Update rule' : 'Save rule' }}
                    </Button>
                  </div>
                </div>

                <div class="space-y-4">
                  <div class="rounded-xl bg-[#16211f] p-4 text-[#f5f1e8] shadow-sm dark:bg-[#111917]">
                    <div class="flex items-center gap-2">
                      <Icon name="lucide:flask-conical" class="h-4 w-4 text-[#cfe995]" />
                      <p class="font-mono text-xs uppercase tracking-[0.16em]">Dry run</p>
                    </div>
                    <p class="mt-2 text-sm text-[#a9b9ae]">
                      Preview matching actions against a real conversation without writing state.
                    </p>
                    <div class="mt-4 flex gap-2">
                      <Input
                        v-model="automationDryRunConversationId"
                        class="border-[#61716a] bg-[#202d29] text-[#f5f1e8] placeholder:text-[#8fa097]"
                        placeholder="Conversation ID"
                      />
                      <Button
                        class="shrink-0 bg-[#cfe995] text-[#16211f] hover:bg-[#b8d96b]"
                        :disabled="isRunningAutomationDryRun"
                        @click="runAutomationDryRun"
                      >
                        Run
                      </Button>
                    </div>
                    <p v-if="automationDryRunError" class="mt-2 text-xs text-[#ffb4a9]">{{ automationDryRunError }}</p>
                    <div v-if="automationDryRunResult" class="mt-4 space-y-2 border-t border-[#3d5148] pt-3">
                      <div
                        v-for="evaluation in automationDryRunResult.evaluations"
                        :key="evaluation.ruleId"
                        class="rounded border border-[#3d5148] p-2"
                      >
                        <div class="flex items-center justify-between gap-2 text-xs">
                          <span class="truncate font-medium">{{ evaluation.ruleName }}</span>
                          <span class="font-mono text-[#cfe995]">{{ evaluation.actions.length }} actions</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="automationRuns.length" class="rounded-xl border bg-background p-4 shadow-sm">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <p class="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Run history</p>
                      <span class="text-xs text-muted-foreground">{{ automationRuns.length }} latest</span>
                    </div>
                    <div class="space-y-2">
                      <div
                        v-for="run in automationRuns.slice(0, 6)"
                        :key="run.id"
                        class="flex items-center justify-between gap-3 rounded-md border p-2 text-xs"
                      >
                        <span class="font-mono text-muted-foreground">{{ run.status }}</span>
                        <span class="truncate">{{ run.error || `${(run.appliedActions || []).length} actions` }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </CardContent>
        </Card>

        <!-- Inbox settings -->
        <template v-if="hasInboxes">
          <div v-if="inboxes.length > 1" class="flex items-center gap-3">
            <Label for="inbox-switcher" class="shrink-0">Inbox</Label>
            <select
              id="inbox-switcher"
              v-model="selectedInboxId"
              :class="selectClasses + ' max-w-xs'"
              @change="handleInboxSwitch"
            >
              <option v-for="inbox in inboxes" :key="inbox.id" :value="inbox.id">{{ inbox.name }}</option>
            </select>
          </div>

          <!-- General -->
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Basic identity for this inbox.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div>
                <Label for="general-name">Name</Label>
                <Input
                  id="general-name"
                  v-model="generalName"
                  class="mt-2"
                  :disabled="isSavingGeneral || !canManageInbox"
                  :readonly="!canManageInbox"
                />
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label for="general-from-address">From address</Label>
                  <Input
                    id="general-from-address"
                    v-model="generalEmailAddress"
                    type="email"
                    placeholder="support@yourdomain.com"
                    class="mt-2"
                    :disabled="isSavingGeneral || !canManageInbox"
                    :readonly="!canManageInbox"
                  />
                  <p class="text-sm text-muted-foreground mt-1">Used as the From on outgoing replies.</p>
                </div>
                <div>
                  <Label for="general-from-name">From name</Label>
                  <Input
                    id="general-from-name"
                    v-model="generalFromName"
                    placeholder="Acme Support"
                    class="mt-2"
                    :disabled="isSavingGeneral || !canManageInbox"
                    :readonly="!canManageInbox"
                  />
                </div>
              </div>

              <div v-if="isLoadingSendingStatus" class="space-y-2">
                <Skeleton class="h-10 w-full" />
              </div>
              <div v-else-if="sendingStatusError" class="text-sm">
                <p class="text-destructive mb-2">{{ sendingStatusError }}</p>
                <Button variant="outline" size="sm" @click="loadSendingStatus">Retry</Button>
              </div>
              <template v-else-if="sendingStatus">
                <p v-if="!sendingStatus.address" class="text-sm text-muted-foreground">
                  Set a From address above to have it checked against your provider.
                </p>
                <div
                  v-else-if="sendingStatus.authorization.status === 'unauthorized'"
                  class="flex items-start gap-2 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 text-sm"
                  data-testid="support-settings-sending-unauthorized"
                >
                  <Icon name="lucide:alert-triangle" class="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    "{{ sendingStatus.address }}" is not on a domain your provider is verified to send from. Replies
                    sent as this address may be rejected. Verify the domain with your provider, or use an address on a
                    verified domain.
                  </span>
                </div>
                <div
                  v-else-if="sendingStatus.authorization.status === 'authorized'"
                  class="flex items-center gap-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3 text-sm"
                  data-testid="support-settings-sending-authorized"
                >
                  <Icon name="lucide:check-circle-2" class="w-4 h-4 shrink-0" />
                  <span>Your provider is verified to send as "{{ sendingStatus.address }}".</span>
                </div>
                <div
                  v-else
                  class="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"
                  data-testid="support-settings-sending-unknown"
                >
                  <Icon name="lucide:help-circle" class="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Cannot verify whether "{{ sendingStatus.address }}" is authorized to send ({{
                      sendingStatus.authorization.reason
                    }}). This is not a failure — most deployments have not set a provider account credential yet.
                  </span>
                </div>
              </template>

              <div>
                <Label for="general-signature">Signature</Label>
                <Textarea
                  id="general-signature"
                  v-model="generalSignature"
                  rows="5"
                  class="mt-2"
                  :disabled="isSavingGeneral || !canManageInbox"
                  :readonly="!canManageInbox"
                />
                <p class="text-sm text-muted-foreground mt-1">Appended to outgoing replies.</p>
              </div>
              <div v-if="canManageInbox" class="flex justify-end">
                <Button
                  data-testid="support-inbox-settings-save"
                  :disabled="isSavingGeneral || !generalHasChanges"
                  @click="saveGeneral"
                >
                  <Icon v-if="isSavingGeneral" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Canned responses -->
          <Card data-testid="support-canned-responses">
            <CardHeader>
              <CardTitle>Canned responses</CardTitle>
              <CardDescription>Team shortcuts agents can insert from the support composer.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isLoadingCannedResponses" class="space-y-2">
                <Skeleton v-for="i in 2" :key="i" class="h-14 w-full" />
              </div>
              <div v-else-if="cannedResponsesError" class="text-sm">
                <p class="text-destructive mb-2">{{ cannedResponsesError }}</p>
                <Button variant="outline" size="sm" @click="loadCannedResponses()">Retry</Button>
              </div>
              <div v-else>
                <p v-if="cannedResponses.length === 0" class="text-sm text-muted-foreground">
                  No canned responses saved yet.
                </p>
                <div v-else class="space-y-2">
                  <div
                    v-for="response in cannedResponses"
                    :key="response.id"
                    data-testid="support-canned-response-row"
                    class="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div class="min-w-0 space-y-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-mono text-sm">/{{ response.shortcode }}</span>
                        <span class="font-medium">{{ response.title }}</span>
                      </div>
                      <p class="whitespace-pre-wrap text-sm text-muted-foreground">{{ response.body }}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid="support-canned-response-edit"
                        :aria-label="`Edit canned response ${response.shortcode}`"
                        :disabled="isSavingCannedResponse || deletingCannedResponseId === response.id"
                        @click="editCannedResponse(response)"
                      >
                        <Icon name="lucide:pencil" class="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid="support-canned-response-delete"
                        :aria-label="`Delete canned response ${response.shortcode}`"
                        :disabled="isSavingCannedResponse || deletingCannedResponseId === response.id"
                        @click="deleteCannedResponse(response)"
                      >
                        <Icon name="lucide:trash-2" class="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label for="canned-response-shortcode">Shortcode</Label>
                  <Input
                    id="canned-response-shortcode"
                    v-model="cannedResponseShortcode"
                    class="mt-2 font-mono"
                    placeholder="greeting"
                    :disabled="isSavingCannedResponse"
                  />
                </div>
                <div>
                  <Label for="canned-response-title">Title</Label>
                  <Input
                    id="canned-response-title"
                    v-model="cannedResponseTitle"
                    class="mt-2"
                    placeholder="Friendly greeting"
                    :disabled="isSavingCannedResponse"
                  />
                </div>
              </div>
              <div>
                <Label for="canned-response-body">Body</Label>
                <Textarea
                  id="canned-response-body"
                  v-model="cannedResponseBody"
                  rows="5"
                  class="mt-2"
                  placeholder="Hi {{contact.name}}, {{agent.name}} here."
                  :disabled="isSavingCannedResponse"
                />
              </div>
              <div class="flex justify-end gap-2">
                <Button
                  v-if="editingCannedResponseId"
                  variant="outline"
                  :disabled="isSavingCannedResponse"
                  @click="resetCannedResponseForm"
                >
                  Cancel
                </Button>
                <Button
                  data-testid="support-canned-response-submit"
                  :disabled="
                    isSavingCannedResponse ||
                    !cannedResponseShortcode.trim() ||
                    !cannedResponseTitle.trim() ||
                    !cannedResponseBody.trim()
                  "
                  @click="saveCannedResponse"
                >
                  <Icon v-if="isSavingCannedResponse" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  {{ editingCannedResponseId ? 'Save response' : 'Add response' }}
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Channel (SUP-03-13) -->
          <Card data-testid="support-settings-channel">
            <CardHeader>
              <CardTitle>Channel</CardTitle>
              <CardDescription>
                How inbound mail reaches this inbox. The provider and its webhook credentials are set once per
                deployment as environment variables, not here — so this shows what is configured rather than editing it.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isLoadingChannel" class="space-y-2">
                <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
              </div>

              <div v-else-if="channelError" class="text-sm">
                <p class="text-destructive mb-2">Could not load channel status</p>
                <Button variant="outline" size="sm" @click="loadChannelStatus">Retry</Button>
              </div>

              <template v-else-if="channel">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                    :class="
                      channelReady
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    "
                    data-testid="support-settings-channel-state"
                  >
                    <Icon
                      :name="channelReady ? 'lucide:check-circle-2' : 'lucide:alert-triangle'"
                      class="w-3.5 h-3.5"
                    />
                    {{ channelReady ? 'Ready to receive' : 'Not receiving mail' }}
                  </span>
                  <span class="text-sm text-muted-foreground"
                    >Provider: <strong>{{ channel.provider }}</strong></span
                  >
                </div>

                <p v-if="!channel.driverAvailable" class="text-sm text-muted-foreground">
                  <code>SUPPORT_CHANNEL_PROVIDER</code> is set to <code>{{ channel.provider }}</code
                  >, which is not one of {{ channel.supportedProviders.join(', ') }}. Inbound mail is rejected until it
                  names a supported provider.
                </p>

                <div v-else-if="channel.missingEnvVars.length > 0" class="text-sm text-muted-foreground">
                  <p class="mb-1">
                    Credentials are missing, so inbound mail is rejected. An unset credential never means “accept
                    anything”. Set these and restart:
                  </p>
                  <ul class="list-disc pl-5 space-y-0.5">
                    <li v-for="name in channel.missingEnvVars" :key="name">
                      <code>{{ name }}</code>
                    </li>
                  </ul>
                </div>

                <div class="space-y-1">
                  <Label>Webhook URL to register with {{ channel.provider }}</Label>
                  <div class="flex items-center gap-2">
                    <Input :model-value="webhookUrl" readonly data-testid="support-settings-channel-webhook" />
                    <Button variant="outline" size="sm" @click="copy(webhookUrl)">Copy</Button>
                  </div>
                </div>

                <div v-if="primaryAddress" class="space-y-1">
                  <Label>Forward mail to</Label>
                  <div class="flex items-center gap-2">
                    <Input :model-value="primaryAddress" readonly data-testid="support-settings-channel-forward" />
                    <Button variant="outline" size="sm" @click="copy(primaryAddress)">Copy</Button>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Point an MX record or a forwarding rule at this address. Add more addresses below to route different
                    products into this inbox.
                  </p>
                </div>
                <p v-else class="text-sm text-muted-foreground">
                  Add a receiving address below before pointing mail at this inbox.
                </p>
              </template>
            </CardContent>
          </Card>

          <!-- Agents -->
          <Card>
            <CardHeader>
              <CardTitle>Agents</CardTitle>
              <CardDescription>
                People who can work this inbox. Inbox access is separate from team membership — a team member does not
                automatically get access to this inbox.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isSwitchingInbox" class="space-y-2">
                <Skeleton v-for="i in 2" :key="i" class="h-14 w-full" />
              </div>
              <div v-else>
                <p v-if="members.length === 0" class="text-sm text-muted-foreground">
                  No agents have access to this inbox yet.
                </p>
                <div v-else class="space-y-2">
                  <div
                    v-for="member in members"
                    :key="member.id"
                    data-testid="support-inbox-member-row"
                    class="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <Avatar class="h-9 w-9 shrink-0">
                        <AvatarFallback>{{ initials(member.userName || member.userEmail) }}</AvatarFallback>
                      </Avatar>
                      <div class="min-w-0">
                        <p class="font-medium truncate">{{ member.userName || member.userEmail }}</p>
                        <p class="text-sm text-muted-foreground truncate">{{ member.userEmail }}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 ml-4">
                      <Badge variant="outline">{{ member.role }}</Badge>
                      <Button
                        v-if="canManageMembers"
                        data-testid="support-remove-inbox-member"
                        :aria-label="
                          'Remove inbox member ' +
                          (member.userName || member.userEmail) +
                          (member.userName && member.userEmail ? ' (' + member.userEmail + ')' : '')
                        "
                        variant="ghost"
                        size="icon"
                        :disabled="removingMemberId === member.id"
                        @click="openRemoveMemberDialog(member)"
                      >
                        <Icon name="lucide:x" class="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <p v-if="!isSwitchingInbox && availableTeamMembers.length === 0" class="text-sm text-muted-foreground">
                Every team member already has access to this inbox.
              </p>
              <div
                v-else-if="!isSwitchingInbox && canManageMembers"
                class="flex flex-col sm:flex-row gap-2 sm:items-end"
              >
                <div class="flex-1">
                  <Label for="new-member-select">Team member</Label>
                  <select id="new-member-select" v-model="newMemberUserId" :class="selectClasses + ' mt-2'">
                    <option value="" disabled>Select a team member</option>
                    <option v-for="tm in availableTeamMembers" :key="tm.id" :value="tm.userId">
                      {{ tm.userName || tm.userEmail }}
                    </option>
                  </select>
                </div>
                <div>
                  <Label for="new-member-role">Role</Label>
                  <select id="new-member-role" v-model="newMemberRole" :class="selectClasses + ' mt-2'">
                    <option value="agent">Agent</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <p class="mt-1 text-xs text-muted-foreground">{{ roleDescriptions[newMemberRole] }}</p>
                </div>
                <Button
                  data-testid="support-add-inbox-member"
                  :disabled="isAddingMember || !newMemberUserId"
                  @click="addMember"
                >
                  <Icon v-if="isAddingMember" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  Add inbox member
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Receiving addresses -->
          <Card>
            <CardHeader>
              <CardTitle>Receiving addresses</CardTitle>
              <CardDescription>
                An inbound email carries no product signal of its own — the address it arrived at is what attributes it
                to a product. Setting a new primary address clears the previous one.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isSwitchingInbox" class="space-y-2">
                <Skeleton v-for="i in 2" :key="i" class="h-14 w-full" />
              </div>
              <div v-else>
                <p v-if="addresses.length === 0" class="text-sm text-muted-foreground">
                  No receiving addresses configured yet.
                </p>
                <div v-else class="space-y-2">
                  <div
                    v-for="address in addresses"
                    :key="address.id"
                    class="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-sm truncate">{{ address.address }}</span>
                        <Badge v-if="address.isPrimary" variant="outline" class="text-xs">Primary</Badge>
                      </div>
                      <p class="text-sm mt-0.5">
                        <span v-if="productName(address.projectId)">{{ productName(address.projectId) }}</span>
                        <span v-else class="text-muted-foreground">Unattributed</span>
                      </p>
                    </div>
                    <Button
                      v-if="canManageInbox"
                      variant="ghost"
                      size="icon"
                      class="shrink-0 ml-4"
                      :aria-label="`Remove receiving address ${address.address}`"
                      :disabled="removingAddressId === address.id"
                      @click="openRemoveAddressDialog(address)"
                    >
                      <Icon name="lucide:x" class="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              <div v-if="!isSwitchingInbox && canManageInbox" class="space-y-3">
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label for="new-address">Email address</Label>
                    <Input
                      id="new-address"
                      v-model="newAddress"
                      type="email"
                      placeholder="support@yourdomain.com"
                      class="mt-2"
                      :disabled="isAddingAddress"
                    />
                  </div>
                  <div>
                    <Label for="new-address-project">Product</Label>
                    <select id="new-address-project" v-model="newAddressProjectId" :class="selectClasses + ' mt-2'">
                      <option value="">Unattributed</option>
                      <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
                    </select>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Switch id="new-address-primary" v-model="newAddressIsPrimary" :disabled="isAddingAddress" />
                    <Label for="new-address-primary">Primary sending address</Label>
                  </div>
                  <Button
                    data-testid="support-address-add"
                    :disabled="isAddingAddress || !newAddress.trim()"
                    @click="addAddress"
                  >
                    <Icon v-if="isAddingAddress" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                    Add address
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </template>
      </template>

      <!-- Remove member confirmation -->
      <Dialog :open="isRemoveMemberDialogOpen" @update:open="isRemoveMemberDialogOpen = $event">
        <DialogContent class="sm:max-w-[420px]" data-testid="support-remove-member-dialog">
          <DialogHeader>
            <DialogTitle>Remove agent</DialogTitle>
            <DialogDescription v-if="isSelfRemoval">
              You are removing your own access. You will lose access to this inbox immediately; a team admin can add you
              back later.
            </DialogDescription>
            <DialogDescription v-else>
              Are you sure you want to remove "{{ memberPendingRemoval?.userName || memberPendingRemoval?.userEmail }}"
              from this inbox? They will lose access to its conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="isRemoveMemberDialogOpen = false">Cancel</Button>
            <Button
              variant="destructive"
              :disabled="removingMemberId === memberPendingRemoval?.id"
              @click="confirmRemoveMember"
            >
              <Icon
                v-if="removingMemberId === memberPendingRemoval?.id"
                name="lucide:loader-2"
                class="w-4 h-4 mr-2 animate-spin"
              />
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Remove address confirmation -->
      <Dialog :open="isRemoveAddressDialogOpen" @update:open="isRemoveAddressDialogOpen = $event">
        <DialogContent class="sm:max-w-[420px]" data-testid="support-remove-address-dialog">
          <DialogHeader>
            <DialogTitle>Remove address</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "{{ addressPendingRemoval?.address }}"? Mail sent to this address will no
              longer reach this inbox.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="isRemoveAddressDialogOpen = false"> Cancel </Button>
            <Button
              variant="destructive"
              :disabled="removingAddressId === addressPendingRemoval?.id"
              @click="confirmRemoveAddress"
            >
              <Icon
                v-if="removingAddressId === addressPendingRemoval?.id"
                name="lucide:loader-2"
                class="w-4 h-4 mr-2 animate-spin"
              />
              Remove address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'

const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'SupportSettingsPage',

  data() {
    return {
      activeTeamId: '',
      inboxes: [],
      selectedInboxId: '',
      members: [],
      addresses: [],
      teamMembers: [],
      projects: [],
      teamSettings: null,
      teamSettingsCapabilities: {},
      autoLinkFeedback: false,
      slaSettings: null,
      isLoadingSla: false,
      isSavingSla: false,
      slaError: null,
      slaHolidayText: '',
      slaDraft: {
        id: null,
        name: 'Default business hours',
        timezone: 'UTC',
        weeklySchedule: {},
        holidays: [],
        isDefault: true,
      },
      slaPolicyDraft: {
        id: null,
        name: 'Default policy',
        conditions: {},
        escalation: { notifyAssignee: true, notifySupervisor: false, raisePriority: null },
        isDefault: true,
        sortOrder: 0,
        targets: [
          { metric: 'first_response', priority: null, targetMinutes: 240 },
          { metric: 'next_response', priority: null, targetMinutes: 240 },
          { metric: 'resolution', priority: null, targetMinutes: 1440 },
        ],
      },
      csatSurveys: [],
      isLoadingCsatSurveys: false,
      csatSurveysError: null,
      isSavingCsatSurvey: false,
      csatDraft: {
        id: null,
        inboxId: null,
        name: 'Default CSAT',
        scale: 'csat_5',
        question: 'How was your support experience?',
        followUpQuestion: 'What could we improve?',
        sendTrigger: 'on_resolve',
        delayMinutes: 0,
        cooldownDays: 30,
        isEnabled: false,
      },
      automationRules: [],
      isLoadingAutomationRules: false,
      automationRulesError: null,
      isSavingAutomationRule: false,
      automationDraft: {
        id: null,
        name: '',
        inboxId: null,
        trigger: 'conversation_created',
        group: 'all',
        conditions: [{ key: 'condition-initial', field: 'priority', operator: 'equals', value: 'urgent' }],
        actions: [{ key: 'action-initial', type: 'set_priority', value: 'urgent' }],
        isEnabled: true,
        sortOrder: 0,
      },
      automationRuns: [],
      automationDryRunConversationId: '',
      automationDryRunResult: null,
      automationDryRunError: null,
      isRunningAutomationDryRun: false,
      cannedResponses: [],
      currentUserId: '',
      inboxAccessError: null,
      requestToken: 0,
      isRecoveringInbox: false,
      recoveryOwnerToken: null,

      isLoading: true,
      error: null,
      isSwitchingInbox: false,
      isSavingTeamPolicy: false,

      roleDescriptions: {
        agent: 'Works conversations and applies existing tags.',
        supervisor: 'Also manages the shared tag list.',
        admin: 'Also manages inbox settings and members.',
      },

      // native <select> styling shared across the pickers on this page —
      // there is no shadcn Select component available in this worktree yet.
      selectClasses:
        'flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-all duration-200 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',

      // create-inbox form (empty state)
      newInboxName: '',
      newInboxSlug: '',
      slugManuallyEdited: false,
      isCreatingInbox: false,

      // general form
      generalName: '',
      generalSignature: '',
      generalEmailAddress: '',
      generalFromName: '',
      isSavingGeneral: false,

      // canned responses
      cannedResponseShortcode: '',
      cannedResponseTitle: '',
      cannedResponseBody: '',
      editingCannedResponseId: null,
      isLoadingCannedResponses: false,
      cannedResponsesError: null,
      isSavingCannedResponse: false,
      deletingCannedResponseId: null,

      // sending authorization (SUP-04-6)
      sendingStatus: null,
      isLoadingSendingStatus: true,
      sendingStatusError: null,

      // channel
      channel: null,
      isLoadingChannel: true,
      channelError: null,

      // agents
      newMemberUserId: '',
      newMemberRole: 'agent',
      isAddingMember: false,
      removingMemberId: null,
      memberPendingRemoval: null,
      isRemoveMemberDialogOpen: false,

      // receiving addresses
      newAddress: '',
      newAddressProjectId: '',
      newAddressIsPrimary: false,
      isAddingAddress: false,
      removingAddressId: null,
      addressPendingRemoval: null,
      isRemoveAddressDialogOpen: false,
    }
  },

  computed: {
    hasInboxes() {
      return this.inboxes.length > 0
    },

    selectedInbox() {
      return this.inboxes.find((inbox) => inbox.id === this.selectedInboxId) || null
    },

    selectedCapabilities() {
      return this.selectedInbox?.capabilities || {}
    },

    canManageInbox() {
      return this.selectedCapabilities.canManageInbox === true
    },

    canManageMembers() {
      return this.selectedCapabilities.canManageMembers === true
    },

    canManageTeamSupport() {
      return this.teamSettingsCapabilities.canManageTeamSupport === true
    },

    isSelfRemoval() {
      return this.memberPendingRemoval?.userId === this.currentUserId
    },

    availableTeamMembers() {
      const memberUserIds = new Set(this.members.map((m) => m.userId))
      return this.teamMembers.filter((tm) => !memberUserIds.has(tm.userId))
    },

    generalHasChanges() {
      if (!this.selectedInbox) return false
      return (
        this.generalName !== (this.selectedInbox.name || '') ||
        this.generalSignature !== (this.selectedInbox.signature || '') ||
        this.generalEmailAddress !== (this.selectedInbox.emailAddress || '') ||
        this.generalFromName !== (this.selectedInbox.fromName || '')
      )
    },
    channelReady() {
      return Boolean(this.channel?.driverAvailable && this.channel?.credentialsConfigured)
    },

    webhookUrl() {
      if (!this.channel || !import.meta.client) return ''
      return `${window.location.origin}${this.channel.inboundPath}`
    },

    /**
     * The address a provider or MX record should point at. Prefers the one
     * flagged primary, since that is the inbox's canonical receiving address.
     */
    primaryAddress() {
      const list = this.addresses || []
      return (list.find((a) => a.isPrimary) || list[0])?.address || ''
    },

    slaWeekdays() {
      return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    },
  },

  async mounted() {
    await this.initPage()
    if (import.meta.client) {
      window.addEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  methods: {
    async handleActiveTeamChanged() {
      await this.initPage()
    },

    async initPage() {
      const token = ++this.requestToken
      this.isRecoveringInbox = false
      this.recoveryOwnerToken = null
      this.isLoading = true
      this.error = null
      this.inboxAccessError = null
      this.clearInboxScopedState()

      try {
        const [teamResponse, sessionResponse] = await Promise.all([
          $fetch('/api/teams/active'),
          $fetch('/api/auth/session'),
        ])
        const activeTeamData = teamResponse?.data
        if (token !== this.requestToken) return
        this.currentUserId = sessionResponse?.data?.user?.id || ''

        if (!activeTeamData?.id) {
          if (token === this.requestToken) {
            this.error = 'No active team found'
            this.isLoading = false
          }
          return
        }

        this.activeTeamId = activeTeamData.id

        const [inboxesResponse, teamMembersResponse, projectsResponse, teamSettingsResponse] = await Promise.all([
          $fetch('/api/support/inboxes', { params: { teamId: this.activeTeamId } }),
          $fetch('/api/teams/members', { params: { teamId: this.activeTeamId } }),
          $fetch(`/api/teams/${this.activeTeamId}/projects`),
          $fetch(`/api/support/teams/${this.activeTeamId}/settings`),
        ])
        if (token !== this.requestToken) return

        this.inboxes = inboxesResponse?.data?.inboxes || []
        // These two endpoints return the array directly as `data`, not wrapped
        // in a named property like the inbox endpoints above.
        this.teamMembers = teamMembersResponse?.data || []
        this.projects = projectsResponse?.data || []
        this.teamSettings = teamSettingsResponse?.data?.settings || null
        this.teamSettingsCapabilities = teamSettingsResponse?.data?.capabilities || {}
        this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true
        if (this.canManageTeamSupport) {
          await Promise.all([this.loadSlaSettings(), this.loadCsatSurveys(), this.loadAutomationRules()])
        }

        if (this.inboxes.length > 0) {
          const requestedInboxId = this.$route.query.inboxId
          const requestedIsAccessible =
            typeof requestedInboxId === 'string' && this.inboxes.some((inbox) => inbox.id === requestedInboxId)
          this.selectedInboxId = requestedIsAccessible ? requestedInboxId : this.inboxes[0].id
          if (requestedInboxId && !requestedIsAccessible) {
            this.inboxAccessError = 'You do not have access to this support inbox'
            await this.replaceInboxQuery(this.selectedInboxId)
          }
          this.syncGeneralForm()
          await this.loadInboxContext({ recovering: Boolean(requestedInboxId && !requestedIsAccessible) })
        } else if (this.$route.query.inboxId) {
          this.inboxAccessError = 'You do not have access to this support inbox'
          await this.replaceInboxQuery(null)
        }
        if (token === this.requestToken) await this.loadCannedResponses({ token, teamId: this.activeTeamId })
      } catch (error) {
        if (token !== this.requestToken) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.error = 'Something went wrong. Please try again.'
      } finally {
        if (token === this.requestToken) this.isLoading = false
      }
    },

    clearInboxScopedState() {
      this.selectedInboxId = ''
      this.members = []
      this.addresses = []
      this.sendingStatus = null
      this.sendingStatusError = null
      this.channel = null
      this.channelError = null
      this.cannedResponses = []
      this.cannedResponsesError = null
      this.resetCannedResponseForm()
      this.isSwitchingInbox = false
      this.isLoadingSendingStatus = false
      this.isLoadingChannel = false
      this.isLoadingCannedResponses = false
    },

    async replaceInboxQuery(inboxId) {
      if (!import.meta.client) return
      const query = { ...this.$route.query }
      if (inboxId) query.inboxId = inboxId
      else delete query.inboxId
      await this.$router.replace({ query }).catch(() => {})
    },

    async recoverFromForbiddenInbox({
      teamId = this.activeTeamId,
      sourceToken = this.requestToken,
      sourceInboxId = this.selectedInboxId,
    } = {}) {
      if (this.isRecoveringInbox) return
      if (!this.isCurrentRequest(sourceToken, teamId, sourceInboxId)) return
      this.isRecoveringInbox = true
      this.inboxAccessError = 'You do not have access to this support inbox'
      this.clearInboxScopedState()
      const token = ++this.requestToken
      this.recoveryOwnerToken = token
      try {
        if (!this.isCurrentRecovery(token, teamId)) return
        const response = await $fetch('/api/support/inboxes', { params: { teamId } })
        if (!this.isCurrentRecovery(token, teamId)) return
        this.inboxes = response?.data?.inboxes || []
        try {
          if (!this.isCurrentRecovery(token, teamId)) return
          const settingsResponse = await $fetch(`/api/support/teams/${teamId}/settings`)
          if (this.isCurrentRecovery(token, teamId)) {
            this.teamSettings = settingsResponse?.data?.settings || null
            this.teamSettingsCapabilities = settingsResponse?.data?.capabilities || {}
            this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true
          }
        } catch {
          if (this.isCurrentRecovery(token, teamId)) {
            this.teamSettings = null
            this.teamSettingsCapabilities = {}
            this.autoLinkFeedback = false
          }
        }
        if (!this.isCurrentRecovery(token, teamId)) return
        const fallback = this.inboxes[0]?.id || null
        if (!this.isCurrentRecovery(token, teamId)) return
        await this.replaceInboxQuery(fallback)
        if (!this.isCurrentRecovery(token, teamId)) return
        if (fallback) {
          this.selectedInboxId = fallback
          if (!this.isCurrentRecovery(token, teamId)) return
          this.syncGeneralForm()
          const loaded = await this.loadInboxContext({ recovering: true })
          if (loaded === false && this.isCurrentRecovery(token, teamId)) {
            this.clearInboxScopedState()
            if (!this.isCurrentRecovery(token, teamId)) return
            await this.replaceInboxQuery(null)
          }
        }
      } catch {
        if (this.isCurrentRecovery(token, teamId)) this.inboxes = []
      } finally {
        if (this.recoveryOwnerToken === token && this.isCurrentRequest(token, teamId, null)) {
          this.isRecoveringInbox = false
          this.recoveryOwnerToken = null
          this.isLoading = false
        }
      }
    },

    isCurrentRecovery(token, teamId) {
      return this.recoveryOwnerToken === token && this.isCurrentRequest(token, teamId, null)
    },

    isCurrentRequest(token, teamId = this.activeTeamId, inboxId = this.selectedInboxId) {
      return (
        token === this.requestToken && teamId === this.activeTeamId && (!inboxId || inboxId === this.selectedInboxId)
      )
    },

    syncGeneralForm() {
      this.generalName = this.selectedInbox?.name || ''
      this.generalSignature = this.selectedInbox?.signature || ''
      this.generalEmailAddress = this.selectedInbox?.emailAddress || ''
      this.generalFromName = this.selectedInbox?.fromName || ''
    },

    async saveTeamPolicy(value) {
      if (!this.canManageTeamSupport) return
      const token = this.requestToken
      const teamId = this.activeTeamId
      this.isSavingTeamPolicy = true
      try {
        const response = await $fetch(`/api/support/teams/${teamId}/settings`, {
          method: 'PUT',
          body: { autoLinkFeedback: value === true },
        })
        if (!this.isCurrentRequest(token, teamId)) return
        this.teamSettings = response?.data?.settings || this.teamSettings
        this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId, sourceToken: token, sourceInboxId: this.selectedInboxId })
          return
        }
        this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true
        toast.error(this.extractErrorMessage(err, 'Failed to save team support policy'))
      } finally {
        if (this.isCurrentRequest(token, teamId)) this.isSavingTeamPolicy = false
      }
    },

    formatSlaMetric(metric) {
      return (
        { first_response: 'First response', next_response: 'Next response', resolution: 'Resolution' }[metric] || metric
      )
    },

    ensureSlaWeekdays() {
      for (const day of this.slaWeekdays) {
        const closed = day === 'saturday' || day === 'sunday'
        const fallback = closed ? { open: '00:00', close: '00:00' } : { open: '09:00', close: '17:00' }
        if (!this.slaDraft.weeklySchedule[day]) this.slaDraft.weeklySchedule[day] = [fallback]
        if (!this.slaDraft.weeklySchedule[day][0]) this.slaDraft.weeklySchedule[day][0] = fallback
      }
    },

    syncSlaDraft(settings) {
      const hours = settings?.businessHours?.find((item) => item.isDefault) || settings?.businessHours?.[0]
      if (hours) {
        this.slaDraft = {
          id: hours.id,
          name: hours.name,
          timezone: hours.timezone,
          weeklySchedule: JSON.parse(JSON.stringify(hours.weeklySchedule || {})),
          holidays: [...(hours.holidays || [])],
          isDefault: true,
        }
      }
      this.ensureSlaWeekdays()
      this.slaHolidayText = (this.slaDraft.holidays || []).join(', ')
      const policy = settings?.policies?.find((item) => item.isDefault) || settings?.policies?.[0]
      if (policy) {
        const existingTargets = new Map((policy.targets || []).map((target) => [target.metric, target]))
        this.slaPolicyDraft = {
          id: policy.id,
          name: policy.name,
          conditions: policy.conditions || {},
          escalation: {
            notifyAssignee: true,
            notifySupervisor: false,
            raisePriority: null,
            ...(policy.escalation || {}),
          },
          isDefault: true,
          sortOrder: policy.sortOrder || 0,
          targets: ['first_response', 'next_response', 'resolution'].map((metric) => ({
            id: existingTargets.get(metric)?.id,
            metric,
            priority: null,
            targetMinutes: existingTargets.get(metric)?.targetMinutes || (metric === 'resolution' ? 1440 : 240),
          })),
        }
      }
    },

    async loadSlaSettings() {
      if (!this.activeTeamId || !this.canManageTeamSupport) return
      this.isLoadingSla = true
      this.slaError = null
      try {
        const response = await $fetch(`/api/support/teams/${this.activeTeamId}/sla`)
        this.slaSettings = response?.data || null
        this.syncSlaDraft(this.slaSettings)
      } catch {
        this.slaError = 'Failed to load SLA settings.'
      } finally {
        this.isLoadingSla = false
      }
    },

    async saveSlaSettings() {
      if (!this.activeTeamId || !this.canManageTeamSupport) return
      this.isSavingSla = true
      try {
        const holidays = this.slaHolidayText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
        const response = await $fetch(`/api/support/teams/${this.activeTeamId}/sla`, {
          method: 'PUT',
          body: {
            businessHours: {
              name: this.slaDraft.name,
              timezone: this.slaDraft.timezone,
              weeklySchedule: this.slaDraft.weeklySchedule,
              isDefault: true,
              ...(this.slaDraft.id ? { id: this.slaDraft.id } : {}),
              holidays,
            },
            policies: [
              {
                name: this.slaPolicyDraft.name,
                conditions: this.slaPolicyDraft.conditions,
                escalation: this.slaPolicyDraft.escalation,
                isDefault: true,
                sortOrder: this.slaPolicyDraft.sortOrder,
                ...(this.slaPolicyDraft.id ? { id: this.slaPolicyDraft.id } : {}),
                businessHoursId: this.slaDraft.id || null,
                targets: this.slaPolicyDraft.targets,
              },
            ],
          },
        })
        this.slaSettings = response?.data || this.slaSettings
        this.syncSlaDraft(this.slaSettings)
        toast.success('SLA settings saved')
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to save SLA settings'))
      } finally {
        this.isSavingSla = false
      }
    },

    resetCsatDraft() {
      this.csatDraft = {
        id: null,
        inboxId: null,
        name: 'Default CSAT',
        scale: 'csat_5',
        question: 'How was your support experience?',
        followUpQuestion: 'What could we improve?',
        sendTrigger: 'on_resolve',
        delayMinutes: 0,
        cooldownDays: 30,
        isEnabled: false,
      }
    },

    async loadCsatSurveys() {
      if (!this.activeTeamId || !this.canManageTeamSupport) return
      this.isLoadingCsatSurveys = true
      this.csatSurveysError = null
      try {
        const response = await $fetch(`/api/support/teams/${this.activeTeamId}/csat-surveys`)
        this.csatSurveys = response?.data?.surveys || []
      } catch (error) {
        this.csatSurveys = []
        this.csatSurveysError = this.extractErrorMessage(error, 'Failed to load CSAT surveys')
      } finally {
        this.isLoadingCsatSurveys = false
      }
    },

    editCsatSurvey(survey) {
      this.csatDraft = {
        id: survey.id,
        inboxId: survey.inboxId || null,
        name: survey.name,
        scale: survey.scale,
        question: survey.question,
        followUpQuestion: survey.followUpQuestion || '',
        sendTrigger: survey.sendTrigger,
        delayMinutes: survey.delayMinutes || 0,
        cooldownDays: Math.round((survey.contactCooldownMinutes || 0) / 1440),
        isEnabled: survey.isEnabled,
      }
    },

    async saveCsatSurvey() {
      if (!this.activeTeamId || !this.canManageTeamSupport) return
      if (!this.csatDraft.name.trim() || !this.csatDraft.question.trim()) {
        toast.error('Add a survey name and question')
        return
      }
      this.isSavingCsatSurvey = true
      try {
        const body = {
          inboxId: this.csatDraft.inboxId || null,
          name: this.csatDraft.name.trim(),
          scale: this.csatDraft.scale,
          question: this.csatDraft.question.trim(),
          followUpQuestion: this.csatDraft.followUpQuestion.trim() || null,
          sendTrigger: this.csatDraft.sendTrigger,
          delayMinutes: Math.max(0, Number(this.csatDraft.delayMinutes) || 0),
          contactCooldownMinutes: Math.max(0, Number(this.csatDraft.cooldownDays) || 0) * 1440,
          isEnabled: this.csatDraft.isEnabled === true,
        }
        const endpoint = this.csatDraft.id
          ? `/api/support/teams/${this.activeTeamId}/csat-surveys/${this.csatDraft.id}`
          : `/api/support/teams/${this.activeTeamId}/csat-surveys`
        await $fetch(endpoint, { method: this.csatDraft.id ? 'PUT' : 'POST', body })
        await this.loadCsatSurveys()
        this.resetCsatDraft()
        toast.success('CSAT survey saved')
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to save CSAT survey'))
      } finally {
        this.isSavingCsatSurvey = false
      }
    },

    async toggleCsatSurvey(survey, value) {
      try {
        await $fetch(`/api/support/teams/${this.activeTeamId}/csat-surveys/${survey.id}`, {
          method: 'PUT',
          body: { isEnabled: value === true },
        })
        survey.isEnabled = value === true
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to update CSAT survey'))
      }
    },

    async deleteCsatSurvey(survey) {
      if (!confirm(`Delete CSAT survey “${survey.name}”?`)) return
      try {
        await $fetch(`/api/support/teams/${this.activeTeamId}/csat-surveys/${survey.id}`, { method: 'DELETE' })
        this.csatSurveys = this.csatSurveys.filter((item) => item.id !== survey.id)
        if (this.csatDraft.id === survey.id) this.resetCsatDraft()
        toast.success('CSAT survey deleted')
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to delete CSAT survey'))
      }
    },

    resetAutomationDraft() {
      this.automationDraft = {
        id: null,
        name: '',
        inboxId: null,
        trigger: 'conversation_created',
        group: 'all',
        conditions: [{ key: `condition-${Date.now()}`, field: 'priority', operator: 'equals', value: 'urgent' }],
        actions: [{ key: `action-${Date.now()}`, type: 'set_priority', value: 'urgent' }],
        isEnabled: true,
        sortOrder: this.automationRules.length,
      }
      this.automationRuns = []
    },

    async loadAutomationRules() {
      if (!this.activeTeamId || !this.canManageTeamSupport) return
      this.isLoadingAutomationRules = true
      this.automationRulesError = null
      try {
        const response = await $fetch(`/api/support/teams/${this.activeTeamId}/automation-rules`)
        this.automationRules = response?.data?.rules || []
      } catch (error) {
        this.automationRules = []
        this.automationRulesError = this.extractErrorMessage(error, 'Failed to load automation rules')
      } finally {
        this.isLoadingAutomationRules = false
      }
    },

    editAutomationRule(rule) {
      const group = Array.isArray(rule.conditions?.any) ? 'any' : 'all'
      const sourceConditions = rule.conditions?.[group] || []
      this.automationDraft = {
        id: rule.id,
        name: rule.name,
        inboxId: rule.inboxId || null,
        trigger: rule.trigger,
        group,
        conditions: sourceConditions.map((condition, index) => ({
          key: `${rule.id}-condition-${index}`,
          field: condition.field || 'priority',
          operator: condition.operator || 'equals',
          value: condition.value ?? '',
        })),
        actions: (rule.actions || []).map((action, index) => ({
          key: `${rule.id}-action-${index}`,
          type: action.type,
          value: action.value ?? action.priority ?? action.status ?? action.tagId ?? action.body ?? action.url ?? '',
        })),
        isEnabled: rule.isEnabled,
        sortOrder: rule.sortOrder || 0,
      }
      if (this.automationDraft.conditions.length === 0) this.addAutomationCondition()
      if (this.automationDraft.actions.length === 0) this.addAutomationAction()
    },

    addAutomationCondition() {
      this.automationDraft.conditions.push({
        key: `condition-${Date.now()}-${this.automationDraft.conditions.length}`,
        field: 'priority',
        operator: 'equals',
        value: 'urgent',
      })
    },

    removeAutomationCondition(index) {
      if (this.automationDraft.conditions.length > 1) this.automationDraft.conditions.splice(index, 1)
    },

    addAutomationAction() {
      this.automationDraft.actions.push({
        key: `action-${Date.now()}-${this.automationDraft.actions.length}`,
        type: 'set_priority',
        value: 'urgent',
      })
    },

    removeAutomationAction(index) {
      if (this.automationDraft.actions.length > 1) this.automationDraft.actions.splice(index, 1)
    },

    automationActionPayload(action) {
      const payload = { type: action.type, value: action.value }
      if (action.type === 'set_priority') payload.priority = action.value
      if (action.type === 'set_status') payload.status = action.value
      if (action.type === 'assign_to_agent') payload.userId = action.value
      if (action.type === 'add_tag' || action.type === 'remove_tag') payload.tagId = action.value
      if (action.type === 'add_private_note') payload.body = action.value
      if (action.type === 'call_webhook') payload.url = action.value
      return payload
    },

    async saveAutomationRule() {
      if (!this.activeTeamId || !this.canManageTeamSupport || !this.automationDraft.name.trim()) {
        toast.error('Add a name for this automation rule')
        return
      }
      this.isSavingAutomationRule = true
      try {
        const body = {
          name: this.automationDraft.name.trim(),
          inboxId: this.automationDraft.inboxId || null,
          trigger: this.automationDraft.trigger,
          conditions: {
            [this.automationDraft.group]: this.automationDraft.conditions.map(({ field, operator, value }) => ({
              field,
              operator,
              value,
            })),
          },
          actions: this.automationDraft.actions.map((action) => this.automationActionPayload(action)),
          isEnabled: this.automationDraft.isEnabled,
          sortOrder: this.automationDraft.sortOrder,
        }
        const endpoint = this.automationDraft.id
          ? `/api/support/teams/${this.activeTeamId}/automation-rules/${this.automationDraft.id}`
          : `/api/support/teams/${this.activeTeamId}/automation-rules`
        await $fetch(endpoint, { method: this.automationDraft.id ? 'PUT' : 'POST', body })
        await this.loadAutomationRules()
        this.resetAutomationDraft()
        toast.success('Automation rule saved')
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to save automation rule'))
      } finally {
        this.isSavingAutomationRule = false
      }
    },

    async toggleAutomationRule(rule, value) {
      try {
        await $fetch(`/api/support/teams/${this.activeTeamId}/automation-rules/${rule.id}`, {
          method: 'PUT',
          body: { isEnabled: value === true },
        })
        rule.isEnabled = value === true
        toast.success(value ? 'Automation rule enabled' : 'Automation rule paused')
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to update automation rule'))
      }
    },

    async deleteAutomationRule(rule) {
      if (!confirm(`Delete automation rule “${rule.name}”?`)) return
      try {
        await $fetch(`/api/support/teams/${this.activeTeamId}/automation-rules/${rule.id}`, { method: 'DELETE' })
        this.automationRules = this.automationRules.filter((item) => item.id !== rule.id)
        if (this.automationDraft.id === rule.id) this.resetAutomationDraft()
        toast.success('Automation rule deleted')
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to delete automation rule'))
      }
    },

    async loadAutomationRuns(rule) {
      try {
        const response = await $fetch(`/api/support/teams/${this.activeTeamId}/automation-rules/${rule.id}/runs`)
        this.automationRuns = response?.data?.runs || []
      } catch (error) {
        toast.error(this.extractErrorMessage(error, 'Failed to load run history'))
      }
    },

    async runAutomationDryRun() {
      if (!this.activeTeamId || !this.automationDryRunConversationId.trim()) {
        this.automationDryRunError = 'Enter a conversation id first.'
        return
      }
      this.isRunningAutomationDryRun = true
      this.automationDryRunError = null
      this.automationDryRunResult = null
      try {
        const response = await $fetch(`/api/support/teams/${this.activeTeamId}/automation-rules/dry-run`, {
          method: 'POST',
          body: { conversationId: this.automationDryRunConversationId.trim(), trigger: 'conversation_updated' },
        })
        this.automationDryRunResult = response?.data || null
      } catch (error) {
        this.automationDryRunError = this.extractErrorMessage(error, 'Dry run failed')
      } finally {
        this.isRunningAutomationDryRun = false
      }
    },

    async loadInboxContext({ recovering = false } = {}) {
      if (!this.selectedInboxId) return false
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId
      this.isSwitchingInbox = true
      this.members = []
      this.addresses = []
      this.sendingStatus = null
      this.channel = null

      try {
        const [membersResponse, addressesResponse] = await Promise.all([
          $fetch(`/api/support/inboxes/${inboxId}/members`),
          $fetch(`/api/support/inboxes/${inboxId}/addresses`),
        ])
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        this.members = membersResponse?.data?.members || []
        this.addresses = addressesResponse?.data?.addresses || []
      } catch (err) {
        if (this.isForbiddenError(err)) {
          if (!this.isCurrentRequest(token, teamId, inboxId)) return false
          if (!recovering) {
            await this.recoverFromForbiddenInbox({ teamId, sourceToken: token, sourceInboxId: inboxId })
            return false
          }
          if (this.isCurrentRequest(token, teamId, inboxId)) {
            this.clearInboxScopedState()
            await this.replaceInboxQuery(null)
          }
          return false
        }
        if (!recovering) toast.error('Failed to load inbox details')
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isSwitchingInbox = false
      }

      if (this.isCurrentRequest(token, teamId, inboxId)) {
        const statuses = await Promise.all([
          this.loadSendingStatus({ recovering, token, teamId, inboxId }),
          this.loadChannelStatus({ recovering, token, teamId, inboxId }),
        ])
        if (statuses.some((loaded) => loaded === false) && this.isCurrentRequest(token, teamId, inboxId)) {
          this.clearInboxScopedState()
          await this.replaceInboxQuery(null)
          return false
        }
      }
      return this.isCurrentRequest(token, teamId, inboxId)
    },

    async loadCannedResponses({ token = this.requestToken, teamId = this.activeTeamId } = {}) {
      if (!teamId || token !== this.requestToken) return false
      this.isLoadingCannedResponses = true
      this.cannedResponsesError = null
      try {
        const response = await $fetch('/api/support/canned-responses', { params: { teamId } })
        if (token !== this.requestToken || teamId !== this.activeTeamId) return false
        this.cannedResponses = response?.data?.cannedResponses || []
        return true
      } catch (err) {
        if (token !== this.requestToken || teamId !== this.activeTeamId) return false
        this.cannedResponses = []
        this.cannedResponsesError = this.extractErrorMessage(err, 'Failed to load canned responses')
        return false
      } finally {
        if (token === this.requestToken && teamId === this.activeTeamId) this.isLoadingCannedResponses = false
      }
    },

    async loadSendingStatus({
      recovering = false,
      token = this.requestToken,
      teamId = this.activeTeamId,
      inboxId = this.selectedInboxId,
    } = {}) {
      if (!inboxId || !this.isCurrentRequest(token, teamId, inboxId)) return false
      this.isLoadingSendingStatus = true
      this.sendingStatusError = null

      try {
        const response = await $fetch(`/api/support/inboxes/${inboxId}/sending-status`)
        if (this.isCurrentRequest(token, teamId, inboxId)) this.sendingStatus = response?.data || null
      } catch (err) {
        if (this.isForbiddenError(err)) {
          if (!this.isCurrentRequest(token, teamId, inboxId)) return false
          if (!recovering) {
            await this.recoverFromForbiddenInbox({ teamId, sourceToken: token, sourceInboxId: inboxId })
          }
          return false
        }
        if (this.isCurrentRequest(token, teamId, inboxId))
          this.sendingStatusError = this.extractErrorMessage(err, 'Failed to check sending authorization')
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isLoadingSendingStatus = false
      }
      return this.isCurrentRequest(token, teamId, inboxId)
    },

    async handleInboxSwitch() {
      this.requestToken += 1
      this.isRecoveringInbox = false
      this.recoveryOwnerToken = null
      await this.replaceInboxQuery(this.selectedInboxId)
      this.syncGeneralForm()
      await this.loadInboxContext()
    },

    isForbiddenError(err) {
      return err?.statusCode === 403 || err?.status === 403 || err?.response?.status === 403
    },

    extractErrorMessage(err, fallback) {
      return err?.data?.data?.error?.message || fallback
    },

    deriveSlug(value) {
      return (value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
    },

    onNewInboxNameInput() {
      if (!this.slugManuallyEdited) {
        this.newInboxSlug = this.deriveSlug(this.newInboxName)
      }
    },

    onNewInboxSlugInput() {
      this.slugManuallyEdited = true
      this.newInboxSlug = this.deriveSlug(this.newInboxSlug)
    },

    async createInbox() {
      if (!this.newInboxName.trim() || !this.newInboxSlug.trim()) {
        toast.error('Name and slug are required')
        return
      }

      this.isCreatingInbox = true
      const token = this.requestToken
      const teamId = this.activeTeamId

      try {
        const response = await $fetch('/api/support/inboxes', {
          method: 'POST',
          body: {
            teamId,
            name: this.newInboxName.trim(),
            slug: this.newInboxSlug.trim(),
          },
        })
        const created = response?.data?.inbox
        if (!this.isCurrentRequest(token, teamId, null)) return

        toast.success('Inbox created')
        this.newInboxName = ''
        this.newInboxSlug = ''
        this.slugManuallyEdited = false

        const inboxesResponse = await $fetch('/api/support/inboxes', { params: { teamId } })
        if (!this.isCurrentRequest(token, teamId, null)) return
        this.inboxes = inboxesResponse?.data?.inboxes || []
        this.selectedInboxId = created?.id || this.inboxes[0]?.id || ''

        if (this.selectedInboxId) {
          this.syncGeneralForm()
          await this.loadInboxContext()
        }
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, null)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId, sourceToken: token, sourceInboxId: null })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to create inbox'))
      } finally {
        if (this.isCurrentRequest(token, teamId, null)) this.isCreatingInbox = false
      }
    },

    async saveGeneral() {
      if (!this.selectedInbox) return
      this.isSavingGeneral = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}`, {
          method: 'PUT',
          body: {
            name: this.generalName.trim(),
            signature: this.generalSignature,
            emailAddress: this.generalEmailAddress.trim() || null,
            fromName: this.generalFromName.trim() || null,
          },
        })

        const inboxesResponse = await $fetch('/api/support/inboxes', { params: { teamId } })
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        this.inboxes = inboxesResponse?.data?.inboxes || []
        this.syncGeneralForm()
        toast.success('Inbox settings saved')
        await this.loadSendingStatus({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to save inbox settings'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isSavingGeneral = false
      }
    },

    editCannedResponse(response) {
      this.editingCannedResponseId = response.id
      this.cannedResponseShortcode = response.shortcode || ''
      this.cannedResponseTitle = response.title || ''
      this.cannedResponseBody = response.body || ''
    },

    resetCannedResponseForm() {
      this.cannedResponseShortcode = ''
      this.cannedResponseTitle = ''
      this.cannedResponseBody = ''
      this.editingCannedResponseId = null
      this.isSavingCannedResponse = false
      this.deletingCannedResponseId = null
    },

    async saveCannedResponse() {
      if (!this.activeTeamId) return
      if (!this.cannedResponseShortcode.trim() || !this.cannedResponseTitle.trim() || !this.cannedResponseBody.trim()) {
        toast.error('Shortcode, title, and body are required')
        return
      }

      this.isSavingCannedResponse = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const editingId = this.editingCannedResponseId
      const payload = {
        shortcode: this.cannedResponseShortcode.trim(),
        title: this.cannedResponseTitle.trim(),
        body: this.cannedResponseBody.trim(),
      }

      try {
        if (editingId) {
          await $fetch(`/api/support/canned-responses/${editingId}`, { method: 'PUT', body: payload })
        } else {
          await $fetch('/api/support/canned-responses', { method: 'POST', body: { teamId, ...payload } })
        }

        if (token !== this.requestToken || teamId !== this.activeTeamId) return
        toast.success(editingId ? 'Canned response saved' : 'Canned response added')
        this.resetCannedResponseForm()
        await this.loadCannedResponses({ token, teamId })
      } catch (err) {
        if (token !== this.requestToken || teamId !== this.activeTeamId) return
        toast.error(this.extractErrorMessage(err, 'Failed to save canned response'))
      } finally {
        if (token === this.requestToken && teamId === this.activeTeamId) this.isSavingCannedResponse = false
      }
    },

    async deleteCannedResponse(response) {
      if (!response?.id || !this.activeTeamId) return
      this.deletingCannedResponseId = response.id
      const token = this.requestToken
      const teamId = this.activeTeamId
      try {
        await $fetch(`/api/support/canned-responses/${response.id}`, { method: 'DELETE' })
        if (token !== this.requestToken || teamId !== this.activeTeamId) return
        toast.success('Canned response deleted')
        if (this.editingCannedResponseId === response.id) this.resetCannedResponseForm()
        await this.loadCannedResponses({ token, teamId })
      } catch (err) {
        if (token !== this.requestToken || teamId !== this.activeTeamId) return
        toast.error(this.extractErrorMessage(err, 'Failed to delete canned response'))
      } finally {
        if (token === this.requestToken && teamId === this.activeTeamId) this.deletingCannedResponseId = null
      }
    },

    async reloadMembers({
      token = this.requestToken,
      teamId = this.activeTeamId,
      inboxId = this.selectedInboxId,
    } = {}) {
      if (!inboxId || !this.isCurrentRequest(token, teamId, inboxId)) return false
      try {
        const membersResponse = await $fetch(`/api/support/inboxes/${inboxId}/members`)
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        this.members = membersResponse?.data?.members || []
        return true
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        if (this.isForbiddenError(err)) return this.recoverFromForbiddenInbox({ teamId })
        throw err
      }
    },

    async addMember() {
      if (!this.newMemberUserId) {
        toast.error('Select a team member to add')
        return
      }

      this.isAddingMember = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/members`, {
          method: 'POST',
          body: { userId: this.newMemberUserId, role: this.newMemberRole },
        })

        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Agent added')
        this.newMemberUserId = ''
        this.newMemberRole = 'agent'
        await this.reloadMembers({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to add agent'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isAddingMember = false
      }
    },

    openRemoveMemberDialog(member) {
      this.memberPendingRemoval = member
      this.isRemoveMemberDialogOpen = true
    },

    async confirmRemoveMember() {
      if (!this.memberPendingRemoval) return
      const memberId = this.memberPendingRemoval.id
      this.removingMemberId = memberId
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/members/${memberId}`, { method: 'DELETE' })
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Agent removed')
        this.isRemoveMemberDialogOpen = false
        this.memberPendingRemoval = null
        await this.reloadMembers({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to remove agent'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.removingMemberId = null
      }
    },

    async loadChannelStatus({
      recovering = false,
      token = this.requestToken,
      teamId = this.activeTeamId,
      inboxId = this.selectedInboxId,
    } = {}) {
      if (!inboxId) {
        this.channel = null
        this.isLoadingChannel = false
        return false
      }
      if (!this.isCurrentRequest(token, teamId, inboxId)) return false
      this.isLoadingChannel = true
      this.channelError = null
      try {
        const response = await $fetch('/api/support/channel-status', { params: { inboxId } })
        if (this.isCurrentRequest(token, teamId, inboxId)) this.channel = response?.data || null
      } catch (err) {
        if (this.isForbiddenError(err)) {
          if (!this.isCurrentRequest(token, teamId, inboxId)) return false
          if (!recovering) {
            await this.recoverFromForbiddenInbox({ teamId, sourceToken: token, sourceInboxId: inboxId })
          }
          return false
        }
        if (this.isCurrentRequest(token, teamId, inboxId))
          this.channelError = err?.data?.error?.message || 'Failed to load channel status'
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isLoadingChannel = false
      }
      return this.isCurrentRequest(token, teamId, inboxId)
    },

    async copy(value) {
      if (!import.meta.client || !value) return
      try {
        await navigator.clipboard.writeText(value)
        toast.success('Copied')
      } catch {
        toast.error('Could not copy to clipboard')
      }
    },

    async reloadAddresses({
      token = this.requestToken,
      teamId = this.activeTeamId,
      inboxId = this.selectedInboxId,
    } = {}) {
      if (!inboxId || !this.isCurrentRequest(token, teamId, inboxId)) return false
      try {
        const addressesResponse = await $fetch(`/api/support/inboxes/${inboxId}/addresses`)
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        this.addresses = addressesResponse?.data?.addresses || []
        return true
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        if (this.isForbiddenError(err)) return this.recoverFromForbiddenInbox({ teamId })
        throw err
      }
    },

    async addAddress() {
      if (!this.newAddress.trim()) {
        toast.error('Enter an email address')
        return
      }

      this.isAddingAddress = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/addresses`, {
          method: 'POST',
          body: {
            address: this.newAddress.trim(),
            projectId: this.newAddressProjectId || undefined,
            isPrimary: this.newAddressIsPrimary,
          },
        })

        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Address added')
        this.newAddress = ''
        this.newAddressProjectId = ''
        this.newAddressIsPrimary = false
        await this.reloadAddresses({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to add address'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isAddingAddress = false
      }
    },

    openRemoveAddressDialog(address) {
      this.addressPendingRemoval = address
      this.isRemoveAddressDialogOpen = true
    },

    async confirmRemoveAddress() {
      if (!this.addressPendingRemoval) return
      const addressId = this.addressPendingRemoval.id
      this.removingAddressId = addressId
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/addresses/${addressId}`, { method: 'DELETE' })
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Address removed')
        this.isRemoveAddressDialogOpen = false
        this.addressPendingRemoval = null
        await this.reloadAddresses({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to remove address'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.removingAddressId = null
      }
    },

    productName(projectId) {
      if (!projectId) return null
      const found = this.projects.find((p) => p.id === projectId)
      return found ? found.name : 'Unknown product'
    },

    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },
  },
}
</script>
