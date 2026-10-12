<template>
  <Card id="terms" class="scroll-mt-20" data-testid="marketing-settings-terms">
    <CardHeader>
      <CardTitle role="heading" aria-level="2">Brand and competitors</CardTitle>
      <CardDescription>
        Names Marketing looks for in AI answers and public posts. Veerify only records whether a competitor is named; it
        never crawls their site.
      </CardDescription>
    </CardHeader>

    <CardContent>
      <p v-if="!siteAdded" class="text-sm text-muted-foreground" data-testid="marketing-terms-needs-site">
        Add your site above first. Terms belong to the site.
      </p>

      <div v-else-if="isLoading" class="space-y-3">
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <div v-else-if="error" class="text-center py-4" data-testid="marketing-terms-error">
        <p class="text-sm text-destructive mb-2">{{ error }}</p>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div v-else class="space-y-6">
        <div v-for="group in groups" :key="group.kind" class="space-y-3" :data-testid="`marketing-terms-${group.kind}`">
          <div>
            <p class="text-sm font-medium">{{ group.title }}</p>
            <p class="text-xs text-muted-foreground">{{ group.hint }}</p>
          </div>

          <p v-if="termsOf(group.kind).length === 0" class="text-xs text-muted-foreground">None yet.</p>

          <ul v-else class="space-y-2">
            <li v-for="term in termsOf(group.kind)" :key="term.id" class="rounded-md border p-3">
              <form
                v-if="editingId === term.id"
                class="space-y-3"
                @submit.prevent="saveEdit(term)"
                @keydown.esc="cancelEdit"
              >
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label :for="`term-label-${term.id}`">Name</Label>
                    <Input :id="`term-label-${term.id}`" v-model="draft.label" class="mt-1" :disabled="saving" />
                  </div>
                  <div>
                    <Label :for="`term-aliases-${term.id}`">Aliases</Label>
                    <Input
                      :id="`term-aliases-${term.id}`"
                      v-model="draft.aliases"
                      placeholder="Comma separated"
                      class="mt-1"
                      :disabled="saving"
                    />
                  </div>
                  <div v-if="term.kind === 'competitor'">
                    <Label :for="`term-domain-${term.id}`">Domain (optional)</Label>
                    <Input
                      :id="`term-domain-${term.id}`"
                      v-model="draft.competitorDomain"
                      placeholder="rival.com"
                      class="mt-1"
                      :disabled="saving"
                    />
                  </div>
                </div>
                <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
                <div class="flex gap-2">
                  <Button type="submit" size="sm" :disabled="saving">Save</Button>
                  <Button type="button" size="sm" variant="ghost" :disabled="saving" @click="cancelEdit">Cancel</Button>
                </div>
              </form>

              <div v-else class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ term.label }}
                    <span v-if="term.competitorDomain" class="text-xs font-normal text-muted-foreground">
                      {{ term.competitorDomain }}
                    </span>
                  </p>
                  <div v-if="term.aliases.length" class="mt-1 flex flex-wrap gap-1">
                    <Badge v-for="alias in term.aliases" :key="alias" variant="secondary">{{ alias }}</Badge>
                  </div>
                </div>
                <div class="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    :aria-label="`Edit ${term.label}`"
                    :disabled="saving"
                    @click="startEdit(term)"
                  >
                    <Icon name="lucide:pencil" class="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    :aria-label="`Delete ${term.label}`"
                    :disabled="saving"
                    @click="remove(term)"
                  >
                    <Icon name="lucide:trash-2" class="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </li>
          </ul>

          <form
            v-if="adding === group.kind"
            class="space-y-3 rounded-md border border-dashed p-3"
            @submit.prevent="create(group.kind)"
            @keydown.esc="cancelAdd"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <Label :for="`new-label-${group.kind}`">Name</Label>
                <Input
                  :id="`new-label-${group.kind}`"
                  v-model="draft.label"
                  :placeholder="group.placeholder"
                  class="mt-1"
                  :disabled="saving"
                />
              </div>
              <div>
                <Label :for="`new-aliases-${group.kind}`">Aliases</Label>
                <Input
                  :id="`new-aliases-${group.kind}`"
                  v-model="draft.aliases"
                  placeholder="Comma separated"
                  class="mt-1"
                  :disabled="saving"
                />
              </div>
              <div v-if="group.kind === 'competitor'">
                <Label for="new-domain-competitor">Domain (optional)</Label>
                <Input
                  id="new-domain-competitor"
                  v-model="draft.competitorDomain"
                  placeholder="rival.com"
                  class="mt-1"
                  :disabled="saving"
                />
              </div>
            </div>
            <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
            <div class="flex gap-2">
              <Button type="submit" size="sm" :disabled="saving">
                <Icon v-if="saving" name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" />
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" :disabled="saving" @click="cancelAdd">Cancel</Button>
            </div>
          </form>
          <Button
            v-else
            size="sm"
            variant="outline"
            :disabled="terms.length >= limit || saving"
            :data-testid="`marketing-terms-add-${group.kind}`"
            @click="startAdd(group.kind)"
          >
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add {{ group.singular }}
          </Button>
        </div>

        <p class="text-xs text-muted-foreground">{{ terms.length }} of {{ limit }} terms used.</p>
      </div>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage, apiErrorDetails } from '~/lib/api-error'
