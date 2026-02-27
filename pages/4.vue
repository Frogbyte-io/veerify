<template>
  <div :class="['gazette-page', darkMode ? 'gazette-dark' : 'gazette-light']">
    <!-- Paper texture overlay -->
    <div class="paper-texture"></div>

    <!-- Masthead -->
    <header class="gazette-masthead">
      <div class="masthead-inner">
        <div class="masthead-rule masthead-rule-top"></div>
        <div class="masthead-content">
          <div class="masthead-above">
            <span class="masthead-vol">Vol. XLVII</span>
            <span class="masthead-dot">&middot;</span>
            <span class="masthead-date">{{ formattedDate }}</span>
            <span class="masthead-dot">&middot;</span>
            <span class="masthead-edition">No. 2,847</span>
          </div>
          <h1 class="masthead-title">The Veerify Feedback Gazette</h1>
          <p class="masthead-subtitle">&ldquo;The voice of the user, amplified&rdquo;</p>
          <div class="masthead-nav">
            <button class="masthead-btn" @click="showSubmitDialog = true">Submit Letter to the Editor</button>
            <button class="masthead-toggle" @click="toggleTheme">
              {{ darkMode ? 'Day Edition' : 'Night Edition' }}
            </button>
          </div>
        </div>
        <div class="masthead-rule masthead-rule-bottom"></div>
      </div>
    </header>

    <!-- Breaking News Bar -->
    <div class="breaking-bar">
      <div class="breaking-inner">
        <span class="breaking-label">BREAKING</span>
        <span class="breaking-text">
          {{ openCount }} open items await your vote &middot;
          {{ inProgressCount }} items in active development &middot;
          {{ completedCount }} items shipped this quarter
        </span>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="gazette-body">
      <!-- Stats Sidebar -->
      <aside class="stats-sidebar">
        <div class="stats-header">
          <span class="stats-label">BY THE NUMBERS</span>
          <div class="stats-rule"></div>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-number">{{ feedbackItems.length }}</span>
            <span class="stat-name">Total</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">{{ openCount }}</span>
            <span class="stat-name">Open</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">{{ inProgressCount }}</span>
            <span class="stat-name">In Progress</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">{{ completedCount }}</span>
            <span class="stat-name">Completed</span>
          </div>
        </div>
      </aside>

      <!-- Filters -->
      <nav class="gazette-filters">
        <div class="filter-tabs">
          <button v-for="tab in filterTabs" :key="tab.value"
            :class="['filter-tab', { 'filter-tab-active': activeFilter === tab.value }]"
            @click="activeFilter = tab.value">
            {{ tab.label }}
          </button>
        </div>
        <div class="filter-controls">
          <select v-model="selectedCategory" class="filter-select">
            <option value="all">All Categories</option>
            <option value="feature_request">Feature Requests</option>
            <option value="bug_report">Bug Reports</option>
            <option value="improvement">Improvements</option>
          </select>
          <div class="sort-links">
            <button :class="['sort-link', { 'sort-link-active': sortBy === 'popular' }]"
              @click="sortBy = 'popular'">Sort by Popular</button>
            <span class="sort-divider">|</span>
            <button :class="['sort-link', { 'sort-link-active': sortBy === 'recent' }]" @click="sortBy = 'recent'">Sort
              by Recent</button>
          </div>
        </div>
      </nav>

      <!-- Pinned / Featured Articles -->
      <div v-if="pinnedItems.length > 0" class="featured-section">
        <div class="section-rule"></div>
        <div class="featured-grid">
          <article v-for="item in pinnedItems" :key="'pinned-' + item.id" class="featured-article"
            @click="openDetail(item)">
            <span class="article-section-label" :style="{ color: item.categoryColor }">
              {{ formatCategory(item.category) }}
            </span>
            <div class="featured-status-line">
              <span class="article-status" :class="'status-' + item.status">{{ formatStatus(item.status) }}</span>
              <span class="pinned-badge">PINNED</span>
            </div>
            <h2 class="featured-title">{{ item.title }}</h2>
            <p class="featured-body"><span class="drop-cap">{{ item.body.charAt(0) }}</span>{{ item.body.slice(1) }}</p>
            <div class="featured-meta">
              <span class="article-byline">By {{ item.authorName }} &middot; {{ item.createdAt }}</span>
              <span class="article-engagement">
                {{ item.voteCount }} endorsements &middot; {{ item.commentCount }} letters
              </span>
            </div>
            <div class="featured-vote">
              <button :class="['vote-btn', { 'vote-btn-active': item.voted }]" @click.stop="toggleVote(item)">
                &#9650; {{ item.voted ? 'Endorsed' : 'Endorse' }}
              </button>
            </div>
          </article>
        </div>
      </div>

      <!-- Pull Quote -->
      <div v-if="topVotedItem" class="pull-quote-section">
        <blockquote class="pull-quote">
          <p>&ldquo;{{ topVotedItem.title }}&rdquo;</p>
          <cite>&mdash; {{ topVotedItem.authorName }}, with {{ topVotedItem.voteCount }} endorsements</cite>
        </blockquote>
      </div>

      <!-- Column Layout -->
      <div class="columns-section">
        <div class="section-rule"></div>
        <div class="columns-grid">
          <article v-for="item in regularItems" :key="'regular-' + item.id" class="column-article"
            @click="openDetail(item)">
            <span class="article-section-label" :style="{ color: item.categoryColor }">
              {{ formatCategory(item.category) }}
            </span>
            <h3 class="column-title">{{ item.title }}</h3>
            <p class="column-body">{{ item.body }}</p>
            <div class="column-meta">
              <span class="article-byline">By {{ item.authorName }} &middot; {{ item.createdAt }}</span>
            </div>
            <div class="column-footer">
              <span class="article-status" :class="'status-' + item.status">{{ formatStatus(item.status) }}</span>
              <span class="column-engagement">{{ item.voteCount }} endorsements &middot; {{ item.commentCount }}
                letters</span>
            </div>
            <div class="column-vote">
              <button :class="['vote-btn', { 'vote-btn-active': item.voted }]" @click.stop="toggleVote(item)">
                &#9650; {{ item.voteCount }}
              </button>
            </div>
            <div class="article-rule"></div>
          </article>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="gazette-footer">
      <div class="footer-rule"></div>
      <p class="footer-text">&copy; 2026 The Veerify Feedback Gazette &middot; Powered by Veerify</p>
    </footer>

    <!-- Detail Modal -->
    <transition name="gazette-fade">
      <div v-if="selectedItem" class="detail-overlay" @click.self="selectedItem = null">
        <div class="detail-article">
          <button class="detail-back" @click="selectedItem = null">&larr; Back to Gazette</button>
          <div class="detail-header">
            <span class="article-section-label" :style="{ color: selectedItem.categoryColor }">
              {{ formatCategory(selectedItem.category) }}
            </span>
            <h1 class="detail-title">{{ selectedItem.title }}</h1>
            <p class="detail-byline">
              By {{ selectedItem.authorName }} &middot; Published {{ selectedItem.createdAt }}
            </p>
          </div>
          <div class="detail-content-grid">
            <div class="detail-body-col">
              <p class="detail-body">
                <span class="drop-cap">{{ selectedItem.body.charAt(0) }}</span>{{ selectedItem.body.slice(1) }}
              </p>

              <!-- Comments Section -->
              <div class="comments-section">
                <h3 class="comments-header">Letters &amp; Responses</h3>
                <div class="comments-rule"></div>
                <div v-for="comment in comments" :key="comment.id" class="comment-item">
                  <p class="comment-body">&ldquo;{{ comment.body }}&rdquo;</p>
                  <p class="comment-attribution">&mdash; {{ comment.authorName }}, {{ comment.createdAt }}</p>
                  <div v-if="comment.replies && comment.replies.length" class="comment-replies">
                    <div v-for="reply in comment.replies" :key="reply.id" class="reply-item">
                      <p class="comment-body">&ldquo;{{ reply.body }}&rdquo;</p>
                      <p class="comment-attribution">&mdash; {{ reply.authorName }}, {{ reply.createdAt }}</p>
                    </div>
                  </div>
                </div>

                <!-- Write a Response -->
                <div class="write-response">
                  <h4 class="response-header">Write a Response</h4>
                  <div class="response-form">
                    <div class="form-field">
                      <label class="form-label">Your Name</label>
                      <input v-model="commentName" type="text" class="form-input" placeholder="Anonymous Reader" />
                    </div>
                    <div class="form-field">
                      <label class="form-label">Your Response</label>
                      <textarea v-model="commentBody" class="form-textarea" rows="4"
                        placeholder="Dear Editor..."></textarea>
                    </div>
                    <button class="submit-response-btn" @click="submitComment">Submit Response</button>
                  </div>
                </div>
              </div>
            </div>
            <aside class="detail-sidebar">
              <div class="sidebar-block">
                <span class="sidebar-label">STATUS</span>
                <span class="article-status" :class="'status-' + selectedItem.status">{{
                  formatStatus(selectedItem.status) }}</span>
              </div>
              <div class="sidebar-block">
                <span class="sidebar-label">CATEGORY</span>
                <span>{{ formatCategory(selectedItem.category) }}</span>
              </div>
              <div class="sidebar-block">
                <span class="sidebar-label">ENDORSEMENTS</span>
                <span class="sidebar-number">{{ selectedItem.voteCount }}</span>
              </div>
              <div class="sidebar-block">
                <span class="sidebar-label">LETTERS</span>
                <span class="sidebar-number">{{ selectedItem.commentCount }}</span>
              </div>
              <button :class="['vote-btn vote-btn-full', { 'vote-btn-active': selectedItem.voted }]"
                @click="toggleVote(selectedItem)">
                &#9650; {{ selectedItem.voted ? 'Endorsed' : 'Endorse This' }}
              </button>
            </aside>
          </div>
        </div>
      </div>
    </transition>

    <!-- Submit Dialog -->
    <transition name="gazette-fade">
      <div v-if="showSubmitDialog" class="detail-overlay" @click.self="showSubmitDialog = false">
        <div class="submit-dialog">
          <button class="detail-back" @click="showSubmitDialog = false">&larr; Back to Gazette</button>
          <h2 class="submit-title">Submit Your Feedback</h2>
          <p class="submit-subtitle">A letter to the editors of The Veerify Feedback Gazette</p>
          <div class="submit-form">
            <div class="form-field">
              <label class="form-label">Your Name</label>
              <input v-model="submitName" type="text" class="form-input" placeholder="Jane Doe" />
            </div>
            <div class="form-field">
              <label class="form-label">Headline</label>
              <input v-model="submitTitle" type="text" class="form-input"
                placeholder="A concise summary of your feedback" />
            </div>
            <div class="form-field">
              <label class="form-label">Category</label>
              <select v-model="submitCategory" class="form-input form-select-input">
                <option value="feature_request">Feature Request</option>
                <option value="bug_report">Bug Report</option>
                <option value="improvement">Improvement</option>
              </select>
            </div>
            <div class="form-field">
              <label class="form-label">Your Letter</label>
              <textarea v-model="submitBody" class="form-textarea" rows="6"
                placeholder="Dear Editor, I would like to suggest..."></textarea>
            </div>
            <button class="submit-btn" @click="submitFeedback">Submit to the Gazette</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
