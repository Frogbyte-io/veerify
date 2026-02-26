<template>
  <div :class="['brutalist-page', { 'dark-mode': isDark }]">
    <!-- CHECKERED BACKGROUND -->
    <div class="checker-bg"></div>

    <!-- HEADER -->
    <header class="brutalist-header">
      <div class="header-inner">
        <div class="header-left">
          <div class="project-badge">VEERIFY</div>
          <h1 class="main-title">FEEDBACK BOARD</h1>
          <div class="desc-block">
            <p>Raw unfiltered feedback from real humans. No sugarcoating. No corporate speak. Just truth.</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="brutalist-btn theme-toggle" @click="toggleTheme">
            {{ isDark ? 'LIGHT' : 'DARK' }}
          </button>
          <button class="brutalist-btn new-post-btn" @click="showSubmitDialog = true">
            NEW POST +
          </button>
        </div>
      </div>
    </header>

    <!-- STATS -->
    <section class="stats-section">
      <div class="stats-grid">
        <div class="stat-box stat-total">
          <span class="stat-number">47</span>
          <span class="stat-label">TOTAL</span>
        </div>
        <div class="stat-box stat-open">
          <span class="stat-number">23</span>
          <span class="stat-label">OPEN</span>
        </div>
        <div class="stat-box stat-progress">
          <span class="stat-number">12</span>
          <span class="stat-label">IN PROGRESS</span>
        </div>
        <div class="stat-box stat-done">
          <span class="stat-number">8</span>
          <span class="stat-label">COMPLETED</span>
        </div>
      </div>
    </section>

    <!-- FILTERS -->
    <section class="filters-section">
      <div class="filters-inner">
        <div class="filter-group">
          <span class="filter-label">STATUS:</span>
          <div class="filter-buttons">
            <button
              v-for="s in statusFilters"
              :key="s.value"
              :class="['filter-btn', { active: activeStatus === s.value }]"
              @click="activeStatus = s.value"
            >{{ s.label }}</button>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">CATEGORY:</span>
          <div class="filter-buttons">
            <button
              v-for="c in categoryFilters"
              :key="c.value"
              :class="['filter-btn category-pill', { active: activeCategory === c.value }]"
              :style="activeCategory === c.value ? { background: c.color, borderColor: '#000' } : { borderColor: c.color }"
              @click="activeCategory = c.value"
            >{{ c.label }}</button>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">SORT:</span>
          <div class="filter-buttons">
            <button
              :class="['filter-btn sort-btn', { active: sortBy === 'votes' }]"
              @click="sortBy = 'votes'"
            >&#9650; VOTES</button>
            <button
              :class="['filter-btn sort-btn', { active: sortBy === 'newest' }]"
              @click="sortBy = 'newest'"
            >&#9679; NEWEST</button>
          </div>
        </div>
      </div>
    </section>

    <!-- FEEDBACK LIST -->
    <section class="feedback-section">
      <div class="feedback-list">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          :class="['feedback-card', `status-${item.status}`]"
          @click="openDetail(item)"
        >
          <!-- PINNED BANNER -->
          <div v-if="item.isPinned" class="pinned-banner">&#128204; PINNED</div>

          <!-- STATUS STRIPE -->
          <div class="status-stripe" :style="{ background: statusColor(item.status) }"></div>

          <!-- VOTE SECTION -->
          <div class="vote-section" @click.stop="toggleVote(item)">
            <button :class="['vote-btn', { voted: item.voted }]">
              <span class="vote-arrow">&#9650;</span>
              <span class="vote-count">{{ item.voteCount }}</span>
            </button>
          </div>

          <!-- CONTENT -->
          <div class="card-content">
            <div class="card-top">
              <h3 class="card-title">{{ item.title }}</h3>
              <span class="status-badge" :style="{ background: statusColor(item.status) }">{{ statusLabel(item.status) }}</span>
            </div>
            <div class="card-tags">
              <span class="category-badge" :style="{ background: item.categoryColor }">{{ formatCategory(item.category) }}</span>
              <span class="tag-badge">{{ formatCategory(item.tag) }}</span>
            </div>
            <p class="card-body">{{ item.body }}</p>
            <div class="card-footer">
              <span class="author-name">{{ item.authorName }}</span>
              <span class="footer-sep">//</span>
              <span class="card-date">{{ item.createdAt }}</span>
              <span class="footer-sep">//</span>
              <span class="comment-count">{{ item.commentCount }} comments</span>
            </div>
          </div>
        </div>

        <div v-if="filteredItems.length === 0" class="empty-state">
          <p>NO FEEDBACK MATCHES YOUR FILTERS.</p>
          <button class="brutalist-btn" @click="resetFilters">RESET FILTERS</button>
        </div>
      </div>
    </section>

    <!-- DETAIL MODAL -->
    <div v-if="selectedItem" class="modal-overlay" @click.self="selectedItem = null">
      <div class="modal-container detail-modal">
        <button class="modal-close" @click="selectedItem = null">&#10005;</button>
        <div class="detail-header">
          <div class="detail-vote" @click="toggleVote(selectedItem)">
            <button :class="['vote-btn large', { voted: selectedItem.voted }]">
              <span class="vote-arrow">&#9650;</span>
              <span class="vote-count">{{ selectedItem.voteCount }}</span>
            </button>
          </div>
          <div>
            <h2 class="detail-title">{{ selectedItem.title }}</h2>
            <div class="detail-meta">
              <span class="status-badge" :style="{ background: statusColor(selectedItem.status) }">{{ statusLabel(selectedItem.status) }}</span>
              <span class="category-badge" :style="{ background: selectedItem.categoryColor }">{{ formatCategory(selectedItem.category) }}</span>
              <span class="tag-badge">{{ formatCategory(selectedItem.tag) }}</span>
            </div>
          </div>
        </div>
        <div class="detail-body">
          <p>{{ selectedItem.body }}</p>
        </div>
        <div class="detail-info">
          <span class="author-name">{{ selectedItem.authorName }}</span>
          <span class="footer-sep">//</span>
          <span>{{ selectedItem.createdAt }}</span>
        </div>

        <!-- COMMENTS -->
        <div class="comments-section">
          <h3 class="comments-title">COMMENTS ({{ comments.length }})</h3>
          <div v-for="comment in comments" :key="comment.id" class="comment-card">
            <div class="comment-header">
              <span class="comment-author">{{ comment.authorName }}</span>
              <span class="comment-date">{{ comment.createdAt }}</span>
            </div>
            <p class="comment-body">{{ comment.body }}</p>
            <!-- REPLIES -->
            <div v-for="reply in comment.replies" :key="reply.id" class="reply-card">
              <div class="comment-header">
                <span class="comment-author">{{ reply.authorName }}</span>
                <span class="comment-date">{{ reply.createdAt }}</span>
              </div>
              <p class="comment-body">{{ reply.body }}</p>
            </div>
          </div>

          <!-- COMMENT INPUT -->
          <div class="comment-input-wrap">
            <textarea
              v-model="newComment"
              class="comment-input"
              placeholder="TYPE YOUR COMMENT..."
              rows="3"
            ></textarea>
            <button class="brutalist-btn submit-comment-btn" @click="addComment">POST COMMENT</button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUBMIT DIALOG -->
    <div v-if="showSubmitDialog" class="modal-overlay" @click.self="showSubmitDialog = false">
      <div class="modal-container submit-modal">
        <button class="modal-close" @click="showSubmitDialog = false">&#10005;</button>
        <h2 class="submit-title">NEW FEEDBACK</h2>
        <div class="submit-form">
          <div class="form-field">
            <label class="form-label">TITLE</label>
            <input v-model="submitForm.title" type="text" class="form-input" placeholder="WHAT'S ON YOUR MIND?" />
          </div>
          <div class="form-field">
            <label class="form-label label-rotated">CATEGORY</label>
            <select v-model="submitForm.category" class="form-input">
              <option value="feature_request">FEATURE REQUEST</option>
              <option value="bug_report">BUG REPORT</option>
              <option value="improvement">IMPROVEMENT</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">DETAILS</label>
            <textarea v-model="submitForm.body" class="form-input form-textarea" rows="5" placeholder="GIVE US THE FULL STORY..."></textarea>
          </div>
          <button class="brutalist-btn submit-btn" @click="submitFeedback">SUBMIT &#8594;</button>
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <footer class="brutalist-footer">
      <p>BUILT WITH <span class="footer-highlight">VEERIFY</span> // {{ currentYear }}</p>
    </footer>
  </div>
