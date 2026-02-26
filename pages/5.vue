<template>
  <div :class="['bento-page', darkMode ? 'dark-mode' : 'light-mode']">
    <div class="dot-bg"></div>

    <!-- Stagger animation wrapper -->
    <div class="bento-grid">

      <!-- === ROW 1: HEADER === -->
      <div class="bento-cell header-cell" :style="{ animationDelay: '0.05s' }">
        <div class="header-top">
          <div class="header-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="#7C9A82" opacity="0.15"/>
              <path d="M8 14L12 18L20 10" stroke="#7C9A82" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="header-brand">Veerify</span>
            <span class="header-dot">&middot;</span>
            <span class="header-subtitle">Public Feedback Board</span>
          </div>
          <span class="header-count">{{ filteredItems.length }} feedback items</span>
        </div>
        <p class="header-desc">Share your ideas, report issues, and vote on what matters most. Your feedback shapes the future of the product.</p>
      </div>

      <div class="bento-cell theme-cell" :style="{ animationDelay: '0.1s' }">
        <button class="theme-toggle" @click="toggleTheme" :aria-label="darkMode ? 'Switch to light mode' : 'Switch to dark mode'">
          <span class="theme-icon" :class="{ rotated: darkMode }">
            <svg v-if="!darkMode" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </span>
        </button>
        <span class="theme-label">{{ darkMode ? 'Dark' : 'Light' }}</span>
      </div>

      <!-- === ROW 2: STATS === -->
      <div class="bento-cell stat-cell stat-total" :style="{ animationDelay: '0.15s' }">
        <div class="stat-accent" style="background: #2D2D2D;"></div>
        <span class="stat-number">{{ feedbackItems.length }}</span>
        <span class="stat-label">Total</span>
      </div>
      <div class="bento-cell stat-cell stat-open" :style="{ animationDelay: '0.2s' }">
        <div class="stat-accent" style="background: #7C9A82;"></div>
        <span class="stat-number">{{ openCount }}</span>
        <span class="stat-label">Open</span>
      </div>
      <div class="bento-cell stat-cell stat-building" :style="{ animationDelay: '0.25s' }">
        <div class="stat-accent" style="background: #6366A0;"></div>
        <span class="stat-number">{{ buildingCount }}</span>
        <span class="stat-label">Building</span>
      </div>
      <div class="bento-cell stat-cell stat-shipped" :style="{ animationDelay: '0.3s' }">
        <div class="stat-accent" style="background: #C4745A;"></div>
        <span class="stat-number">{{ shippedCount }}</span>
        <span class="stat-label">Shipped</span>
      </div>

      <!-- === ROW 3: CONTROLS === -->
      <div class="bento-cell controls-cell" :style="{ animationDelay: '0.35s' }">
        <div class="filter-pills">
          <button
            v-for="f in statusFilters"
            :key="f.value"
            :class="['pill', { active: activeFilter === f.value }]"
            @click="activeFilter = f.value"
          >{{ f.label }}</button>
        </div>
        <div class="controls-right">
          <div class="category-dropdown" @click.stop="showCategoryDropdown = !showCategoryDropdown">
            <span>{{ selectedCategory === 'all' ? 'All Categories' : categoryLabel(selectedCategory) }}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            <div v-if="showCategoryDropdown" class="dropdown-menu">
              <button
                v-for="c in categoryOptions"
                :key="c.value"
                :class="['dropdown-item', { active: selectedCategory === c.value }]"
                @click.stop="selectedCategory = c.value; showCategoryDropdown = false"
              >{{ c.label }}</button>
            </div>
          </div>
          <button class="sort-btn" @click="toggleSort" :title="'Sort by votes: ' + (sortDesc ? 'descending' : 'ascending')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <polyline :points="sortDesc ? '19 12 12 19 5 12' : '5 12 12 5 19 12'"/>
            </svg>
          </button>
          <button class="new-feedback-btn" @click="showSubmitDialog = true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Feedback
          </button>
        </div>
      </div>

      <!-- === ROW 4+: FEEDBACK BENTO ITEMS === -->
      <div
        v-for="(item, idx) in filteredItems"
        :key="item.id"
        :class="['bento-cell', 'feedback-cell', { pinned: item.isPinned }]"
        :style="{ animationDelay: (0.4 + idx * 0.06) + 's' }"
        @click="openDetail(item)"
      >
        <div v-if="item.isPinned" class="pinned-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 2L20.58 6.58C21.37 7.37 21.37 8.63 20.58 9.42L14 16L8 22L7 17L2 16L8 10L14.58 3.42C15.37 2.63 16.63 2.63 17.42 3.42L16 2Z"/></svg>
          Pinned
        </div>
        <span class="fb-category" :style="{ color: item.categoryColor, background: item.categoryColor + '14' }">{{ formatCategory(item.category) }}</span>
        <h3 class="fb-title">{{ item.title }}</h3>
        <p class="fb-body">{{ item.body }}</p>
        <div class="fb-footer">
          <button :class="['vote-btn', { voted: item.voted }]" @click.stop="toggleVote(item)">
            <svg width="14" height="14" viewBox="0 0 24 24" :fill="item.voted ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            <span class="vote-count">{{ item.voteCount }}</span>
          </button>
          <span :class="['status-pill', 'status-' + item.status]">{{ formatStatus(item.status) }}</span>
          <span class="fb-comments">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {{ item.commentCount }}
          </span>
        </div>
        <div class="fb-meta">{{ item.authorName }} &middot; {{ item.createdAt }}</div>
      </div>

      <!-- === FOOTER === -->
      <div class="bento-cell footer-cell" :style="{ animationDelay: '1.2s' }">
        <span class="footer-deco">&#9678;</span>
        <span class="footer-text">Powered by <strong>Veerify</strong></span>
      </div>
    </div>

    <!-- === DETAIL MODAL === -->
    <Teleport to="body">
      <div v-if="selectedItem" class="modal-overlay" @click.self="closeDetail">
        <div :class="['modal-container', darkMode ? 'dark-mode' : 'light-mode']">
          <button class="modal-close" @click="closeDetail">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div class="modal-body">
            <div class="modal-main">
              <span class="fb-category" :style="{ color: selectedItem.categoryColor, background: selectedItem.categoryColor + '14' }">{{ formatCategory(selectedItem.category) }}</span>
              <h2 class="modal-title">{{ selectedItem.title }}</h2>
              <p class="modal-text">{{ selectedItem.body }}</p>

              <div class="modal-comments-section">
                <h4 class="comments-heading">Comments ({{ mockComments.length }})</h4>
                <div v-for="comment in mockComments" :key="comment.id" class="comment-card">
                  <div class="comment-header">
                    <span class="comment-author">{{ comment.authorName }}</span>
                    <span class="comment-date">{{ comment.createdAt }}</span>
                  </div>
                  <p class="comment-body">{{ comment.body }}</p>
                  <div v-if="comment.replies && comment.replies.length" class="comment-replies">
                    <div v-for="reply in comment.replies" :key="reply.id" class="comment-card reply">
                      <div class="comment-header">
                        <span class="comment-author">{{ reply.authorName }}</span>
                        <span class="comment-date">{{ reply.createdAt }}</span>
                      </div>
                      <p class="comment-body">{{ reply.body }}</p>
                    </div>
                  </div>
                </div>

                <div class="comment-input-wrap">
                  <textarea v-model="newComment" class="comment-input" placeholder="Add a comment..." rows="3"></textarea>
                  <button class="comment-submit" @click="submitComment" :disabled="!newComment.trim()">Post Comment</button>
                </div>
              </div>
            </div>
            <div class="modal-sidebar">
              <div class="sidebar-section">
                <span class="sidebar-label">Status</span>
                <span :class="['status-pill', 'status-' + selectedItem.status]">{{ formatStatus(selectedItem.status) }}</span>
              </div>
              <div class="sidebar-section">
                <span class="sidebar-label">Votes</span>
                <button :class="['vote-btn large', { voted: selectedItem.voted }]" @click="toggleVote(selectedItem)">
                  <svg width="16" height="16" viewBox="0 0 24 24" :fill="selectedItem.voted ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  <span class="vote-count">{{ selectedItem.voteCount }}</span>
                </button>
              </div>
              <div class="sidebar-section">
                <span class="sidebar-label">Author</span>
                <span class="sidebar-value">{{ selectedItem.authorName }}</span>
              </div>
              <div class="sidebar-section">
                <span class="sidebar-label">Posted</span>
                <span class="sidebar-value">{{ selectedItem.createdAt }}</span>
              </div>
              <div class="sidebar-section">
                <span class="sidebar-label">Category</span>
                <span class="fb-category" :style="{ color: selectedItem.categoryColor, background: selectedItem.categoryColor + '14' }">{{ formatCategory(selectedItem.category) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- === SUBMIT FEEDBACK DIALOG === -->
    <Teleport to="body">
      <div v-if="showSubmitDialog" class="modal-overlay" @click.self="showSubmitDialog = false">
        <div :class="['submit-container', darkMode ? 'dark-mode' : 'light-mode']">
          <button class="modal-close" @click="showSubmitDialog = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <h2 class="submit-heading">New Feedback</h2>
          <p class="submit-sub">Share your idea or report an issue</p>

          <div class="form-group floating">
            <input v-model="submitForm.title" type="text" id="fb-title" class="float-input" placeholder=" " />
            <label for="fb-title" class="float-label">Title</label>
          </div>

          <div class="form-group floating">
            <textarea v-model="submitForm.body" id="fb-body" class="float-input float-textarea" placeholder=" " rows="4"></textarea>
            <label for="fb-body" class="float-label">Description</label>
          </div>

          <div class="form-group">
            <label class="form-label-static">Category</label>
            <div class="pill-selector">
              <button
                v-for="cat in submitCategories"
                :key="cat.value"
                :class="['pill-option', { selected: submitForm.category === cat.value }]"
                :style="submitForm.category === cat.value ? { background: cat.color + '18', color: cat.color, borderColor: cat.color + '40' } : {}"
                @click="submitForm.category = cat.value"
              >{{ cat.label }}</button>
            </div>
          </div>

          <div class="form-group floating">
            <input v-model="submitForm.authorName" type="text" id="fb-author" class="float-input" placeholder=" " />
            <label for="fb-author" class="float-label">Your Name</label>
          </div>

          <button class="submit-btn" @click="submitFeedback" :disabled="!submitForm.title.trim() || !submitForm.body.trim()">Submit Feedback</button>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<script>
export default {
  name: 'PublicFeedbackBento',
  layout: false,

  data() {
    return {
      darkMode: false,
      activeFilter: 'all',
      selectedCategory: 'all',
      sortDesc: true,
      showCategoryDropdown: false,
      selectedItem: null,
      showSubmitDialog: false,
      newComment: '',

      submitForm: {
        title: '',
        body: '',
        category: 'feature_request',
        authorName: ''
      },

      statusFilters: [
        { label: 'All', value: 'all' },
        { label: 'Open', value: 'open' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Planned', value: 'planned' },
        { label: 'Completed', value: 'completed' }
      ],

      categoryOptions: [
        { label: 'All Categories', value: 'all' },
        { label: 'Feature Request', value: 'feature_request' },
        { label: 'Bug Report', value: 'bug_report' },
        { label: 'Improvement', value: 'improvement' }
      ],

      submitCategories: [
        { label: 'Feature Request', value: 'feature_request', color: '#6366A0' },
        { label: 'Bug Report', value: 'bug_report', color: '#C4745A' },
        { label: 'Improvement', value: 'improvement', color: '#7C9A82' }
      ],

      mockComments: [
        { id: 1, authorName: 'Emily Park', body: 'This would be amazing! I\'ve been waiting for this feature since I started using the platform.', createdAt: '1 day ago', replies: [
          { id: 2, authorName: 'Sarah Chen', body: 'Thanks for the support! We\'re actively working on this.', createdAt: '12 hours ago' }
        ]},
        { id: 3, authorName: 'Michael Brown', body: 'Would this also support system-level dark mode detection?', createdAt: '1 day ago', replies: [] },
        { id: 4, authorName: 'Rachel Green', body: '+1 on this. The light theme is really harsh on the eyes at night.', createdAt: '2 days ago', replies: [] }
      ],

      feedbackItems: [
        { id: 1, title: 'Add dark mode support for mobile app', body: 'The mobile app currently only supports light mode. Would love to see dark mode support to reduce eye strain during nighttime usage. This has been requested by many users in our community.', status: 'in_progress', category: 'feature_request', categoryColor: '#6366A0', tag: 'improvement', voteCount: 142, commentCount: 23, authorName: 'Sarah Chen', createdAt: '2 days ago', isPinned: true, voted: false },
        { id: 2, title: 'Login page crashes on Safari 17', body: 'When trying to log in using Safari 17 on macOS Sonoma, the page becomes unresponsive after entering credentials. Console shows a WebKit rendering error.', status: 'open', category: 'bug_report', categoryColor: '#C4745A', tag: 'bug_report', voteCount: 89, commentCount: 15, authorName: 'Marcus Johnson', createdAt: '5 hours ago', isPinned: false, voted: false },
        { id: 3, title: 'Implement webhook notifications', body: 'Would be great to have webhook support so we can integrate feedback events with our internal tools like Slack and Discord.', status: 'planned', category: 'feature_request', categoryColor: '#6366A0', tag: 'feature_request', voteCount: 76, commentCount: 8, authorName: 'Alex Rivera', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 4, title: 'Export feedback data to CSV', body: 'Need ability to export all feedback data including votes and comments to CSV format for reporting and analysis purposes.', status: 'completed', category: 'feature_request', categoryColor: '#6366A0', tag: 'feature_request', voteCount: 134, commentCount: 19, authorName: 'Priya Patel', createdAt: '1 week ago', isPinned: false, voted: false },
        { id: 5, title: 'Improve search performance', body: 'Search results take too long to load when there are more than 500 feedback items. The current implementation seems to be doing full-text search without proper indexing.', status: 'in_progress', category: 'improvement', categoryColor: '#7C9A82', tag: 'improvement', voteCount: 67, commentCount: 11, authorName: "James O'Connor", createdAt: '3 days ago', isPinned: false, voted: false },
        { id: 6, title: 'Add keyboard shortcuts', body: 'Power users would benefit from keyboard shortcuts for common actions like upvoting (U), navigating between items (J/K), and opening details (Enter).', status: 'open', category: 'feature_request', categoryColor: '#6366A0', tag: 'feature_request', voteCount: 45, commentCount: 6, authorName: 'Yuki Tanaka', createdAt: '4 days ago', isPinned: false, voted: false },
        { id: 7, title: 'Email notifications not delivered', body: 'Several users report not receiving email notifications for feedback updates. This affects both verification emails and status change notifications.', status: 'open', category: 'bug_report', categoryColor: '#C4745A', tag: 'bug_report', voteCount: 93, commentCount: 31, authorName: 'Emma Wilson', createdAt: '6 hours ago', isPinned: true, voted: false },
        { id: 8, title: 'Multi-language support', body: 'As our user base grows internationally, we need support for multiple languages. Starting with Spanish, French, German, and Japanese would cover most of our users.', status: 'planned', category: 'feature_request', categoryColor: '#6366A0', tag: 'feature_request', voteCount: 56, commentCount: 14, authorName: 'Carlos Mendez', createdAt: '5 days ago', isPinned: false, voted: false },
        { id: 9, title: 'Dashboard loading time too slow', body: 'The main dashboard takes over 5 seconds to load on average. Profiling shows excessive API calls on initial render that could be batched.', status: 'in_progress', category: 'bug_report', categoryColor: '#C4745A', tag: 'bug_report', voteCount: 78, commentCount: 9, authorName: 'Nina Kowalski', createdAt: '2 days ago', isPinned: false, voted: false },
        { id: 10, title: 'Add rich text editor for feedback', body: 'Currently feedback only supports plain text. A rich text editor with markdown support, code blocks, and image attachments would greatly improve feedback quality.', status: 'open', category: 'feature_request', categoryColor: '#6366A0', tag: 'feature_request', voteCount: 112, commentCount: 17, authorName: 'David Kim', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 11, title: 'Broken image uploads on Firefox', body: 'Image uploads fail silently on Firefox 121+. The upload appears to complete but the image never renders in the feedback post.', status: 'open', category: 'bug_report', categoryColor: '#C4745A', tag: 'bug_report', voteCount: 34, commentCount: 7, authorName: 'Lisa Zhang', createdAt: '8 hours ago', isPinned: false, voted: false },
        { id: 12, title: 'API rate limiting improvements', body: 'The current rate limiting is too aggressive for legitimate API users. Suggest implementing tiered rate limits based on authentication level and usage patterns.', status: 'completed', category: 'improvement', categoryColor: '#7C9A82', tag: 'improvement', voteCount: 41, commentCount: 5, authorName: 'Tom Anderson', createdAt: '2 weeks ago', isPinned: false, voted: false }
      ]
    }
  },

  computed: {
    openCount() {
      return this.feedbackItems.filter(function(i) { return i.status === 'open' }).length
    },
    buildingCount() {
      return this.feedbackItems.filter(function(i) { return i.status === 'in_progress' || i.status === 'planned' }).length
    },
    shippedCount() {
      return this.feedbackItems.filter(function(i) { return i.status === 'completed' }).length
    },
    filteredItems() {
      var self = this
      var items = this.feedbackItems.slice()

      if (self.activeFilter !== 'all') {
        items = items.filter(function(i) { return i.status === self.activeFilter })
      }
      if (self.selectedCategory !== 'all') {
        items = items.filter(function(i) { return i.category === self.selectedCategory })
      }

      // Pinned first
      var pinned = items.filter(function(i) { return i.isPinned })
      var rest = items.filter(function(i) { return !i.isPinned })

      rest.sort(function(a, b) {
        return self.sortDesc ? b.voteCount - a.voteCount : a.voteCount - b.voteCount
      })

      return pinned.concat(rest)
    }
  },

  methods: {
    toggleTheme() {
      this.darkMode = !this.darkMode
    },

    toggleSort() {
      this.sortDesc = !this.sortDesc
    },

    toggleVote(item) {
      if (item.voted) {
        item.voteCount--
        item.voted = false
      } else {
        item.voteCount++
        item.voted = true
      }
    },

    formatCategory(cat) {
      var map = { feature_request: 'Feature Request', bug_report: 'Bug Report', improvement: 'Improvement' }
      return map[cat] || cat
    },

    formatStatus(status) {
      var map = { open: 'Open', in_progress: 'In Progress', planned: 'Planned', completed: 'Completed' }
      return map[status] || status
    },

    categoryLabel(val) {
      var found = this.categoryOptions.find(function(c) { return c.value === val })
      return found ? found.label : val
    },

    openDetail(item) {
      this.selectedItem = item
    },

    closeDetail() {
      this.selectedItem = null
      this.newComment = ''
    },

    submitComment() {
      if (!this.newComment.trim()) return
      this.mockComments.push({
        id: Date.now(),
        authorName: 'You',
        body: this.newComment.trim(),
        createdAt: 'Just now',
        replies: []
      })
      this.newComment = ''
    },

    submitFeedback() {
      if (!this.submitForm.title.trim() || !this.submitForm.body.trim()) return
      var catColors = { feature_request: '#6366A0', bug_report: '#C4745A', improvement: '#7C9A82' }
      this.feedbackItems.unshift({
        id: Date.now(),
        title: this.submitForm.title.trim(),
        body: this.submitForm.body.trim(),
        status: 'open',
        category: this.submitForm.category,
        categoryColor: catColors[this.submitForm.category] || '#6366A0',
        tag: this.submitForm.category,
        voteCount: 0,
        commentCount: 0,
        authorName: this.submitForm.authorName.trim() || 'Anonymous',
        createdAt: 'Just now',
        isPinned: false,
        voted: false
      })
      this.submitForm = { title: '', body: '', category: 'feature_request', authorName: '' }
      this.showSubmitDialog = false
    },

    handleOutsideClick(e) {
      if (this.showCategoryDropdown) {
        this.showCategoryDropdown = false
      }
    }
  },

  mounted() {
    document.addEventListener('click', this.handleOutsideClick)
  },

  beforeUnmount() {
    document.removeEventListener('click', this.handleOutsideClick)
  }
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Noto+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');

/* === RESET & BASE === */
.bento-page {
  --bg: #F8F7F4;
  --bg-cell: #FFFFFF;
  --border: #E8E6E1;
  --text: #2D2D2D;
  --text-muted: #8A8680;
  --text-light: #B0ACA6;
  --sage: #7C9A82;
  --terracotta: #C4745A;
  --indigo: #6366A0;
  --accent-hover: #F2F1ED;
  --shadow: rgba(45, 45, 45, 0.04);
  --shadow-hover: rgba(45, 45, 45, 0.1);
  --dot-color: rgba(45, 45, 45, 0.06);
  --overlay: rgba(45, 45, 45, 0.3);
  --input-bg: #FFFFFF;
  --input-border: #E8E6E1;

  font-family: 'Noto Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
}

.bento-page.dark-mode {
  --bg: #1E1E1C;
  --bg-cell: #2A2A27;
  --border: #3A3A36;
  --text: #E8E6E1;
  --text-muted: #8A8680;
  --text-light: #5A5854;
  --accent-hover: #333330;
  --shadow: rgba(0, 0, 0, 0.15);
  --shadow-hover: rgba(0, 0, 0, 0.3);
  --dot-color: rgba(255, 255, 255, 0.03);
  --overlay: rgba(0, 0, 0, 0.5);
  --input-bg: #232320;
  --input-border: #3A3A36;
}

/* === DOT GRID BACKGROUND === */
.dot-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, var(--dot-color) 1px, transparent 1px);
  background-size: 24px 24px;
}

/* === BENTO GRID === */
.bento-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 24px 60px;
}

/* === BENTO CELL BASE === */
.bento-cell {
  background: var(--bg-cell);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 1px 3px var(--shadow), 0 8px 24px var(--shadow);
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  opacity: 0;
  animation: bentoFadeIn 0.6s ease-out forwards;
}

@keyframes bentoFadeIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* === HEADER CELL === */
.header-cell {
  grid-column: span 3;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-brand {
  font-family: 'Sora', sans-serif;
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.3px;
}

.header-dot {
  color: var(--text-light);
  font-size: 18px;
}

.header-subtitle {
  font-family: 'Sora', sans-serif;
  font-weight: 400;
  font-size: 15px;
  color: var(--text-muted);
}

.header-count {
  font-size: 13px;
  color: var(--text-muted);
  background: var(--accent-hover);
  padding: 4px 12px;
  border-radius: 20px;
  font-weight: 500;
}

.header-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
  max-width: 600px;
}

/* === THEME CELL === */
.theme-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.theme-toggle {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--accent-hover);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.theme-toggle:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px var(--shadow-hover);
}

