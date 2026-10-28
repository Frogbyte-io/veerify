<template>
  <!-- One persistent shell; only the tab body below it is swapped on navigation -->
  <PublicProjectShell :org-slug="orgSlug" :project-slug="projectSlug" :active="activeTab" :page-title="pageTitle">
    <template #default="{ projectData, paths, currentUser, mainAppUrl, authRedirectTarget, reloadProject }">
      <PublicRoadmap
        v-if="activeTab === 'roadmap'"
        :org-slug="orgSlug"
        :project-slug="projectSlug"
        :project-data="projectData"
        :paths="paths"
      />
      <PublicChangelog
        v-else-if="activeTab === 'changelog'"
        :org-slug="orgSlug"
        :project-slug="projectSlug"
        :entry-slug="entrySlug"
        :project-data="projectData"
        :paths="paths"
        @title="pageTitle = $event"
      />
      <PublicTestimonials v-else-if="activeTab === 'testimonials'" :org-slug="orgSlug" :project-slug="projectSlug" />
      <PublicFeedbackBoard
        v-else
        :key="productSlug || ''"
        :org-slug="orgSlug"
        :project-slug="projectSlug"
        :product-slug="productSlug"
        :project-data="projectData"
        :paths="paths"
        :current-user="currentUser"
        :main-app-url="mainAppUrl"
        :auth-redirect-target="authRedirectTarget"
        :reload-project="reloadProject"
        :feedback-ref="feedbackRef"
      />
    </template>
  </PublicProjectShell>
</template>

<script>
/**
 * A project's public site: the persistent PublicProjectShell plus the body of
 * the current tab. Mounted by `pages/[...slug].vue` (which also serves `/`)
 * so tab navigation never remounts the shell.
 */
export default {
  name: 'PublicProjectSite',
  props: {
    orgSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
    // 'feedback' | 'roadmap' | 'changelog' | 'testimonials'
    activeTab: { type: String, default: 'feedback' },
    productSlug: { type: String, default: null },
    entrySlug: { type: String, default: null },
    // `p/<post>` segment: a feedback item opened over the feedback tab
    feedbackRef: { type: String, default: null },
  },
  data() {
    return { pageTitle: '' }
  },
}
</script>