export default {
  name: 'MagazineEditorialBoard',
  layout: false,
  data() {
    return {
      darkMode: false,
      activeFilter: 'all',
      selectedCategory: 'all',
      sortBy: 'popular',
      selectedItem: null,
      showSubmitDialog: false,
      commentName: '',
      commentBody: '',
      submitName: '',
      submitTitle: '',
      submitBody: '',
      submitCategory: 'feature_request',
      filterTabs: [
        { label: 'All Sections', value: 'all' },
        { label: 'Open Cases', value: 'open' },
        { label: 'In Development', value: 'in_progress' },
        { label: 'On the Roadmap', value: 'planned' },
        { label: 'Published', value: 'completed' }
      ],
      comments: [
        {
          id: 1,
          authorName: 'Emily Park',
          body: 'This would be amazing! I\'ve been waiting for this feature since I started using the platform.',
          createdAt: '1 day ago',
          replies: [
            { id: 2, authorName: 'Sarah Chen', body: 'Thanks for the support! We\'re actively working on this.', createdAt: '12 hours ago' }
          ]
        },
        { id: 3, authorName: 'Michael Brown', body: 'Would this also support system-level dark mode detection?', createdAt: '1 day ago', replies: [] },
        { id: 4, authorName: 'Rachel Green', body: '+1 on this. The light theme is really harsh on the eyes at night.', createdAt: '2 days ago', replies: [] }
      ],
      feedbackItems: [
        { id: 1, title: 'Add dark mode support for mobile app', body: 'The mobile app currently only supports light mode. Would love to see dark mode support to reduce eye strain during nighttime usage. This has been requested by many users in our community.', status: 'in_progress', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'improvement', voteCount: 142, commentCount: 23, authorName: 'Sarah Chen', createdAt: '2 days ago', isPinned: true, voted: false },
        { id: 2, title: 'Login page crashes on Safari 17', body: 'When trying to log in using Safari 17 on macOS Sonoma, the page becomes unresponsive after entering credentials. Console shows a WebKit rendering error.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', tag: 'bug_report', voteCount: 89, commentCount: 15, authorName: 'Marcus Johnson', createdAt: '5 hours ago', isPinned: false, voted: false },
        { id: 3, title: 'Implement webhook notifications', body: 'Would be great to have webhook support so we can integrate feedback events with our internal tools like Slack and Discord.', status: 'planned', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 76, commentCount: 8, authorName: 'Alex Rivera', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 4, title: 'Export feedback data to CSV', body: 'Need ability to export all feedback data including votes and comments to CSV format for reporting and analysis purposes.', status: 'completed', category: 'feature_request', categoryColor: '#8B5CF6', tag: 'feature_request', voteCount: 134, commentCount: 19, authorName: 'Priya Patel', createdAt: '1 week ago', isPinned: false, voted: false },
        { id: 5, title: 'Improve search performance', body: 'Search results take too long to load when there are more than 500 feedback items. The current implementation seems to be doing full-text search without proper indexing.', status: 'in_progress', category: 'improvement', categoryColor: '#F59E0B', tag: 'improvement', voteCount: 67, commentCount: 11, authorName: "James O'Connor", createdAt: '3 days ago', isPinned: false, voted: false },
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
    formattedDate() {
      var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      var d = new Date()
      return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
    },
    openCount() {
      return this.feedbackItems.filter(function (i) { return i.status === 'open' }).length
    },
    inProgressCount() {
      return this.feedbackItems.filter(function (i) { return i.status === 'in_progress' }).length
    },
    completedCount() {
      return this.feedbackItems.filter(function (i) { return i.status === 'completed' }).length
    },
    filteredItems() {
      var self = this
      var items = this.feedbackItems.slice()
      if (self.activeFilter !== 'all') {
        items = items.filter(function (i) { return i.status === self.activeFilter })
      }
      if (self.selectedCategory !== 'all') {
        items = items.filter(function (i) { return i.category === self.selectedCategory })
      }
      if (self.sortBy === 'popular') {
        items.sort(function (a, b) { return b.voteCount - a.voteCount })
      }
      return items
    },
    pinnedItems() {
      return this.filteredItems.filter(function (i) { return i.isPinned })
    },
    regularItems() {
      return this.filteredItems.filter(function (i) { return !i.isPinned })
    },
    topVotedItem() {
      var sorted = this.feedbackItems.slice().sort(function (a, b) { return b.voteCount - a.voteCount })
      return sorted.length > 0 ? sorted[0] : null
    }
  },
  methods: {
    toggleTheme() {
      this.darkMode = !this.darkMode
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
    formatCategory(cat) {
      var map = {
        feature_request: 'FEATURE REQUEST',
        bug_report: 'BUG REPORT',
        improvement: 'IMPROVEMENT'
      }
      return map[cat] || cat.toUpperCase()
    },
    formatStatus(status) {
      var map = {
        open: 'OPEN',
        in_progress: 'IN DEVELOPMENT',
        planned: 'ON THE ROADMAP',
        completed: 'PUBLISHED'
      }
      return map[status] || status.toUpperCase()
    },
    submitComment() {
      if (!this.commentBody.trim()) return
      this.comments.push({
        id: Date.now(),
        authorName: this.commentName.trim() || 'Anonymous Reader',
        body: this.commentBody.trim(),
        createdAt: 'Just now',
        replies: []
      })
      this.commentName = ''
      this.commentBody = ''
    },
    submitFeedback() {
      if (!this.submitTitle.trim() || !this.submitBody.trim()) return
      var colorMap = {
        feature_request: '#8B5CF6',
        bug_report: '#EF4444',
        improvement: '#F59E0B'
      }
      this.feedbackItems.unshift({
        id: Date.now(),
        title: this.submitTitle.trim(),
        body: this.submitBody.trim(),
        status: 'open',
        category: this.submitCategory,
        categoryColor: colorMap[this.submitCategory] || '#8B5CF6',
        tag: this.submitCategory,
        voteCount: 0,
        commentCount: 0,
        authorName: this.submitName.trim() || 'Anonymous',
        createdAt: 'Just now',
        isPinned: false,
        voted: false
      })
      this.submitName = ''
      this.submitTitle = ''
      this.submitBody = ''
      this.submitCategory = 'feature_request'
      this.showSubmitDialog = false
    }
  }
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&display=swap');

/* =============================================
   CSS CUSTOM PROPERTIES
   ============================================= */
.gazette-light {
  --gz-bg: #FEFAF0;
  --gz-bg-alt: #F8F3E6;
  --gz-text: #2C2C2C;
  --gz-text-muted: #6B6560;
  --gz-text-light: #9A948C;
  --gz-accent: #C54B4B;
  --gz-gold: #B8860B;
  --gz-rule: #2C2C2C;
  --gz-rule-light: #D4CFC4;
  --gz-card-bg: #FEFAF0;
  --gz-overlay-bg: rgba(254, 250, 240, 0.97);
  --gz-input-border: #C4BDB0;
  --gz-breaking-bg: #2C2C2C;
  --gz-breaking-text: #FEFAF0;
  --gz-shadow: rgba(44, 44, 44, 0.08);
}

.gazette-dark {
  --gz-bg: #1a1a18;
  --gz-bg-alt: #222220;
  --gz-text: #E8E2D6;
  --gz-text-muted: #A09A8E;
  --gz-text-light: #6B665C;
  --gz-accent: #D4706A;
  --gz-gold: #D4A843;
  --gz-rule: #E8E2D6;
  --gz-rule-light: #3A3A36;
  --gz-card-bg: #222220;
  --gz-overlay-bg: rgba(26, 26, 24, 0.97);
  --gz-input-border: #4A4A44;
  --gz-breaking-bg: #E8E2D6;
  --gz-breaking-text: #1a1a18;
  --gz-shadow: rgba(0, 0, 0, 0.2);
}

/* =============================================
   BASE & RESET
   ============================================= */
.gazette-page {
  min-height: 100vh;
  background-color: var(--gz-bg);
  color: var(--gz-text);
  font-family: 'Lora', Georgia, 'Times New Roman', serif;
  line-height: 1.7;
  position: relative;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.gazette-page * {
  box-sizing: border-box;
}

/* Paper texture overlay */
.paper-texture {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
}

.gazette-dark .paper-texture {
  opacity: 0.05;
}

/* =============================================
   MASTHEAD
   ============================================= */
.gazette-masthead {
  position: relative;
  z-index: 1;
  padding: 0 24px;
}

.masthead-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding-top: 32px;
}

.masthead-rule {
  height: 1px;
  background-color: var(--gz-rule);
}

.masthead-rule-top {
  height: 3px;
  margin-bottom: 2px;
  position: relative;
}

.masthead-rule-top::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  right: 0;
  height: 1px;
  background-color: var(--gz-rule);
}

.masthead-rule-bottom {
  height: 1px;
  margin-top: 0;
  position: relative;
}

.masthead-rule-bottom::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 0;
  right: 0;
  height: 3px;
  background-color: var(--gz-rule);
}

.masthead-content {
  text-align: center;
  padding: 20px 0;
}

.masthead-above {
  font-family: 'Source Sans 3', 'Segoe UI', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  margin-bottom: 8px;
}

.masthead-dot {
  margin: 0 8px;
}

.masthead-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(32px, 6vw, 64px);
  font-weight: 900;
  letter-spacing: -0.01em;
  line-height: 1.05;
  margin: 0 0 6px 0;
  color: var(--gz-text);
}

.masthead-subtitle {
  font-family: 'Lora', Georgia, serif;
  font-style: italic;
  font-size: 15px;
  color: var(--gz-text-muted);
  margin: 0 0 16px 0;
}

.masthead-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
}