.theme-icon {
  display: flex;
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.theme-icon.rotated {
  transform: rotate(360deg);
}

.theme-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* === STAT CELLS === */
.stat-cell {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px 24px;
}

.stat-cell:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 20px var(--shadow-hover);
}

.stat-accent {
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  border-radius: 0 3px 3px 0;
}

.stat-number {
  font-family: 'Sora', sans-serif;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -1px;
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
  font-weight: 500;
}

/* === CONTROLS CELL === */
.controls-cell {
  grid-column: span 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  flex-wrap: wrap;
}

.filter-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pill {
  font-family: 'Noto Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.25s ease;
}

.pill:hover {
  background: var(--accent-hover);
  color: var(--text);
}

.pill.active {
  background: var(--text);
  color: var(--bg);
  border-color: var(--text);
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.category-dropdown {
  position: relative;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
  user-select: none;
}

.category-dropdown:hover {
  border-color: var(--text-light);
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: var(--bg-cell);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 6px;
  min-width: 180px;
  box-shadow: 0 8px 32px var(--shadow-hover);
  z-index: 50;
}

.dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: 'Noto Sans', sans-serif;
}

.dropdown-item:hover,
.dropdown-item.active {
  background: var(--accent-hover);
  color: var(--text);
}

.sort-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.sort-btn:hover {
  background: var(--accent-hover);
  color: var(--text);
}