</template>

<script>
export default {
  name: 'BrutalistFeedbackBoard',
  layout: false,

  data() {
    return {
      isDark: false,
      activeStatus: 'all',
      activeCategory: 'all',
      sortBy: 'votes',
      selectedItem: null,
      showSubmitDialog: false,
      newComment: '',
      submitForm: {
        title: '',
        category: 'feature_request',
        body: ''
      },
      statusFilters: [
        { label: 'ALL', value: 'all' },
        { label: 'OPEN', value: 'open' },
        { label: 'IN PROGRESS', value: 'in_progress' },
        { label: 'PLANNED', value: 'planned' },
        { label: 'DONE', value: 'completed' }
      ],
      categoryFilters: [
        { label: 'ALL', value: 'all', color: '#000' },
        { label: 'FEATURE', value: 'feature_request', color: '#8B5CF6' },
        { label: 'BUG', value: 'bug_report', color: '#EF4444' },
        { label: 'IMPROVEMENT', value: 'improvement', color: '#F59E0B' }
      ],
      comments: [
        { id: 1, authorName: 'Emily Park', body: "This would be amazing! I've been waiting for this feature since I started using the platform.", createdAt: '1 day ago', replies: [
          { id: 2, authorName: 'Sarah Chen', body: "Thanks for the support! We're actively working on this.", createdAt: '12 hours ago' }
        ]},
        { id: 3, authorName: 'Michael Brown', body: 'Would this also support system-level dark mode detection?', createdAt: '1 day ago', replies: [] },
        { id: 4, authorName: 'Rachel Green', body: '+1 on this. The light theme is really harsh on the eyes at night.', createdAt: '2 days ago', replies: [] }
      ],
      feedbackItems: [
        { id: 1, title: 'Add dark mode support for mobile app', body: 'The mobile app currently only supports light mode. Would love to see dark mode support to reduce eye strain during nighttime usage. This has been requested by many users in our community.', status: 'in_progress', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'improvement', voteCount: 142, commentCount: 23, authorName: 'Sarah Chen', createdAt: '2 days ago', isPinned: true, voted: false },
        { id: 2, title: 'Login page crashes on Safari 17', body: 'When trying to log in using Safari 17 on macOS Sonoma, the page becomes unresponsive after entering credentials. Console shows a WebKit rendering error.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', tag: 'bug_report', voteCount: 89, commentCount: 15, authorName: 'Marcus Johnson', createdAt: '5 hours ago', isPinned: false, voted: false },
        { id: 3, title: 'Implement webhook notifications', body: 'Would be great to have webhook support so we can integrate feedback events with our internal tools like Slack and Discord.', status: 'planned', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 76, commentCount: 8, authorName: 'Alex Rivera', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 4, title: 'Export feedback data to CSV', body: 'Need ability to export all feedback data including votes and comments to CSV format for reporting and analysis purposes.', status: 'completed', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 134, commentCount: 19, authorName: 'Priya Patel', createdAt: '1 week ago', isPinned: false, voted: false },
        { id: 5, title: 'Improve search performance', body: "Search results take too long to load when there are more than 500 feedback items. The current implementation seems to be doing full-text search without proper indexing.", status: 'in_progress', category: 'improvement', categoryColor: '#F59E0B', tag: 'improvement', voteCount: 67, commentCount: 11, authorName: "James O'Connor", createdAt: '3 days ago', isPinned: false, voted: false },
        { id: 6, title: 'Add keyboard shortcuts', body: 'Power users would benefit from keyboard shortcuts for common actions like upvoting (U), navigating between items (J/K), and opening details (Enter).', status: 'open', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 45, commentCount: 6, authorName: 'Yuki Tanaka', createdAt: '4 days ago', isPinned: false, voted: false },
        { id: 7, title: 'Email notifications not delivered', body: 'Several users report not receiving email notifications for feedback updates. This affects both verification emails and status change notifications.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', tag: 'bug_report', voteCount: 93, commentCount: 31, authorName: 'Emma Wilson', createdAt: '6 hours ago', isPinned: true, voted: false },
        { id: 8, title: 'Multi-language support', body: 'As our user base grows internationally, we need support for multiple languages. Starting with Spanish, French, German, and Japanese would cover most of our users.', status: 'planned', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 56, commentCount: 14, authorName: 'Carlos Mendez', createdAt: '5 days ago', isPinned: false, voted: false },
        { id: 9, title: 'Dashboard loading time too slow', body: 'The main dashboard takes over 5 seconds to load on average. Profiling shows excessive API calls on initial render that could be batched.', status: 'in_progress', category: 'bug_report', categoryColor: '#EF4444', tag: 'bug_report', voteCount: 78, commentCount: 9, authorName: 'Nina Kowalski', createdAt: '2 days ago', isPinned: false, voted: false },
        { id: 10, title: 'Add rich text editor for feedback', body: 'Currently feedback only supports plain text. A rich text editor with markdown support, code blocks, and image attachments would greatly improve feedback quality.', status: 'open', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 112, commentCount: 17, authorName: 'David Kim', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 11, title: 'Broken image uploads on Firefox', body: 'Image uploads fail silently on Firefox 121+. The upload appears to complete but the image never renders in the feedback post.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', tag: 'bug_report', voteCount: 34, commentCount: 7, authorName: 'Lisa Zhang', createdAt: '8 hours ago', isPinned: false, voted: false },
        { id: 12, title: 'API rate limiting improvements', body: 'The current rate limiting is too aggressive for legitimate API users. Suggest implementing tiered rate limits based on authentication level and usage patterns.', status: 'completed', category: 'improvement', categoryColor: '#F59E0B', tag: 'improvement', voteCount: 41, commentCount: 5, authorName: 'Tom Anderson', createdAt: '2 weeks ago', isPinned: false, voted: false }
      ]
    }
  },

  computed: {
    currentYear() {
      return new Date().getFullYear()
    },
    filteredItems() {
      var items = this.feedbackItems.slice()

      if (this.activeStatus !== 'all') {
        items = items.filter(function (i) { return i.status === this.activeStatus }.bind(this))
      }

      if (this.activeCategory !== 'all') {
        items = items.filter(function (i) { return i.category === this.activeCategory }.bind(this))
      }

      // Pinned items first
      var pinned = items.filter(function (i) { return i.isPinned })
      var unpinned = items.filter(function (i) { return !i.isPinned })

      if (this.sortBy === 'votes') {
        unpinned.sort(function (a, b) { return b.voteCount - a.voteCount })
      } else {
        unpinned.sort(function (a, b) { return a.id - b.id }).reverse()
      }

      return pinned.concat(unpinned)
    }
  },

  methods: {
    toggleTheme() {
      this.isDark = !this.isDark
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
    openDetail(item) {
      this.selectedItem = item
    },
    statusColor(status) {
      var colors = {
        open: '#0066FF',
        in_progress: '#FFE500',
        planned: '#FF3366',
        completed: '#00CC66'
      }
      return colors[status] || '#999'
    },
    statusLabel(status) {
      var labels = {
        open: 'OPEN',
        in_progress: 'IN PROGRESS',
        planned: 'PLANNED',
        completed: 'COMPLETED'
      }
      return labels[status] || status.toUpperCase()
    },
    formatCategory(cat) {
      return cat.replace(/_/g, ' ').toUpperCase()
    },
    resetFilters() {
      this.activeStatus = 'all'
      this.activeCategory = 'all'
    },
    addComment() {
      if (!this.newComment.trim()) return
      this.comments.push({
        id: Date.now(),
        authorName: 'Anonymous',
        body: this.newComment,
        createdAt: 'Just now',
        replies: []
      })
      this.newComment = ''
    },
    submitFeedback() {
      if (!this.submitForm.title.trim() || !this.submitForm.body.trim()) return
      var categoryColors = {
        feature_request: '#8B5CF6',
        bug_report: '#EF4444',
        improvement: '#F59E0B'
      }
      this.feedbackItems.unshift({
        id: Date.now(),
        title: this.submitForm.title,
        body: this.submitForm.body,
        status: 'open',
        category: this.submitForm.category,
        categoryColor: categoryColors[this.submitForm.category] || '#8B5CF6',
        tag: this.submitForm.category,
        voteCount: 0,
        commentCount: 0,
        authorName: 'Anonymous',
        createdAt: 'Just now',
        isPinned: false,
        voted: false
      })
      this.submitForm = { title: '', category: 'feature_request', body: '' }
      this.showSubmitDialog = false
    }
  }
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&family=Work+Sans:wght@400;500;600;700;800;900&display=swap');

/* ============================================
   BRUTALIST / NEO-BRUTALIST FEEDBACK BOARD
   ============================================ */

:root {
  --brutal-black: #000000;
  --brutal-white: #FFFFFF;
  --brutal-yellow: #FFE500;
  --brutal-pink: #FF3366;
  --brutal-blue: #0066FF;
  --brutal-green: #00CC66;
  --brutal-bg: #F5F5F0;
  --brutal-card-bg: #FFFFFF;
  --brutal-text: #000000;
  --brutal-border: 3px solid #000000;
  --brutal-shadow: 5px 5px 0px #000000;
  --brutal-shadow-sm: 3px 3px 0px #000000;
  --brutal-radius: 0px;
  --checker-color: #E8E8E0;
}

.brutalist-page.dark-mode {
  --brutal-bg: #0A0A0A;
  --brutal-card-bg: #1A1A1A;
  --brutal-text: #F5F5F0;
  --brutal-border: 3px solid #F5F5F0;
  --brutal-shadow: 5px 5px 0px #F5F5F0;
  --brutal-shadow-sm: 3px 3px 0px #F5F5F0;
  --checker-color: #151515;
}

/* BASE RESET FOR THIS PAGE */
.brutalist-page {
  min-height: 100vh;
  background: var(--brutal-bg);
  color: var(--brutal-text);
  font-family: 'Work Sans', sans-serif;
  font-weight: 500;
  position: relative;
  cursor: crosshair;
  overflow-x: hidden;
}

.brutalist-page *,
.brutalist-page *::before,
.brutalist-page *::after {
  box-sizing: border-box;
}

/* CHECKERED BACKGROUND */
.checker-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(45deg, var(--checker-color) 25%, transparent 25%),
    linear-gradient(-45deg, var(--checker-color) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--checker-color) 75%),
    linear-gradient(-45deg, transparent 75%, var(--checker-color) 75%);
  background-size: 40px 40px;
  background-position: 0 0, 0 20px, 20px -20px, -20px 0px;
  opacity: 0.3;
}

