<template>
  <Card id="forms" class="scroll-mt-16" data-testid="support-forms-settings">
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <CardTitle class="flex items-center gap-2">
            <Icon name="lucide:clipboard-list" class="h-5 w-5" />
            Website forms
          </CardTitle>
          <CardDescription>
            Contact and support forms on your sites. Each submission opens a conversation from the submitter, just like
            an email to the inbox, and your replies go to them by email.
          </CardDescription>
        </div>
        <Button v-if="!draft" size="sm" data-testid="support-form-new" :disabled="isLoading" @click="startNew">
          <Icon name="lucide:plus" class="mr-1.5 h-4 w-4" />
          New form
        </Button>
      </div>
    </CardHeader>
    <CardContent class="space-y-6">
      <!-- Editor -->
      <div v-if="draft" class="space-y-5" data-testid="support-form-editor">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <Label for="support-form-name">Name</Label>
            <Input
              id="support-form-name"
              v-model="draft.name"
              class="mt-2"
              maxlength="80"
              placeholder="Contact form"
              @input="onNameInput"
            />
          </div>
          <div>
            <Label for="support-form-slug">Slug</Label>
            <Input
              id="support-form-slug"
              v-model="draft.slug"
              class="mt-2 font-mono"
              maxlength="60"
              placeholder="contact"
              @input="slugTouched = true"
            />
            <p class="mt-1 text-xs text-muted-foreground">Used in the API URL. Changing it breaks existing sites.</p>
          </div>
          <div>
            <Label for="support-form-inbox">Inbox</Label>
            <select id="support-form-inbox" v-model="draft.inboxId" :class="selectClasses + ' mt-2'">
              <option v-for="inbox in inboxes" :key="inbox.id" :value="inbox.id">{{ inbox.name }}</option>
            </select>
          </div>
          <div class="flex items-center gap-3 pt-7">
            <Switch id="support-form-enabled" v-model="draft.isEnabled" />
            <Label for="support-form-enabled">Accepting submissions</Label>
          </div>
        </div>

        <!-- Fields -->
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">Fields</p>
            <div class="flex gap-2">
              <Button
                v-if="isNewDraft"
                variant="ghost"
                size="sm"
                data-testid="support-form-preset"
                @click="applyContactPreset"
              >
                <Icon name="lucide:wand-2" class="mr-1.5 h-4 w-4" />
                Use contact form fields
              </Button>
              <Button variant="outline" size="sm" data-testid="support-form-add-field" @click="addField">
                <Icon name="lucide:plus" class="mr-1.5 h-4 w-4" />
                Add field
              </Button>
            </div>
          </div>
          <div
            v-for="(field, index) in draft.fields"
            :key="field.uid"
            class="space-y-3 rounded-lg border p-3"
            data-testid="support-form-field-row"
          >
            <div class="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
              <div>
                <Label :for="`support-form-field-label-${field.uid}`" class="text-xs">Label</Label>
                <Input
                  :id="`support-form-field-label-${field.uid}`"
                  v-model="field.label"
                  class="mt-1 h-9"
                  maxlength="120"
                  @input="onFieldLabelInput(field)"
                />
              </div>
              <div>
                <Label :for="`support-form-field-key-${field.uid}`" class="text-xs">Key</Label>
                <Input
                  :id="`support-form-field-key-${field.uid}`"
                  v-model="field.key"
                  class="mt-1 h-9 font-mono"
                  maxlength="40"
                  @input="field.keyTouched = true"
                />
              </div>
              <div>
                <Label :for="`support-form-field-type-${field.uid}`" class="text-xs">Type</Label>
                <select
                  :id="`support-form-field-type-${field.uid}`"
                  v-model="field.type"
                  :class="selectClasses + ' mt-1 h-9'"
                >
                  <option v-for="type in fieldTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
                </select>
              </div>
            </div>
            <div v-if="field.type === 'select'">
              <Label :for="`support-form-field-options-${field.uid}`" class="text-xs">Options</Label>
              <Textarea
                :id="`support-form-field-options-${field.uid}`"
                v-model="field.optionsText"
                class="mt-1 font-mono text-xs"
                rows="4"
                placeholder="order | Order / Shipping&#10;support | Technical Support"
              />
              <p class="mt-1 text-xs text-muted-foreground">
                One per line: <code>value | Label</code>. The site sends the value; agents see the label.
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="flex items-center gap-2 text-sm">
                <input v-model="field.required" type="checkbox" class="h-4 w-4 rounded border-input" />
                Required
              </label>
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :disabled="index === 0"
                  title="Move up"
                  @click="moveField(index, -1)"
                >
                  <Icon name="lucide:arrow-up" class="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :disabled="index === draft.fields.length - 1"
                  title="Move down"
                  @click="moveField(index, 1)"
                >
                  <Icon name="lucide:arrow-down" class="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:text-destructive"
                  title="Remove field"
                  @click="removeField(index)"
                >
                  <Icon name="lucide:trash-2" class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <p v-if="draft.fields.length === 0" class="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            No fields yet. A form needs at least a required email field.
          </p>
        </div>

        <!-- Mapping -->
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <Label for="support-form-map-email">Contact email from</Label>
            <select id="support-form-map-email" v-model="draft.fieldMapping.email" :class="selectClasses + ' mt-2'">
              <option value="">Choose a field</option>
              <option v-for="field in fieldsOfType(['email'])" :key="field.uid" :value="field.key">
                {{ field.label || field.key }}
              </option>
            </select>
          </div>
          <div>
            <Label for="support-form-map-name">Contact name from</Label>
            <select id="support-form-map-name" v-model="draft.fieldMapping.name" :class="selectClasses + ' mt-2'">
              <option value="">None</option>
              <option v-for="field in fieldsOfType(['text'])" :key="field.uid" :value="field.key">
                {{ field.label || field.key }}
              </option>
            </select>
          </div>
          <div>
            <Label for="support-form-map-subject">Subject from</Label>
            <select id="support-form-map-subject" v-model="draft.fieldMapping.subject" :class="selectClasses + ' mt-2'">
              <option value="">The form name</option>
              <option v-for="field in fieldsOfType(['text', 'select'])" :key="field.uid" :value="field.key">
                {{ field.label || field.key }}
              </option>
            </select>
          </div>
        </div>

        <!-- Auto-reply -->
        <div class="space-y-2">
          <Label for="support-form-auto-reply">Auto-reply</Label>
          <select id="support-form-auto-reply" v-model="draft.autoReplyMode" :class="selectClasses">
            <option value="inbox">Same as the inbox's auto-reply</option>
            <option value="custom">A reply for this form</option>
            <option value="off">No auto-reply</option>
          </select>
          <Textarea
            v-if="draft.autoReplyMode === 'custom'"
            id="support-form-auto-reply-template"
            v-model="draft.autoReplyTemplate"
            rows="4"
            maxlength="5000"
            placeholder="Thanks for getting in touch. We usually reply within one business day."
          />
          <p class="text-xs text-muted-foreground">
            Sent once to the submitter when the conversation opens, at most once an hour per contact.
          </p>
        </div>

        <!-- Browser submissions -->
        <div class="space-y-3 rounded-lg border p-3">
          <div class="flex items-center gap-3">
            <Switch id="support-form-browser" v-model="draft.browserSubmissionsEnabled" />
            <Label for="support-form-browser">Accept submissions straight from the browser</Label>
          </div>
          <p class="text-xs text-muted-foreground">
            For sites without a backend. Submissions are accepted only from the origins below, rate limited per visitor,
            and checked with a honeypot. Sites with a backend should use a server key instead.
          </p>
          <div>
            <Label for="support-form-origins" class="text-xs">Allowed origins</Label>
            <Textarea
              id="support-form-origins"
              v-model="draft.originsText"
              class="mt-1 font-mono text-xs"
              rows="3"
              placeholder="https://shop.example.com&#10;https://*.example.com"
            />
            <p class="mt-1 text-xs text-muted-foreground">One per line, scheme and host only.</p>
          </div>
        </div>

        <ul
          v-if="draftErrors.length > 0 && showDraftErrors"
          class="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="support-form-errors"
        >
          <li v-for="message in draftErrors" :key="message">{{ message }}</li>
        </ul>

        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="isSaving" @click="cancelDraft">Cancel</Button>
          <Button data-testid="support-form-save" :disabled="isSaving" @click="saveDraft">
            <Icon v-if="isSaving" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            {{ isNewDraft ? 'Create form' : 'Save form' }}
          </Button>
        </div>
      </div>

      <!-- List -->
      <template v-else>
        <div v-if="isLoading" class="space-y-2">
          <Skeleton v-for="n in 2" :key="n" class="h-16 w-full" />
        </div>
        <div v-else-if="error" class="py-4 text-center">
          <p class="mb-2 text-sm text-destructive">{{ error }}</p>
          <Button variant="outline" size="sm" @click="loadForms">
            <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
        <p v-else-if="forms.length === 0" class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No forms yet. Create one, then give your site a server key and the form's endpoint.
        </p>
        <div v-else class="space-y-2">
          <div
            v-for="form in forms"
            :key="form.id"
            class="rounded-lg border p-3"
            data-testid="support-form-row"
            :data-form-slug="form.slug"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-sm font-medium">{{ form.name }}</p>
                  <Badge v-if="!form.isEnabled" variant="secondary" class="text-xs">Off</Badge>
                  <Badge v-if="form.browserSubmissionsEnabled" variant="outline" class="text-xs">Browser</Badge>
                </div>
                <p class="text-xs text-muted-foreground">
                  <code>{{ form.slug }}</code> · to {{ inboxName(form.inboxId) }} · {{ form.fields.length }}
                  {{ form.fields.length === 1 ? 'field' : 'fields' }} · {{ form.submissionCount }}
                  {{ form.submissionCount === 1 ? 'submission' : 'submissions' }}
                </p>
              </div>
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  :data-testid="`support-form-usage-${form.slug}`"
                  @click="toggleUsage(form.id)"
                >
                  <Icon name="lucide:code" class="mr-1.5 h-4 w-4" />
                  {{ usageFormId === form.id ? 'Hide' : 'Connect' }}
                </Button>
                <Button variant="ghost" size="sm" :data-testid="`support-form-edit-${form.slug}`" @click="edit(form)">
                  <Icon name="lucide:pencil" class="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-destructive hover:text-destructive"
                  @click="deletingForm = form"
                >
                  <Icon name="lucide:trash-2" class="h-4 w-4" />
                  <span class="sr-only">Delete</span>
                </Button>
              </div>
            </div>
            <div v-if="usageFormId === form.id" class="mt-3 space-y-3" data-testid="support-form-usage">
              <div>
                <p class="mb-1 text-xs font-medium">From your server</p>
                <pre
                  class="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs"
                  data-testid="support-form-usage-server"
                  >{{ serverExample(form) }}</pre
                >
              </div>
              <div v-if="form.browserSubmissionsEnabled">
                <p class="mb-1 text-xs font-medium">From the browser</p>
                <pre
                  class="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs"
                  >{{ browserExample(form) }}</pre
                >
              </div>
              <p class="text-xs text-muted-foreground">
                Request and error reference:
                <NuxtLink to="/api-docs" class="underline hover:no-underline">API docs</NuxtLink>
                (App API → Submit a website form).
              </p>
            </div>
          </div>
        </div>

        <SupportFormServerKeys v-if="projectSlug" :project-slug="projectSlug" />
      </template>
    </CardContent>

    <Dialog :open="Boolean(deletingForm)" @update:open="(open) => !open && (deletingForm = null)">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Delete form</DialogTitle>
          <DialogDescription>
            Delete "{{ deletingForm?.name }}"? Sites still sending to it will get errors. Conversations it already
            created stay in the inbox.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="deletingForm = null">Cancel</Button>
          <Button variant="destructive" :disabled="isDeleting" @click="deleteForm">
            <Icon v-if="isDeleting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>