.masthead-btn {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gz-bg);
  background-color: var(--gz-text);
  border: none;
  padding: 10px 24px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.masthead-btn:hover {
  opacity: 0.85;
}

.masthead-toggle {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  background: none;
  border: 1px solid var(--gz-rule-light);
  padding: 8px 16px;
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;
}

.masthead-toggle:hover {
  color: var(--gz-text);
  border-color: var(--gz-text);
}

/* =============================================
   BREAKING NEWS BAR
   ============================================= */
.breaking-bar {
  position: relative;
  z-index: 1;
  background-color: var(--gz-breaking-bg);
  color: var(--gz-breaking-text);
  margin-top: 24px;
}

.breaking-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  letter-spacing: 0.06em;
}

.breaking-label {
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gz-accent);
  flex-shrink: 0;
  position: relative;
  padding-right: 16px;
}

.breaking-label::after {
  content: '';
  position: absolute;
  right: 0;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background-color: currentColor;
  opacity: 0.3;
}

.breaking-text {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.85;
}

/* =============================================
   BODY LAYOUT
   ============================================= */
.gazette-body {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 24px;
}

/* =============================================
   STATS SIDEBAR
   ============================================= */
.stats-sidebar {
  margin-bottom: 32px;
}

.stats-header {
  margin-bottom: 16px;
}