.new-feedback-btn {
  font-family: 'Sora', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 20px;
  border-radius: 12px;
  border: none;
  background: var(--text);
  color: var(--bg);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.new-feedback-btn:hover {
  transform: scale(1.04);
  box-shadow: 0 4px 16px var(--shadow-hover);
}

/* === FEEDBACK CELLS === */
.feedback-cell {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 22px;
}

.feedback-cell:hover {
  transform: scale(1.015);
  box-shadow: 0 4px 24px var(--shadow-hover);
}

.feedback-cell.pinned {
  grid-column: span 2;
}

.pinned-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--terracotta);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.fb-category {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 8px;
  letter-spacing: 0.2px;
  width: fit-content;
}

.fb-title {
  font-family: 'Sora', sans-serif;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.4;
  margin: 2px 0;
  letter-spacing: -0.2px;
}

.fb-body {
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fb-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-top: 8px;
}

.vote-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: 'Sora', sans-serif;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.vote-btn:hover {
  border-color: var(--sage);
  color: var(--sage);
}

.vote-btn.voted {
  color: var(--sage);
  border-color: var(--sage);
  background: rgba(124, 154, 130, 0.08);
}

.vote-btn.large {
  padding: 6px 14px;
  font-size: 15px;
}

.vote-count {
  transition: all 0.3s ease;
}