<script>
import { toast } from 'vue-sonner'
import { FORM_HONEYPOT_FIELD, normalizeOrigin, validateFormDefinition } from '~/lib/support-forms'

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
]

let uidCounter = 0
const nextUid = () => `field-${++uidCounter}`

function slugify(value, separator = '-') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
    .slice(0, 40)
}

function optionsToText(options) {
  return (options || []).map((option) => `${option.value} | ${option.label}`).join('\n')
}

function textToOptions(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf('|')
      if (bar < 0) return { value: slugify(line, '_') || line, label: line }
      return { value: line.slice(0, bar).trim(), label: line.slice(bar + 1).trim() }
    })
}

function draftField(field) {
  return {
    uid: nextUid(),
    key: field.key || '',
    label: field.label || '',
    type: field.type || 'text',
    required: Boolean(field.required),
    optionsText: optionsToText(field.options),
    keyTouched: Boolean(field.key),
  }
}

export default {
  name: 'SupportFormsSettings',
  props: {
    projectId: {
      type: String,
      required: true,
    },
    projectSlug: {
      type: String,
      default: '',
    },
    inboxes: {
      type: Array,
      default: () => [],
    },
    selectClasses: {
      type: String,
      default: 'flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm',
    },
  },
  data() {
    return {
      forms: [],
      isLoading: true,
      error: null,
      draft: null,
      editingId: null,
      slugTouched: false,
      showDraftErrors: false,
      isSaving: false,
      deletingForm: null,
      isDeleting: false,
      usageFormId: null,
      fieldTypes: FIELD_TYPES,
    }
  },
  computed: {
    isNewDraft() {
      return this.editingId === null
    },
    draftPayload() {
      if (!this.draft) return null
      const fields = this.draft.fields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        required: field.required,
        ...(field.type === 'select' ? { options: textToOptions(field.optionsText) } : {}),
      }))
      return {
        name: this.draft.name.trim(),
        slug: this.draft.slug.trim(),
        inboxId: this.draft.inboxId,
        fields,
        fieldMapping: {
          email: this.draft.fieldMapping.email,
          name: this.draft.fieldMapping.name || null,
          subject: this.draft.fieldMapping.subject || null,
        },
        autoReplyMode: this.draft.autoReplyMode,
        autoReplyTemplate: this.draft.autoReplyMode === 'custom' ? this.draft.autoReplyTemplate : null,
        allowedOrigins: this.draft.originsText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        browserSubmissionsEnabled: this.draft.browserSubmissionsEnabled,
        isEnabled: this.draft.isEnabled,
      }
    },
    draftErrors() {
      const payload = this.draftPayload
      if (!payload) return []
      const errors = []
      if (!payload.name) errors.push('Give the form a name.')
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) {
        errors.push('The slug may use lowercase letters, digits and hyphens.')
      }
      if (!payload.inboxId) errors.push('Pick the inbox submissions go to.')
      for (const problem of validateFormDefinition(payload)) errors.push(this.describeProblem(problem))
      const badOrigins = payload.allowedOrigins.filter((origin) => !normalizeOrigin(origin))
      if (badOrigins.length > 0) errors.push(`Not an origin: ${badOrigins.join(', ')}`)
      if (payload.browserSubmissionsEnabled && payload.allowedOrigins.length === 0) {
        errors.push('Add at least one allowed origin to accept browser submissions.')
      }
      if (payload.autoReplyMode === 'custom' && !payload.autoReplyTemplate?.trim()) errors.push('Write the auto-reply.')
      return errors
    },
  },
  watch: {
    projectId() {
      this.draft = null
      this.loadForms()
    },
  },
  async mounted() {
    await this.loadForms()
  },
  methods: {
    formsUrl() {
      return `/api/support/projects/${this.projectId}/forms`
    },
    async loadForms() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(this.formsUrl())
        this.forms = Array.isArray(response?.data?.forms) ? response.data.forms : []
      } catch (err) {
        this.error = err?.data?.error?.message || err?.statusMessage || 'Failed to load forms'
      } finally {
        this.isLoading = false
      }
    },
    inboxName(inboxId) {
      return this.inboxes.find((inbox) => inbox.id === inboxId)?.name || 'an inbox'
    },
    describeProblem(problem) {
      const [path, ...rest] = problem.split(': ')
      const message = rest.join(': ')
      const match = /^fields\[(\d+)\]/.exec(path)
      if (match) {
        const field = this.draft.fields[Number(match[1])]
        return `${field?.label || `Field ${Number(match[1]) + 1}`}: ${message}`
      }
      if (path.startsWith('fieldMapping.')) return `${path.replace('fieldMapping.', 'Contact ')}: ${message}`
      return message
    },
    emptyDraft() {
      return {
        name: '',
        slug: '',
        inboxId: this.inboxes[0]?.id || '',
        fields: [],
        fieldMapping: { email: '', name: '', subject: '' },
        autoReplyMode: 'inbox',
        autoReplyTemplate: '',
        originsText: '',
        browserSubmissionsEnabled: false,
        isEnabled: true,
      }
    },
    startNew() {
      this.editingId = null
      this.slugTouched = false
      this.showDraftErrors = false
      this.draft = this.emptyDraft()
    },
    edit(form) {
      this.editingId = form.id
      this.slugTouched = true
      this.showDraftErrors = false
      this.draft = {
        name: form.name,
        slug: form.slug,
        inboxId: form.inboxId,
        fields: form.fields.map(draftField),
        fieldMapping: {
          email: form.fieldMapping.email || '',
          name: form.fieldMapping.name || '',
          subject: form.fieldMapping.subject || '',
        },
        autoReplyMode: form.autoReplyMode,
        autoReplyTemplate: form.autoReplyTemplate || '',
        originsText: (form.allowedOrigins || []).join('\n'),
        browserSubmissionsEnabled: form.browserSubmissionsEnabled,
        isEnabled: form.isEnabled,
      }
    },
    cancelDraft() {
      this.draft = null
      this.editingId = null
    },
    onNameInput() {
      if (!this.slugTouched) this.draft.slug = slugify(this.draft.name)
    },
    onFieldLabelInput(field) {
      if (!field.keyTouched) field.key = slugify(field.label, '_')
    },
    applyContactPreset() {
      if (!this.draft.name) {
        this.draft.name = 'Contact form'
        this.onNameInput()
      }
      this.draft.fields = [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        {
          key: 'subject',
          label: 'Subject',
          type: 'select',
          required: true,
          options: [
            { value: 'general', label: 'General question' },
            { value: 'support', label: 'Technical support' },
          ],
        },
        { key: 'message', label: 'Message', type: 'textarea', required: true },
      ].map(draftField)
      this.draft.fieldMapping = { email: 'email', name: 'name', subject: 'subject' }
    },
    addField() {
      this.draft.fields.push(draftField({ type: 'text', required: false }))
    },
    removeField(index) {
      const [removed] = this.draft.fields.splice(index, 1)
      for (const role of ['email', 'name', 'subject']) {
        if (this.draft.fieldMapping[role] === removed?.key) this.draft.fieldMapping[role] = ''
      }
    },
    moveField(index, delta) {
      const fields = this.draft.fields
      const target = index + delta
      if (target < 0 || target >= fields.length) return
      ;[fields[index], fields[target]] = [fields[target], fields[index]]
    },
    fieldsOfType(types) {
      return (this.draft?.fields || []).filter((field) => types.includes(field.type) && field.key)
    },
    async saveDraft() {
      this.showDraftErrors = true
      if (this.draftErrors.length > 0 || this.isSaving) return
      this.isSaving = true
      try {
        const url = this.isNewDraft ? this.formsUrl() : `${this.formsUrl()}/${this.editingId}`
        await $fetch(url, { method: this.isNewDraft ? 'POST' : 'PUT', body: this.draftPayload })
        toast.success(this.isNewDraft ? 'Form created' : 'Form saved')
        this.draft = null
        this.editingId = null
        await this.loadForms()
      } catch (err) {
        const issues = err?.data?.data?.error?.details || err?.data?.error?.details
        const first = Array.isArray(issues) && issues[0]?.message
        toast.error(first || err?.data?.data?.error?.message || err?.data?.error?.message || 'Failed to save form')
      } finally {
        this.isSaving = false
      }
    },
    async deleteForm() {
      if (!this.deletingForm) return
      this.isDeleting = true
      try {
        await $fetch(`${this.formsUrl()}/${this.deletingForm.id}`, { method: 'DELETE' })
        toast.success('Form deleted')
        this.deletingForm = null
        await this.loadForms()
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to delete form')
      } finally {
        this.isDeleting = false
      }
    },
    toggleUsage(formId) {
      this.usageFormId = this.usageFormId === formId ? null : formId
    },
    exampleFields(form) {
      const fields = {}
      for (const field of form.fields) {
        if (field.type === 'checkbox') fields[field.key] = true
        else if (field.type === 'email') fields[field.key] = 'customer@example.com'
        else if (field.type === 'select') fields[field.key] = field.options?.[0]?.value || ''
        else fields[field.key] = field.type === 'textarea' ? 'How can we help?' : field.label
      }
      return fields
    },
    origin() {
      return import.meta.client ? window.location.origin : ''
    },
    serverExample(form) {
      const body = JSON.stringify(
        { fields: this.exampleFields(form), metadata: { pageUrl: 'https://…', clientIp: '…', userAgent: '…' } },
        null,
        2
      )
      return [
        `curl -X POST ${this.origin()}/api/v1/forms/${form.slug}/submissions \\`,
        '  -H "Authorization: Bearer $VEERIFY_SERVER_KEY" \\',
        '  -H "Content-Type: application/json" \\',
        '  -H "Idempotency-Key: <unique per submission>" \\',
        `  -d '${body}'`,
      ].join('\n')
    },
    browserExample(form) {
      const body = JSON.stringify({ fields: this.exampleFields(form), [FORM_HONEYPOT_FIELD]: '' })
      return [
        `await fetch('${this.origin()}/api/public/forms/${form.publicId}/submissions', {`,
        "  method: 'POST',",
        "  headers: { 'Content-Type': 'application/json' },",
        `  body: JSON.stringify(${body}),`,
        '})',
        `// Add a hidden, empty input named "${FORM_HONEYPOT_FIELD}" to the form and send its value.`,
      ].join('\n')
    },
  },
}
</script>