.brutalist-page > *:not(.checker-bg) {
  position: relative;
  z-index: 1;
}

/* ============================================
   HEADER
   ============================================ */
.brutalist-header {
  border-bottom: var(--brutal-border);
  padding: 32px 24px;
  background: var(--brutal-bg);
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 24px;
}

.header-left {
  flex: 1;
  min-width: 280px;
}

.project-badge {
  display: inline-block;
  font-family: 'Archivo Black', sans-serif;
  font-size: 14px;
  letter-spacing: 3px;
  padding: 8px 20px;
  background: var(--brutal-yellow);
  color: #000;
  border: var(--brutal-border);
  box-shadow: var(--brutal-shadow-sm);
  margin-bottom: 16px;
  text-transform: uppercase;
}

.dark-mode .project-badge {
  border-color: #000;
  box-shadow: 3px 3px 0px #000;
}

.main-title {
  font-family: 'Archivo Black', sans-serif;
  font-size: clamp(48px, 8vw, 96px);
  line-height: 0.95;
  letter-spacing: -2px;
  transform: rotate(-2deg);
  margin: 0 0 20px -4px;
  color: var(--brutal-text);
}

.desc-block {
  border: var(--brutal-border);
  padding: 12px 16px;
  max-width: 500px;
  background: var(--brutal-card-bg);
  box-shadow: var(--brutal-shadow-sm);
}