.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 8px;
  letter-spacing: 0.2px;
}

.status-open {
  color: var(--sage);
  background: rgba(124, 154, 130, 0.1);
}

.status-in_progress {
  color: var(--indigo);
  background: rgba(99, 102, 160, 0.1);
}

.status-planned {
  color: #B08D57;
  background: rgba(176, 141, 87, 0.1);
}

.status-completed {
  color: var(--terracotta);
  background: rgba(196, 116, 90, 0.1);
}

.fb-comments {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-light);
  margin-left: auto;
}

.fb-meta {
  font-size: 12px;
  color: var(--text-light);
  margin-top: 2px;
}

/* === FOOTER CELL === */
.footer-cell {
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 6px;
}

.footer-deco {
  font-size: 16px;
  color: var(--text-light);
  opacity: 0.5;
}

.footer-text {
  font-size: 12px;
  color: var(--text-light);
  letter-spacing: 0.3px;
}

.footer-text strong {
  font-weight: 600;
  color: var(--text-muted);
}

/* === MODAL OVERLAY === */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: overlayIn 0.25s ease;
}

.modal-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* === DETAIL MODAL === */
.modal-container {
  --bg: #F8F7F4;
  --bg-cell: #FFFFFF;
  --border: #E8E6E1;
  --text: #2D2D2D;
  --text-muted: #8A8680;
  --text-light: #B0ACA6;
  --accent-hover: #F2F1ED;
  --shadow: rgba(45, 45, 45, 0.04);
  --shadow-hover: rgba(45, 45, 45, 0.1);
  --input-bg: #FFFFFF;
  --input-border: #E8E6E1;

  position: relative;
  background: var(--bg-cell);
  border: 1px solid var(--border);
  border-radius: 24px;
  max-width: 820px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 24px 80px rgba(0,0,0,0.15);
  padding: 36px;
  animation: modalSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  color: var(--text);
}