.stats-label {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
}

.stats-rule {
  height: 1px;
  background-color: var(--gz-rule-light);
  margin-top: 8px;
}

.stats-grid {
  display: flex;
  gap: 40px;
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-number {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--gz-text);
}

.stat-name {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  margin-top: 2px;
}

/* =============================================
   FILTERS
   ============================================= */
.gazette-filters {
  margin-bottom: 28px;
}

.filter-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  border-bottom: 1px solid var(--gz-rule-light);
  margin-bottom: 14px;
}

.filter-tab {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 16px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  margin-bottom: -1px;
}

.filter-tab:hover {
  color: var(--gz-text);
}

.filter-tab-active {
  color: var(--gz-text);
  border-bottom-color: var(--gz-accent);
}

.filter-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-select {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 13px;
  color: var(--gz-text);
  background-color: var(--gz-bg);
  border: 1px solid var(--gz-rule-light);
  padding: 6px 12px;
  cursor: pointer;
  appearance: auto;
}

.sort-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-link {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 400;
  color: var(--gz-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.2s;
}

.sort-link:hover {
  color: var(--gz-text);
}

.sort-link-active {
  color: var(--gz-text);
  font-weight: 600;
}

.sort-divider {
  color: var(--gz-rule-light);
  font-size: 12px;
}

/* =============================================
   SECTION RULES
   ============================================= */
.section-rule {
  height: 1px;
  background-color: var(--gz-rule-light);
  margin-bottom: 24px;
}

.article-rule {
  height: 1px;
  background-color: var(--gz-rule-light);
  margin-top: 20px;
}

/* =============================================
   FEATURED / PINNED ARTICLES
   ============================================= */
.featured-section {
  margin-bottom: 32px;
}

.featured-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
}

