<template>
  <Card data-testid="visibility-prompts">
    <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
      <div>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>
          Questions a potential customer might ask an AI assistant. {{ activeCount }} of {{ maxActive }} active.
        </CardDescription>
      </div>
      <Button
        variant="outline"
        size="sm"
        class="gap-2"
        :disabled="suggesting || isLoading"
        data-testid="visibility-suggest"
        @click="suggest"
      >
        <Icon
          :name="suggesting ? 'lucide:loader-circle' : 'lucide:sparkles'"
          :class="['h-4 w-4', suggesting && 'animate-spin']"
        />
        Suggest prompts
      </Button>
    </CardHeader>

    <CardContent class="space-y-4">
      <div v-if="isLoading" class="space-y-2">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-10 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <template v-else>
        <form class="flex gap-2" @submit.prevent="add">
          <Input
            v-model="newText"
            placeholder="e.g. What is the best tool for collecting user feedback for a small SaaS?"
            maxlength="300"
            data-testid="visibility-prompt-input"
          />
          <Button type="submit" :disabled="saving || newText.trim().length < 10" data-testid="visibility-prompt-add"
            >Add</Button
          >
        </form>
        <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>

        <div v-if="suggestError" class="flex items-center gap-2 text-sm text-destructive">
          <span>{{ suggestError }}</span>
          <Button variant="outline" size="sm" @click="suggest">Retry</Button>
        </div>

        <div
          v-if="suggestions.length"
          class="space-y-2 rounded-md border border-dashed p-3"
          data-testid="visibility-suggestions"
        >
          <p class="text-sm font-medium">Suggestions</p>
          <div v-for="text in suggestions" :key="text" class="flex items-start justify-between gap-2 text-sm">
            <span>{{ text }}</span>
            <div class="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" :disabled="saving" @click="accept(text)">Add</Button>
              <Button size="sm" variant="ghost" aria-label="Dismiss suggestion" @click="dismiss(text)">
                <Icon name="lucide:x" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <p v-if="prompts.length === 0" class="text-sm text-muted-foreground">
          No prompts yet. Add one above or use Suggest prompts.
        </p>

        <ul v-else class="divide-y rounded-md border">
          <li
            v-for="prompt in prompts"
            :key="prompt.id"
            class="flex items-start gap-3 p-3"
            data-testid="visibility-prompt-row"
          >
            <Switch
              :model-value="prompt.active"
              :aria-label="prompt.active ? 'Pause prompt' : 'Activate prompt'"
              :disabled="saving"
              @update:model-value="(value) => toggle(prompt, value)"
            />
            <div class="min-w-0 flex-1">
              <div v-if="editingId === prompt.id" class="flex gap-2">
                <Input v-model="editText" maxlength="300" @keydown.enter.prevent="saveEdit(prompt)" />
                <Button size="sm" :disabled="saving || editText.trim().length < 10" @click="saveEdit(prompt)"
                  >Save</Button
                >
                <Button size="sm" variant="ghost" @click="editingId = null">Cancel</Button>
              </div>
              <p v-else :class="['text-sm', !prompt.active && 'text-muted-foreground']">{{ prompt.text }}</p>
            </div>
            <div v-if="editingId !== prompt.id" class="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" aria-label="Edit prompt" @click="startEdit(prompt)">
                <Icon name="lucide:pencil" class="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Delete prompt" :disabled="saving" @click="remove(prompt)">
                <Icon name="lucide:trash-2" class="h-4 w-4" />
              </Button>
            </div>
          </li>
        </ul>
      </template>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'
import { toast } from 'vue-sonner'

export default {
  name: 'VisibilityPrompts',

  props: {
    projectId: { type: String, required: true },
  },

  emits: ['changed'],

  data() {
    return {
      prompts: [],
      maxActive: 25,
      isLoading: true,
      error: null,
      saving: false,
      newText: '',
      formError: null,
      editingId: null,
      editText: '',
      suggestions: [],
      suggesting: false,
      suggestError: null,
    }
  },

  computed: {
    base() {
      return `/api/marketing/projects/${this.projectId}/visibility/prompts`
    },
    activeCount() {
      return this.prompts.filter((p) => p.active).length
    },
  },

  watch: {
    projectId: {
      immediate: true,
      handler() {
        this.suggestions = []
        this.load()
      },
    },
  },

  methods: {
    errorMessage(err, fallback) {
      return apiErrorMessage(err, fallback)
    },

    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(this.base)
        this.prompts = response.data.prompts
        this.maxActive = response.data.maxActive
      } catch (err) {
        this.error = this.errorMessage(err, 'Failed to load prompts')
      } finally {
        this.isLoading = false
      }
    },

    async create(text, source) {
      this.saving = true
      this.formError = null
      try {
        const response = await $fetch(this.base, {
          method: 'POST',
          body: { text, source, active: this.activeCount < this.maxActive },
        })
        this.prompts.push(response.data.prompt)
        this.$emit('changed')
        return true
      } catch (err) {
        this.formError = this.errorMessage(err, 'Failed to add prompt')
        return false
      } finally {
        this.saving = false
      }
    },

    async add() {
      if (await this.create(this.newText.trim(), 'user')) this.newText = ''
    },

    async accept(text) {
      if (await this.create(text, 'suggested')) this.dismiss(text)
    },

    dismiss(text) {
      this.suggestions = this.suggestions.filter((s) => s !== text)
    },

    async suggest() {
      this.suggesting = true
      this.suggestError = null
      try {
        const response = await $fetch(`${this.base}/suggest`, { method: 'POST' })
        this.suggestions = response.data.suggestions
        if (this.suggestions.length === 0) this.suggestError = 'No new suggestions this time'
      } catch (err) {
        this.suggestError = this.errorMessage(err, 'Failed to get suggestions')
      } finally {
        this.suggesting = false
      }
    },

    async toggle(prompt, active) {
      await this.update(prompt, { active })
    },

    startEdit(prompt) {
      this.editingId = prompt.id
      this.editText = prompt.text
    },

    async saveEdit(prompt) {
      if (await this.update(prompt, { text: this.editText.trim() })) this.editingId = null
    },

    async update(prompt, body) {
      this.saving = true
      try {
        const response = await $fetch(`${this.base}/${prompt.id}`, { method: 'PUT', body })
        Object.assign(prompt, response.data.prompt)
        this.$emit('changed')
        return true
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to update prompt'))
        return false
      } finally {
        this.saving = false
      }
    },

    async remove(prompt) {
      this.saving = true
      try {
        await $fetch(`${this.base}/${prompt.id}`, { method: 'DELETE' })
        this.prompts = this.prompts.filter((p) => p.id !== prompt.id)
        this.$emit('changed')
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to delete prompt'))
      } finally {
        this.saving = false
      }
    },
  },
}
</script>