.modal-container.dark-mode {
  --bg: #1E1E1C;
  --bg-cell: #2A2A27;
  --border: #3A3A36;
  --text: #E8E6E1;
  --text-muted: #8A8680;
  --text-light: #5A5854;
  --accent-hover: #333330;
  --shadow: rgba(0, 0, 0, 0.15);
  --shadow-hover: rgba(0, 0, 0, 0.3);
  --input-bg: #232320;
  --input-border: #3A3A36;
}

.submit-container {
  --bg: #F8F7F4;
  --bg-cell: #FFFFFF;
  --border: #E8E6E1;
  --text: #2D2D2D;
  --text-muted: #8A8680;
  --text-light: #B0ACA6;
  --accent-hover: #F2F1ED;
  --input-bg: #FFFFFF;
  --input-border: #E8E6E1;

  position: relative;
  background: var(--bg-cell);
  border: 1px solid var(--border);
  border-radius: 24px;
  max-width: 520px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 24px 80px rgba(0,0,0,0.15);
  padding: 36px;
  animation: modalSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  color: var(--text);
}

.submit-container.dark-mode {
  --bg: #1E1E1C;
  --bg-cell: #2A2A27;
  --border: #3A3A36;
  --text: #E8E6E1;
  --text-muted: #8A8680;
  --text-light: #5A5854;
  --accent-hover: #333330;
  --input-bg: #232320;
  --input-border: #3A3A36;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--accent-hover);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.modal-close:hover {
  color: var(--text);
  background: var(--border);
}