@media (min-width: 768px) {
  .featured-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.featured-article {
  cursor: pointer;
  padding: 24px;
  border: 1px solid var(--gz-rule-light);
  background-color: var(--gz-card-bg);
  transition: box-shadow 0.25s ease;
}

.featured-article:hover {
  box-shadow: 0 4px 20px var(--gz-shadow);
}

.article-section-label {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  display: inline-block;
  margin-bottom: 6px;
}

.featured-status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.pinned-badge {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gz-gold);
  border: 1px solid var(--gz-gold);
  padding: 2px 8px;
}

.article-status {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 3px 10px;
  border: 1px solid var(--gz-rule-light);
  display: inline-block;
}

.status-open {
  color: var(--gz-accent);
  border-color: var(--gz-accent);
}

.status-in_progress {
  color: var(--gz-gold);
  border-color: var(--gz-gold);
}

.status-planned {
  color: #8B5CF6;
  border-color: #8B5CF6;
}

.status-completed {
  color: #22863a;
  border-color: #22863a;
}

.gazette-dark .status-completed {
  color: #5CB87A;
  border-color: #5CB87A;
}

.featured-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 14px 0;
  color: var(--gz-text);
}

.featured-body {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px;
  line-height: 1.75;
  color: var(--gz-text);
  margin: 0 0 14px 0;
  text-align: justify;
  hyphens: auto;
}