.desc-block p {
  margin: 0;
  font-family: 'Space Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.header-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
}

/* BUTTONS */
.brutalist-btn {
  font-family: 'Archivo Black', sans-serif;
  font-size: 16px;
  letter-spacing: 1px;
  padding: 14px 28px;
  border: var(--brutal-border);
  background: var(--brutal-card-bg);
  color: var(--brutal-text);
  cursor: crosshair;
  box-shadow: var(--brutal-shadow);
  transition: transform 0.15s, box-shadow 0.15s;
  text-transform: uppercase;
  white-space: nowrap;
}

.brutalist-btn:hover {
  transform: translate(2px, 2px);
  box-shadow: 3px 3px 0px var(--brutal-text);
}

.brutalist-btn:active {
  transform: translate(5px, 5px);
  box-shadow: 0px 0px 0px var(--brutal-text);
}

.theme-toggle {
  background: var(--brutal-text);
  color: var(--brutal-bg);
  min-width: 120px;
}

.dark-mode .theme-toggle {
  border-color: #F5F5F0;
}

.new-post-btn {
  background: var(--brutal-pink);
  color: #fff;
  box-shadow: 5px 5px 0px var(--brutal-black);
}

.dark-mode .new-post-btn {
  box-shadow: 5px 5px 0px #F5F5F0;
}