.modal-body {
  display: grid;
  grid-template-columns: 1fr 200px;
  gap: 32px;
}

.modal-title {
  font-family: 'Sora', sans-serif;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.35;
  margin: 10px 0 16px;
  letter-spacing: -0.3px;
}

.modal-text {
  font-size: 14.5px;
  color: var(--text-muted);
  line-height: 1.7;
  margin-bottom: 32px;
}

/* === MODAL SIDEBAR === */
.modal-sidebar {
  border-left: 1px solid var(--border);
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-light);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-value {
  font-size: 14px;
  color: var(--text);
  font-weight: 500;
}

/* === COMMENTS === */
.modal-comments-section {
  border-top: 1px solid var(--border);
  padding-top: 24px;
}

.comments-heading {
  font-family: 'Sora', sans-serif;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
}

.comment-card {
  border-left: 2px solid var(--border);
  padding: 12px 16px;
  margin-bottom: 12px;
  border-radius: 0 12px 12px 0;
  background: var(--accent-hover);
}

.comment-card.reply {
  margin-left: 20px;
  margin-top: 10px;
  border-left-color: var(--sage);
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.comment-author {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.comment-date {
  font-size: 11px;
  color: var(--text-light);
}

.comment-body {
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.55;
}

.comment-replies {
  margin-top: 8px;
}

.comment-input-wrap {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comment-input {
  font-family: 'Noto Sans', sans-serif;
  font-size: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text);
  resize: vertical;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.comment-input:focus {
  border-color: var(--sage);
  box-shadow: 0 0 0 3px rgba(124, 154, 130, 0.1);
}

.comment-submit {
  align-self: flex-end;
  font-family: 'Sora', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 20px;
  border-radius: 10px;
  border: none;
  background: var(--text);
  color: var(--bg-cell);
  cursor: pointer;
  transition: all 0.25s ease;
}

.comment-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.comment-submit:not(:disabled):hover {
  transform: scale(1.03);
}

/* === SUBMIT DIALOG === */
.submit-heading {
  font-family: 'Sora', sans-serif;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.3px;
}

.submit-sub {
  font-size: 14px;
  color: var(--text-muted);
  margin: 6px 0 28px;
}

/* === FLOATING LABELS === */
.form-group {
  margin-bottom: 20px;
}

.form-group.floating {
  position: relative;
}

.float-input {
  font-family: 'Noto Sans', sans-serif;
  font-size: 14px;
  padding: 18px 16px 8px;
  width: 100%;
  border-radius: 14px;
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  box-sizing: border-box;
}

.float-textarea {
  resize: vertical;
  min-height: 100px;
}

.float-input:focus {
  border-color: var(--sage);
  box-shadow: 0 0 0 3px rgba(124, 154, 130, 0.1);
}

.float-label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  color: var(--text-light);
  pointer-events: none;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  background: var(--input-bg);
  padding: 0 4px;
}

.float-textarea ~ .float-label {
  top: 18px;
  transform: translateY(0);
}

.float-input:focus ~ .float-label,
.float-input:not(:placeholder-shown) ~ .float-label {
  top: 4px;
  transform: translateY(0);
  font-size: 11px;
  color: var(--sage);
  font-weight: 500;
}

.float-textarea:focus ~ .float-label,
.float-textarea:not(:placeholder-shown) ~ .float-label {
  top: -2px;
  font-size: 11px;
  color: var(--sage);
  font-weight: 500;
}

.form-label-static {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.pill-selector {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pill-option {
  font-family: 'Noto Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pill-option:hover {
  background: var(--accent-hover);
}

.pill-option.selected {
  border-width: 1.5px;
}

.submit-btn {
  font-family: 'Sora', sans-serif;
  font-size: 14px;
  font-weight: 500;
  width: 100%;
  padding: 14px;
  border-radius: 14px;
  border: none;
  background: var(--text);
  color: var(--bg-cell);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  margin-top: 8px;
}

.submit-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.submit-btn:not(:disabled):hover {
  transform: scale(1.02);
  box-shadow: 0 8px 24px var(--shadow-hover);
}

/* === RESPONSIVE === */
@media (max-width: 900px) {
  .bento-grid {
    grid-template-columns: repeat(2, 1fr);
    padding: 24px 16px 48px;
    gap: 12px;
  }

  .header-cell {
    grid-column: span 2;
  }

  .controls-cell {
    grid-column: span 2;
    flex-direction: column;
    align-items: flex-start;
  }

  .feedback-cell.pinned {
    grid-column: span 2;
  }

  .footer-cell {
    grid-column: span 2;
  }

  .modal-body {
    grid-template-columns: 1fr;
  }

  .modal-sidebar {
    border-left: none;
    border-top: 1px solid var(--border);
    padding-left: 0;
    padding-top: 20px;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 16px;
  }
}

@media (max-width: 600px) {
  .bento-grid {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 16px 12px 40px;
  }

  .header-cell,
  .controls-cell,
  .feedback-cell.pinned,
  .footer-cell {
    grid-column: span 1;
  }

  .header-top {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .controls-right {
    flex-wrap: wrap;
  }

  .modal-container,
  .submit-container {
    padding: 24px 20px;
    border-radius: 18px;
    max-height: 90vh;
  }

  .modal-title {
    font-size: 18px;
  }
}

/* === SCROLLBAR === */
.modal-container::-webkit-scrollbar,
.submit-container::-webkit-scrollbar {
  width: 6px;
}

.modal-container::-webkit-scrollbar-track,
.submit-container::-webkit-scrollbar-track {
  background: transparent;
}

.modal-container::-webkit-scrollbar-thumb,
.submit-container::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

/* === GLOBAL RESETS FOR THIS PAGE === */
.bento-page *,
.bento-page *::before,
.bento-page *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.bento-page button {
  font-family: inherit;
}
</style>