.drop-cap {
  float: left;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 3.4em;
  line-height: 0.8;
  padding-right: 8px;
  padding-top: 4px;
  color: var(--gz-accent);
  font-weight: 700;
}

.featured-meta {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.article-byline {
  font-family: 'Lora', Georgia, serif;
  font-style: italic;
  font-size: 13px;
  color: var(--gz-text-muted);
}

.article-engagement {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  color: var(--gz-text-light);
  letter-spacing: 0.04em;
}

.featured-vote {
  margin-top: 4px;
}

/* =============================================
   VOTE BUTTON
   ============================================= */
.vote-btn {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--gz-text-muted);
  background: none;
  border: 1px solid var(--gz-rule-light);
  padding: 6px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.vote-btn:hover {
  color: var(--gz-accent);
  border-color: var(--gz-accent);
}

.vote-btn-active {
  color: var(--gz-accent);
  border-color: var(--gz-accent);
  background-color: rgba(197, 75, 75, 0.06);
}

.gazette-dark .vote-btn-active {
  background-color: rgba(212, 112, 106, 0.1);
}

.vote-btn-full {
  width: 100%;
  padding: 10px 16px;
  margin-top: 12px;
}

/* =============================================
   PULL QUOTE
   ============================================= */
.pull-quote-section {
  margin: 8px 0 36px 0;
  text-align: center;
}

.pull-quote {
  max-width: 700px;
  margin: 0 auto;
  padding: 28px 40px;
  border-top: 3px solid var(--gz-rule);
  border-bottom: 1px solid var(--gz-rule);
}

.pull-quote p {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(20px, 2.6vw, 28px);
  font-weight: 600;
  font-style: italic;
  line-height: 1.35;
  color: var(--gz-text);
  margin: 0 0 12px 0;
}

.pull-quote cite {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  font-style: normal;
}

/* =============================================
   COLUMN LAYOUT
   ============================================= */
.columns-section {
  margin-bottom: 40px;
}

.columns-grid {
  column-count: 3;
  column-gap: 32px;
  column-rule: 1px solid var(--gz-rule-light);
}

@media (max-width: 1024px) {
  .columns-grid {
    column-count: 2;
  }
}

@media (max-width: 640px) {
  .columns-grid {
    column-count: 1;
    column-rule: none;
  }
}

.column-article {
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
  page-break-inside: avoid;
  padding-bottom: 20px;
  margin-bottom: 0;
  cursor: pointer;
  transition: opacity 0.2s;
}

.column-article:hover {
  opacity: 0.8;
}

.column-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 8px 0;
  color: var(--gz-text);
}