.new-post-btn:hover {
  box-shadow: 3px 3px 0px var(--brutal-black);
}

/* ============================================
   STATS
   ============================================ */
.stats-section {
  padding: 32px 24px;
  border-bottom: var(--brutal-border);
}

.stats-grid {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-box {
  border: var(--brutal-border);
  padding: 24px;
  text-align: center;
  box-shadow: var(--brutal-shadow);
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-box:hover {
  transform: translate(2px, 2px) rotate(-1deg);
  box-shadow: 3px 3px 0px var(--brutal-text);
}

.stat-total { background: var(--brutal-yellow); color: #000; }
.stat-open { background: var(--brutal-blue); color: #fff; }
.stat-progress { background: var(--brutal-pink); color: #fff; }
.stat-done { background: var(--brutal-green); color: #000; }

.dark-mode .stat-total,
.dark-mode .stat-open,
.dark-mode .stat-progress,
.dark-mode .stat-done {
  border-color: #000;
  box-shadow: 5px 5px 0px #000;
}

.dark-mode .stat-box:hover {
  box-shadow: 3px 3px 0px #000;
}

.stat-number {
  display: block;
  font-family: 'Archivo Black', sans-serif;
  font-size: 56px;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-label {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  letter-spacing: 3px;
  text-transform: uppercase;
  font-weight: 700;
}

/* ============================================
   FILTERS
   ============================================ */
.filters-section {
  padding: 24px;
  border-bottom: var(--brutal-border);
  background: var(--brutal-bg);
}

.filters-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: center;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-label {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-right: 4px;
}

.filter-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-btn {
  font-family: 'Space Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 8px 14px;
  border: 3px solid var(--brutal-text);
  background: var(--brutal-card-bg);
  color: var(--brutal-text);
  cursor: crosshair;
  transition: all 0.1s;
  text-transform: uppercase;
}

.filter-btn:hover {
  background: var(--brutal-text);
  color: var(--brutal-bg);
}

.filter-btn.active {
  background: var(--brutal-text);
  color: var(--brutal-bg);
  box-shadow: var(--brutal-shadow-sm);
}

.category-pill.active {
  color: #fff !important;
}

/* ============================================
   FEEDBACK LIST
   ============================================ */
.feedback-section {
  padding: 32px 24px;
}

.feedback-list {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.feedback-card {
  display: flex;
  border: var(--brutal-border);
  background: var(--brutal-card-bg);
  box-shadow: var(--brutal-shadow);
  position: relative;
  cursor: crosshair;
  transition: transform 0.15s, box-shadow 0.15s;
  overflow: hidden;
}

.feedback-card:hover {
  transform: translate(3px, 3px);
  box-shadow: 2px 2px 0px var(--brutal-text);
}

/* PINNED BANNER */
.pinned-banner {
  position: absolute;
  top: 12px;
  right: -32px;
  background: var(--brutal-yellow);
  color: #000;
  font-family: 'Space Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 4px 40px;
  transform: rotate(35deg);
  border: 2px solid #000;
  z-index: 2;
  white-space: nowrap;
}

/* STATUS STRIPE */
.status-stripe {
  width: 8px;
  min-height: 100%;
  flex-shrink: 0;
}

/* VOTE SECTION */
.vote-section {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 16px;
  border-right: var(--brutal-border);
  flex-shrink: 0;
}

.vote-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  border: var(--brutal-border);
  background: var(--brutal-card-bg);
  color: var(--brutal-text);
  cursor: crosshair;
  box-shadow: var(--brutal-shadow-sm);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
  min-width: 60px;
}

.vote-btn:hover {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0px var(--brutal-text);
}

.vote-btn.voted {
  background: var(--brutal-blue);
  color: #fff;
  border-color: #000;
  box-shadow: 3px 3px 0px #000;
}

.vote-btn.large {
  padding: 16px 24px;
  min-width: 80px;
}

.vote-arrow {
  font-size: 18px;
  line-height: 1;
}

.vote-count {
  font-family: 'Archivo Black', sans-serif;
  font-size: 22px;
  line-height: 1;
}

.vote-btn.large .vote-count {
  font-size: 30px;
}

/* CARD CONTENT */
.card-content {
  flex: 1;
  padding: 20px 24px;
  min-width: 0;
}

.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.card-title {
  font-family: 'Archivo Black', sans-serif;
  font-size: 18px;
  line-height: 1.3;
  margin: 0;
  flex: 1;
  min-width: 200px;
}

.status-badge {
  font-family: 'Space Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 5px 12px;
  border: 2px solid #000;
  color: #000;
  box-shadow: 2px 2px 0px #000;
  white-space: nowrap;
  flex-shrink: 0;
}

.card-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.category-badge {
  font-family: 'Space Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 4px 10px;
  color: #fff;
  border: 2px solid #000;
  text-transform: uppercase;
}

.tag-badge {
  font-family: 'Space Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 4px 10px;
  background: var(--brutal-bg);
  color: var(--brutal-text);
  border: 2px solid var(--brutal-text);
  text-transform: uppercase;
}

.card-body {
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  opacity: 0.85;
}

.card-footer {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  opacity: 0.7;
}

.author-name {
  font-weight: 700;
}

.footer-sep {
  opacity: 0.4;
}

/* EMPTY STATE */
.empty-state {
  text-align: center;
  padding: 60px 24px;
  border: var(--brutal-border);
  border-style: dashed;
  background: var(--brutal-card-bg);
}

.empty-state p {
  font-family: 'Archivo Black', sans-serif;
  font-size: 24px;
  margin: 0 0 24px;
}

/* ============================================
   MODALS
   ============================================ */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-image:
    linear-gradient(45deg, rgba(0,0,0,0.1) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(0,0,0,0.1) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.1) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.1) 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  background-color: rgba(0, 0, 0, 0.6);
  overflow-y: auto;
}

.dark-mode .modal-overlay {
  background-color: rgba(0, 0, 0, 0.8);
}

.modal-container {
  background: var(--brutal-card-bg);
  border: 4px solid var(--brutal-text);
  box-shadow: 8px 8px 0px var(--brutal-text);
  max-width: 720px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding: 36px;
  position: relative;
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 44px;
  height: 44px;
  border: var(--brutal-border);
  border-radius: 50%;
  background: var(--brutal-pink);
  color: #fff;
  font-size: 20px;
  font-weight: 900;
  cursor: crosshair;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--brutal-shadow-sm);
  transition: transform 0.15s, box-shadow 0.15s;
  line-height: 1;
}

.modal-close:hover {
  transform: translate(2px, 2px) rotate(90deg);
  box-shadow: 1px 1px 0px var(--brutal-text);
}

/* DETAIL MODAL */
.detail-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-right: 48px;
}

.detail-title {
  font-family: 'Archivo Black', sans-serif;
  font-size: 28px;
  line-height: 1.2;
  margin: 0 0 12px;
}

.detail-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-body {
  border: var(--brutal-border);
  padding: 20px;
  margin-bottom: 20px;
  background: var(--brutal-bg);
}

.detail-body p {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
}

.detail-info {
  font-family: 'Space Mono', monospace;
  font-size: 12px;
  margin-bottom: 28px;
  display: flex;
  gap: 8px;
  align-items: center;
}

/* COMMENTS */
.comments-section {
  border-top: var(--brutal-border);
  padding-top: 24px;
}

.comments-title {
  font-family: 'Archivo Black', sans-serif;
  font-size: 18px;
  margin: 0 0 16px;
  letter-spacing: 2px;
}

.comment-card {
  border: var(--brutal-border);
  padding: 16px;
  margin-bottom: 12px;
  background: var(--brutal-bg);
  box-shadow: var(--brutal-shadow-sm);
}

.comment-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-family: 'Space Mono', monospace;
  font-size: 11px;
}

.comment-author {
  font-weight: 700;
}

.comment-date {
  opacity: 0.6;
}

.comment-body {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.reply-card {
  margin-top: 12px;
  margin-left: 20px;
  border: 2px solid var(--brutal-text);
  padding: 12px;
  background: var(--brutal-card-bg);
  position: relative;
}

.reply-card::before {
  content: '';
  position: absolute;
  left: -20px;
  top: 16px;
  width: 16px;
  height: 2px;
  background: var(--brutal-text);
}

.comment-input-wrap {
  margin-top: 20px;
}

.comment-input {
  width: 100%;
  border: var(--brutal-border);
  padding: 14px;
  font-family: 'Space Mono', monospace;
  font-size: 13px;
  background: var(--brutal-card-bg);
  color: var(--brutal-text);
  resize: vertical;
  box-shadow: var(--brutal-shadow-sm);
  margin-bottom: 12px;
}

.comment-input:focus {
  outline: none;
  box-shadow: 6px 6px 0px var(--brutal-blue);
}

.submit-comment-btn {
  font-size: 13px;
  padding: 10px 20px;
  background: var(--brutal-blue);
  color: #fff;
  border-color: #000;
  box-shadow: 3px 3px 0px #000;
}

/* SUBMIT MODAL */
.submit-title {
  font-family: 'Archivo Black', sans-serif;
  font-size: 36px;
  margin: 0 0 28px;
  transform: rotate(-1deg);
  padding-right: 48px;
}

.submit-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-field {
  position: relative;
}

.form-label {
  display: block;
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 8px;
  background: var(--brutal-yellow);
  color: #000;
  display: inline-block;
  padding: 4px 10px;
  border: 2px solid #000;
}

.form-label.label-rotated {
  transform: rotate(-2deg);
}

.form-input {
  width: 100%;
  border: var(--brutal-border);
  padding: 14px;
  font-family: 'Work Sans', sans-serif;
  font-size: 15px;
  font-weight: 600;
  background: var(--brutal-card-bg);
  color: var(--brutal-text);
  box-shadow: var(--brutal-shadow-sm);
  transition: box-shadow 0.15s;
}

.form-input:focus {
  outline: none;
  box-shadow: 6px 6px 0px var(--brutal-pink);
}

.form-textarea {
  resize: vertical;
  font-family: 'Space Mono', monospace;
  font-size: 13px;
  font-weight: 400;
}

select.form-input {
  cursor: crosshair;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='square'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 44px;
}

.submit-btn {
  font-size: 20px;
  padding: 18px 36px;
  background: var(--brutal-pink);
  color: #fff;
  border-color: #000;
  box-shadow: 6px 6px 0px #000;
  align-self: flex-start;
  transition: transform 0.15s, box-shadow 0.15s, letter-spacing 0.15s;
}

.submit-btn:hover {
  transform: translate(3px, 3px);
  box-shadow: 3px 3px 0px #000;
  letter-spacing: 4px;
}

/* ============================================
   FOOTER
   ============================================ */
.brutalist-footer {
  border-top: 4px solid var(--brutal-text);
  padding: 32px 24px;
  text-align: center;
  margin-top: 40px;
}

.brutalist-footer p {
  font-family: 'Space Mono', monospace;
  font-size: 13px;
  letter-spacing: 3px;
  margin: 0;
}

.footer-highlight {
  background: var(--brutal-yellow);
  color: #000;
  padding: 2px 8px;
  border: 2px solid #000;
  font-weight: 700;
}

/* ============================================
   RESPONSIVE
   ============================================ */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .stat-number {
    font-size: 40px;
  }

  .main-title {
    font-size: 42px;
  }

  .header-inner {
    flex-direction: column;
  }

  .header-actions {
    flex-direction: row;
    align-items: stretch;
    width: 100%;
  }

  .header-actions .brutalist-btn {
    flex: 1;
    text-align: center;
  }

  .feedback-card {
    flex-direction: column;
  }

  .status-stripe {
    width: 100%;
    min-height: 6px;
    height: 6px;
  }

  .vote-section {
    border-right: none;
    border-bottom: var(--brutal-border);
    padding: 12px 16px;
  }

  .vote-btn {
    flex-direction: row;
    gap: 8px;
    width: 100%;
    justify-content: center;
  }

  .card-content {
    padding: 16px;
  }

  .detail-header {
    flex-direction: column;
  }

  .detail-title {
    font-size: 22px;
  }

  .modal-container {
    padding: 24px;
    margin: 12px;
  }

  .filters-inner {
    flex-direction: column;
    align-items: flex-start;
  }

  .submit-title {
    font-size: 28px;
  }
}

@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .stat-box {
    padding: 16px;
  }

  .stat-number {
    font-size: 32px;
  }

  .main-title {
    font-size: 32px;
  }

  .brutalist-header {
    padding: 20px 16px;
  }

  .feedback-section {
    padding: 20px 16px;
  }

  .filters-section {
    padding: 16px;
  }

  .card-title {
    font-size: 15px;
  }
}

/* ============================================
   SCROLLBAR (BRUTALIST)
   ============================================ */
.brutalist-page ::-webkit-scrollbar {
  width: 10px;
}

.brutalist-page ::-webkit-scrollbar-track {
  background: var(--brutal-bg);
  border-left: 2px solid var(--brutal-text);
}

.brutalist-page ::-webkit-scrollbar-thumb {
  background: var(--brutal-text);
}

.modal-container::-webkit-scrollbar {
  width: 8px;
}

.modal-container::-webkit-scrollbar-track {
  background: var(--brutal-bg);
}

.modal-container::-webkit-scrollbar-thumb {
  background: var(--brutal-text);
}

/* ============================================
   ANIMATIONS
   ============================================ */
@keyframes brutalist-enter {
  from {
    opacity: 0;
    transform: translate(-8px, -8px);
  }
  to {
    opacity: 1;
    transform: translate(0, 0);
  }
}

.feedback-card {
  animation: brutalist-enter 0.3s ease-out both;
}

.feedback-card:nth-child(1) { animation-delay: 0.02s; }
.feedback-card:nth-child(2) { animation-delay: 0.04s; }
.feedback-card:nth-child(3) { animation-delay: 0.06s; }
.feedback-card:nth-child(4) { animation-delay: 0.08s; }
.feedback-card:nth-child(5) { animation-delay: 0.1s; }
.feedback-card:nth-child(6) { animation-delay: 0.12s; }
.feedback-card:nth-child(7) { animation-delay: 0.14s; }
.feedback-card:nth-child(8) { animation-delay: 0.16s; }
.feedback-card:nth-child(9) { animation-delay: 0.18s; }
.feedback-card:nth-child(10) { animation-delay: 0.2s; }
.feedback-card:nth-child(11) { animation-delay: 0.22s; }
.feedback-card:nth-child(12) { animation-delay: 0.24s; }
</style>