import { toast } from 'vue-sonner'

const GROUPS = [
  {
    kind: 'brand',
    title: 'Your brand',
    singular: 'brand name',
    hint: 'Your product name and other ways people write it.',
    placeholder: 'Acme',
  },
  {
    kind: 'competitor',
    title: 'Competitors',
    singular: 'competitor',
    hint: 'Alternatives that may be named next to you.',
    placeholder: 'Rival',
  },
  {
    kind: 'keyword',
    title: 'Keywords',
    singular: 'keyword',
    hint: 'Problem phrases for finding opportunities, such as "looking for a feedback tool".',
    placeholder: 'feedback tool for startups',
  },
]

const emptyDraft = () => ({ label: '', aliases: '', competitorDomain: '' })

export default {
  name: 'MarketingSettingsTerms',

  props: {
    product: { type: Object, required: true },
    siteAdded: { type: Boolean, default: false },
  },

  emits: ['changed'],

  data() {
    return {
      groups: GROUPS,
      terms: [],
      limit: 50,
      isLoading: false,
      error: null,
      saving: false,
      adding: null,
      editingId: null,
      draft: emptyDraft(),
      formError: null,
    }
  },

  watch: {
    siteAdded: {
      immediate: true,
      handler(value) {
        if (value) this.load()
      },
    },
    'product.id'() {
      if (this.siteAdded) this.load()
    },
  },

  methods: {
    termsOf(kind) {
      return this.terms.filter((term) => term.kind === kind)
    },

    // `silent` refreshes in place (after create/edit/delete) without a skeleton flash
    async load(silent = false) {
      const productId = this.product.id
      if (!silent) this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(`/api/marketing/projects/${productId}/terms`)
        if (productId !== this.product.id) return
        this.terms = response?.data?.terms || []
        this.limit = response?.data?.limit || 50
      } catch (err) {
        if (productId !== this.product.id) return
        const message = apiErrorMessage(err, 'Failed to load terms')
        if (silent) toast.error(message)
        else this.error = message
      } finally {
        if (productId === this.product.id) this.isLoading = false
      }
    },

    parseAliases(raw) {
      return raw
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean)
    },

    startAdd(kind) {
      this.editingId = null
      this.adding = kind
      this.draft = emptyDraft()
      this.formError = null
    },

    cancelAdd() {
      this.adding = null
      this.formError = null
    },

    startEdit(term) {
      this.adding = null
      this.editingId = term.id
      this.draft = {
        label: term.label,
        aliases: term.aliases.join(', '),
        competitorDomain: term.competitorDomain || '',
      }
      this.formError = null
    },

    cancelEdit() {
      this.editingId = null
      this.formError = null
    },

    async create(kind) {
      this.saving = true
      this.formError = null
      try {
        const body = { kind, label: this.draft.label, aliases: this.parseAliases(this.draft.aliases) }
        if (kind === 'competitor' && this.draft.competitorDomain.trim()) {
          body.competitorDomain = this.draft.competitorDomain
        }
        await $fetch(`/api/marketing/projects/${this.product.id}/terms`, { method: 'POST', body })
        this.adding = null
        await this.load(true)
        this.$emit('changed')
      } catch (err) {
        this.formError = this.describe(err, 'Failed to add the term')
      } finally {
        this.saving = false
      }
    },

    async saveEdit(term) {
      this.saving = true
      this.formError = null
      try {
        const body = { label: this.draft.label, aliases: this.parseAliases(this.draft.aliases) }
        if (term.kind === 'competitor') body.competitorDomain = this.draft.competitorDomain.trim() || null
        await $fetch(`/api/marketing/projects/${this.product.id}/terms/${term.id}`, { method: 'PUT', body })
        this.editingId = null
        await this.load(true)
        this.$emit('changed')
      } catch (err) {
        this.formError = this.describe(err, 'Failed to save the term')
      } finally {
        this.saving = false
      }
    },

    async remove(term) {
      this.saving = true
      try {
        await $fetch(`/api/marketing/projects/${this.product.id}/terms/${term.id}`, { method: 'DELETE' })
        await this.load(true)
        this.$emit('changed')
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Failed to delete the term'))
      } finally {
        this.saving = false
      }
    },

    describe(err, fallback) {
      // Validation errors carry per-field issues; show the first readable one
      const issue = apiErrorDetails(err)?.[0]?.message
      return issue || apiErrorMessage(err, fallback)
    },
  },
}
</script>