.column-body {
  font-family: 'Lora', Georgia, serif;
  font-size: 14px;
  line-height: 1.7;
  color: var(--gz-text);
  margin: 0 0 10px 0;
  text-align: justify;
  hyphens: auto;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.column-meta {
  margin-bottom: 8px;
}

.column-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.column-engagement {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  color: var(--gz-text-light);
  letter-spacing: 0.04em;
}

.column-vote {
  margin-bottom: 0;
}

/* =============================================
   FOOTER
   ============================================= */
.gazette-footer {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 24px 40px 24px;
}

.footer-rule {
  height: 1px;
  background-color: var(--gz-rule);
  margin-bottom: 3px;
  position: relative;
}

.footer-rule::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  right: 0;
  height: 3px;
  background-color: var(--gz-rule);
}

.footer-text {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  text-align: center;
  margin-top: 20px;
}

/* =============================================
   DETAIL MODAL / OVERLAY
   ============================================= */
.detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background-color: var(--gz-overlay-bg);
  overflow-y: auto;
  padding: 40px 24px;
}

.detail-article,
.submit-dialog {
  max-width: 900px;
  margin: 0 auto;
}

.detail-back {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-bottom: 28px;
  display: inline-block;
  transition: color 0.2s;
}

.detail-back:hover {
  color: var(--gz-text);
}

.detail-header {
  margin-bottom: 32px;
}

.detail-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(28px, 4vw, 42px);
  font-weight: 800;
  line-height: 1.15;
  margin: 8px 0 12px 0;
  color: var(--gz-text);
}

.detail-byline {
  font-family: 'Lora', Georgia, serif;
  font-style: italic;
  font-size: 14px;
  color: var(--gz-text-muted);
  margin: 0;
}

.detail-content-grid {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 40px;
  align-items: start;
}

@media (max-width: 768px) {
  .detail-content-grid {
    grid-template-columns: 1fr;
  }
}

.detail-body {
  font-family: 'Lora', Georgia, serif;
  font-size: 17px;
  line-height: 1.8;
  color: var(--gz-text);
  text-align: justify;
  hyphens: auto;
  margin: 0 0 36px 0;
}

/* =============================================
   DETAIL SIDEBAR
   ============================================= */
.detail-sidebar {
  border-left: 1px solid var(--gz-rule-light);
  padding-left: 24px;
}

@media (max-width: 768px) {
  .detail-sidebar {
    border-left: none;
    border-top: 1px solid var(--gz-rule-light);
    padding-left: 0;
    padding-top: 20px;
  }
}

.sidebar-block {
  margin-bottom: 20px;
}

.sidebar-label {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--gz-text-light);
  display: block;
  margin-bottom: 4px;
}

.sidebar-number {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 28px;
  font-weight: 700;
  color: var(--gz-text);
}

/* =============================================
   COMMENTS
   ============================================= */
.comments-section {
  margin-top: 8px;
}

.comments-header {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px 0;
  color: var(--gz-text);
}

.comments-rule {
  height: 1px;
  background-color: var(--gz-rule-light);
  margin-bottom: 20px;
}

.comment-item {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--gz-rule-light);
}

.comment-item:last-of-type {
  border-bottom: none;
}

.comment-body {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px;
  line-height: 1.7;
  color: var(--gz-text);
  margin: 0 0 6px 0;
  font-style: italic;
}

.comment-attribution {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  color: var(--gz-text-muted);
  letter-spacing: 0.04em;
  margin: 0;
}

.comment-replies {
  margin-top: 16px;
  margin-left: 24px;
  padding-left: 16px;
  border-left: 2px solid var(--gz-rule-light);
}

.reply-item {
  margin-bottom: 12px;
}

/* =============================================
   WRITE RESPONSE / SUBMIT FORMS
   ============================================= */
.write-response {
  margin-top: 32px;
}

.response-header {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--gz-text);
}

.response-form,
.submit-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gz-text-muted);
}

.form-input {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px;
  color: var(--gz-text);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--gz-input-border);
  padding: 8px 0;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-bottom-color: var(--gz-text);
}

.form-select-input {
  appearance: auto;
  cursor: pointer;
}

.form-textarea {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px;
  color: var(--gz-text);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--gz-input-border);
  padding: 8px 0;
  outline: none;
  resize: vertical;
  transition: border-color 0.2s;
}

.form-textarea:focus {
  border-bottom-color: var(--gz-text);
}

.submit-response-btn,
.submit-btn {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gz-bg);
  background-color: var(--gz-text);
  border: none;
  padding: 12px 28px;
  cursor: pointer;
  align-self: flex-start;
  transition: opacity 0.2s;
}

.submit-response-btn:hover,
.submit-btn:hover {
  opacity: 0.85;
}

/* =============================================
   SUBMIT DIALOG
   ============================================= */
.submit-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(26px, 3.5vw, 36px);
  font-weight: 800;
  margin: 0 0 6px 0;
  color: var(--gz-text);
}

.submit-subtitle {
  font-family: 'Lora', Georgia, serif;
  font-style: italic;
  font-size: 14px;
  color: var(--gz-text-muted);
  margin: 0 0 32px 0;
}

/* =============================================
   TRANSITIONS
   ============================================= */
.gazette-fade-enter-active,
.gazette-fade-leave-active {
  transition: opacity 0.3s ease;
}

.gazette-fade-enter-from,
.gazette-fade-leave-to {
  opacity: 0;
}

/* =============================================
   RESPONSIVE ADJUSTMENTS
   ============================================= */
@media (max-width: 640px) {
  .masthead-nav {
    gap: 12px;
  }

  .masthead-btn {
    font-size: 11px;
    padding: 8px 16px;
  }

  .stats-grid {
    gap: 24px;
  }

  .stat-number {
    font-size: 28px;
  }

  .filter-tabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
  }

  .filter-tab {
    white-space: nowrap;
    padding: 8px 12px;
    font-size: 11px;
  }

  .featured-article {
    padding: 16px;
  }

  .pull-quote {
    padding: 20px 16px;
  }

  .breaking-inner {
    flex-direction: column;
    gap: 6px;
    text-align: center;
  }

  .breaking-label::after {
    display: none;
  }
}
</style>