<template>
  <div class="terminal-page" :class="{ 'amber-mode': isAmberMode }">
    <!-- Matrix Rain Background -->
    <div class="matrix-rain">
      <div v-for="col in 20" :key="col" class="matrix-column" :style="{ left: ((col - 1) * 5) + '%', animationDuration: (2 + Math.random() * 4) + 's', animationDelay: (Math.random() * 3) + 's' }">
        {{ matrixColumns[col - 1] }}
      </div>
    </div>

    <!-- CRT Monitor Frame -->
    <div class="crt-bezel">
      <!-- Power LED -->
      <div class="power-led-row">
        <div class="power-led"></div>
        <span class="brand-label">VEERIFY CRT-3000</span>
      </div>

      <!-- Inner Screen -->
      <div class="crt-screen">
        <!-- Scanlines Overlay -->
        <div class="scanlines"></div>

        <!-- Screen Content -->
        <div class="screen-content">

          <!-- Header -->
          <div class="terminal-header">
            <div class="header-line typing-line">
              <span class="prompt">&gt;</span>
              <span class="typed-text">{{ displayedTitle }}</span>
              <span class="cursor-blink">_</span>
            </div>
            <div class="header-line">
              <span class="prompt">&gt;</span>
              <span class="dim-text">================================</span>
            </div>
            <div class="header-line">
              <span class="prompt">&gt;</span>
              <span class="dim-text">System initialized. {{ filteredItems.length }} feedback entries loaded.</span>
            </div>
            <div class="header-line">
              <span class="prompt">&gt;</span>
              <span class="dim-text">Type HELP for commands or browse below.</span>
            </div>
            <div class="header-actions">
              <button class="terminal-btn theme-btn" @click="toggleTheme">
                [{{ isAmberMode ? 'PHOSPHOR' : 'AMBER' }}]
              </button>
              <button class="terminal-btn submit-btn" @click="showSubmitDialog = true">
                <span class="prompt">&gt;</span> NEW_ENTRY<span class="cursor-blink">_</span>
              </button>
            </div>
          </div>

          <!-- Stats -->
          <div class="stats-box">
            <div class="ascii-line">+------------+----------+---------+-----------+</div>
            <div class="ascii-line">| SYSTEM STATUS                                 |</div>
            <div class="ascii-line">+------------+----------+---------+-----------+</div>
            <div class="stats-row">
              <span class="stat-item">| TOTAL:<span class="stat-value glow-pulse">{{ feedbackItems.length }}</span></span>
              <span class="stat-item">| OPEN:<span class="stat-value glow-pulse">{{ countByStatus('open') }}</span></span>
              <span class="stat-item">| WIP:<span class="stat-value glow-pulse">{{ countByStatus('in_progress') }}</span></span>
              <span class="stat-item">| DONE:<span class="stat-value glow-pulse">{{ countByStatus('completed') }}</span> |</span>
            </div>
            <div class="ascii-line">+------------+----------+---------+-----------+</div>
          </div>

          <!-- Filters -->
          <div class="filters-section">
            <div class="filter-line">
              <span class="prompt">&gt;</span> FILTER:
              <button v-for="s in statusFilters" :key="s.value" class="filter-btn" :class="{ active: activeStatus === s.value }" @click="activeStatus = s.value">
                [{{ s.label }}]
              </button>
            </div>
            <div class="filter-line">
              <span class="prompt">&gt;</span> CATEGORY:
              <button v-for="c in categoryFilters" :key="c.value" class="filter-btn" :class="{ active: activeCategory === c.value }" @click="activeCategory = c.value">
                [{{ c.label }}]
              </button>
            </div>
            <div class="filter-line">
              <span class="prompt">&gt;</span> SORT:
              <button v-for="so in sortOptions" :key="so.value" class="filter-btn" :class="{ active: activeSort === so.value }" @click="activeSort = so.value">
                [{{ so.label }}]
              </button>
            </div>
          </div>

          <!-- Feedback List -->
          <div class="feedback-list">
            <div v-for="item in filteredItems" :key="item.id" class="feedback-card" :class="{ pinned: item.isPinned }" @click="openDetail(item)">
              <div class="card-top-border">+----------------------------------------------+</div>
              <div class="card-row">
                | #{{ String(item.id).padStart(3, '0') }}
                <span v-if="item.isPinned" class="pin-badge">[PINNED]</span>
                <span class="status-badge" :class="'status-' + item.status">[{{ statusLabel(item.status) }}]</span>
              </div>
              <div class="card-row card-title">
                | <span class="prompt">&gt;</span> {{ item.title }}
              </div>
              <div class="card-row card-divider">| ───────────────────────────────────────────</div>
              <div class="card-row card-body">| {{ truncate(item.body, 120) }}</div>
              <div class="card-row card-meta">
                |
                <button class="vote-btn" :class="{ voted: item.voted }" @click.stop="toggleVote(item)">
                  [{{ item.voted ? '★' : '▲' }} {{ item.voteCount }}]
                </button>
                <span class="tag-badge" :style="{ color: item.categoryColor }">
                  [{{ tagLabel(item.tag) }}]
                </span>
              </div>
              <div class="card-row card-footer">
                | @{{ item.authorName.toLowerCase().replace(/\s/g, '_') }} | {{ item.createdAt }} | {{ item.commentCount }} comments
              </div>
              <div class="card-bottom-border">+----------------------------------------------+</div>
            </div>

            <div v-if="filteredItems.length === 0" class="no-results">
              <span class="prompt">&gt;</span> NO MATCHING ENTRIES FOUND. ADJUST FILTERS.
            </div>
          </div>

          <!-- Footer -->
          <div class="terminal-footer">
            <span class="prompt">&gt;</span> END OF TRANSMISSION // VEERIFY TERMINAL v2.1.0
            <span class="cursor-blink">_</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Modal -->
    <div v-if="selectedItem" class="modal-overlay" @click.self="selectedItem = null">
      <div class="modal-crt">
        <div class="scanlines"></div>
        <div class="modal-content">
          <div class="modal-border">
            <div class="modal-line double-top">+================================================+</div>
            <div class="modal-line modal-title-line">| FEEDBACK #{{ String(selectedItem.id).padStart(3, '0') }} - DETAILED VIEW</div>
            <div class="modal-line double-mid">+================================================+</div>
          </div>

          <div class="modal-body-content">
            <div class="detail-row">
              <span class="label-text">STATUS:</span>
              <span class="status-badge" :class="'status-' + selectedItem.status">[{{ statusLabel(selectedItem.status) }}]</span>
            </div>
            <div class="detail-row">
              <span class="label-text">CATEGORY:</span>
              <span :style="{ color: selectedItem.categoryColor }">[{{ tagLabel(selectedItem.tag) }}]</span>
            </div>
            <div class="detail-row">
              <span class="label-text">AUTHOR:</span>
              <span>@{{ selectedItem.authorName.toLowerCase().replace(/\s/g, '_') }}</span>
            </div>
            <div class="detail-row">
              <span class="label-text">SUBMITTED:</span>
              <span>{{ selectedItem.createdAt }}</span>
            </div>
            <div class="detail-row">
              <span class="label-text">VOTES:</span>
              <span class="stat-value">[{{ selectedItem.voteCount }}]</span>
              <button class="vote-btn inline-vote" :class="{ voted: selectedItem.voted }" @click="toggleVote(selectedItem)">
                {{ selectedItem.voted ? '[UNVOTE]' : '[VOTE ▲]' }}
              </button>
            </div>

            <div class="detail-divider">────────────────────────────────────────────</div>

            <div class="detail-title">
              <span class="prompt">&gt;</span> {{ selectedItem.title }}
            </div>

            <div class="detail-body">{{ selectedItem.body }}</div>

            <div class="detail-divider">────────────────────────────────────────────</div>

            <div class="comments-header">
              <span class="prompt">&gt;</span> COMMENTS LOG ({{ comments.length + commentRepliesCount }})
            </div>

            <div class="comments-list">
              <div v-for="comment in comments" :key="comment.id" class="comment-entry">
                <div class="comment-line">
                  <span class="comment-time">[{{ comment.createdAt }}]</span>
                  <span class="comment-author">@{{ comment.authorName.toLowerCase().replace(/\s/g, '_') }}:</span>
                  <span class="comment-body">{{ comment.body }}</span>
                </div>
                <div v-for="reply in comment.replies" :key="reply.id" class="comment-reply">
                  <span class="reply-indent">  └─</span>
                  <span class="comment-time">[{{ reply.createdAt }}]</span>
                  <span class="comment-author">@{{ reply.authorName.toLowerCase().replace(/\s/g, '_') }}:</span>
                  <span class="comment-body">{{ reply.body }}</span>
                </div>
              </div>
            </div>

            <div class="comment-input">
              <span class="prompt">&gt;</span>
              <input v-model="newComment" type="text" placeholder="Enter comment..." class="terminal-input" @keyup.enter="addComment" />
            </div>
          </div>

          <div class="modal-close-row">
            <button class="terminal-btn" @click="selectedItem = null">[ESC] CLOSE</button>
          </div>
          <div class="modal-line double-bottom">+================================================+</div>
        </div>
      </div>
    </div>

    <!-- Submit Dialog -->
    <div v-if="showSubmitDialog" class="modal-overlay" @click.self="showSubmitDialog = false">
      <div class="modal-crt submit-modal">
        <div class="scanlines"></div>
        <div class="modal-content">
          <div class="modal-border">
            <div class="modal-line double-top">+================================================+</div>
            <div class="modal-line modal-title-line">| NEW FEEDBACK ENTRY - SUBMISSION FORM</div>
            <div class="modal-line double-mid">+================================================+</div>
          </div>

          <div class="modal-body-content submit-form">
            <div class="form-row">
              <span class="prompt">&gt;</span> ENTER TITLE:
              <input v-model="submitForm.title" type="text" class="terminal-input" placeholder="_" />
            </div>

            <div class="form-row">
              <span class="prompt">&gt;</span> SELECT CATEGORY:
              <div class="category-options">
                <button v-for="cat in submitCategories" :key="cat.value" class="filter-btn" :class="{ active: submitForm.category === cat.value }" @click="submitForm.category = cat.value">
                  [{{ cat.label }}]
                </button>
              </div>
            </div>

            <div class="form-row">
              <span class="prompt">&gt;</span> ENTER DESCRIPTION:
              <textarea v-model="submitForm.description" class="terminal-textarea" rows="4" placeholder="_"></textarea>
            </div>

            <div class="form-row">
              <span class="prompt">&gt;</span> YOUR NAME:
              <input v-model="submitForm.name" type="text" class="terminal-input" placeholder="_" />
            </div>

            <div class="form-row">
              <span class="prompt">&gt;</span> YOUR EMAIL:
              <input v-model="submitForm.email" type="email" class="terminal-input" placeholder="_" />
            </div>

            <div v-if="submitError" class="submit-error">
              <span class="prompt">&gt;</span> ERROR: {{ submitError }}
            </div>

            <div v-if="submitSuccess" class="submit-success">
              <span class="prompt">&gt;</span> ENTRY SUBMITTED SUCCESSFULLY. ID #{{ feedbackItems.length }} ASSIGNED.
            </div>

            <div class="form-actions">
              <button class="terminal-btn submit-confirm" @click="submitFeedback">
                <span class="prompt">&gt;</span> CONFIRM SUBMIT [Y]
              </button>
              <button class="terminal-btn" @click="showSubmitDialog = false">
                [N] CANCEL
              </button>
            </div>
          </div>

          <div class="modal-line double-bottom">+================================================+</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'RetroTerminalBoard',
  layout: false,

  data() {
    return {
      isAmberMode: false,
      activeStatus: 'all',
      activeCategory: 'all',
      activeSort: 'votes_desc',
      selectedItem: null,
      showSubmitDialog: false,
      newComment: '',
      submitSuccess: false,
      submitError: '',
      displayedTitle: '',
      titleFullText: 'VEERIFY FEEDBACK TERMINAL v2.1.0',
      typingIndex: 0,
      typingTimer: null,

      matrixChars: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF',
      matrixColumns: [],

      submitForm: {
        title: '',
        category: 'feature_request',
        description: '',
        name: '',
        email: ''
      },

      statusFilters: [
        { label: 'ALL', value: 'all' },
        { label: 'OPEN', value: 'open' },
        { label: 'IN_PROGRESS', value: 'in_progress' },
        { label: 'PLANNED', value: 'planned' },
        { label: 'COMPLETED', value: 'completed' }
      ],
      categoryFilters: [
        { label: '*', value: 'all' },
        { label: 'BUG', value: 'bug_report' },
        { label: 'FEATURE', value: 'feature_request' },
        { label: 'IMPROVEMENT', value: 'improvement' },
        { label: 'QUESTION', value: 'question' }
      ],
      sortOptions: [
        { label: 'VOTES_DESC', value: 'votes_desc' },
        { label: 'DATE_DESC', value: 'date_desc' }
      ],
      submitCategories: [
        { label: 'BUG', value: 'bug_report' },
        { label: 'FEATURE', value: 'feature_request' },
        { label: 'IMPROVEMENT', value: 'improvement' },
        { label: 'QUESTION', value: 'question' }
      ],

      comments: [
        { id: 1, authorName: 'Emily Park', body: 'This would be amazing! I\'ve been waiting for this feature since I started using the platform.', createdAt: '1 day ago', replies: [
          { id: 2, authorName: 'Sarah Chen', body: 'Thanks for the support! We\'re actively working on this.', createdAt: '12 hours ago' }
        ]},
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
    filteredItems() {
      var items = this.feedbackItems.slice()

      if (this.activeStatus !== 'all') {
        items = items.filter(function (i) { return i.status === this.activeStatus }.bind(this))
      }
      if (this.activeCategory !== 'all') {
        items = items.filter(function (i) { return i.category === this.activeCategory }.bind(this))
      }

      // Pinned first
      var pinned = items.filter(function (i) { return i.isPinned })
      var unpinned = items.filter(function (i) { return !i.isPinned })

      if (this.activeSort === 'votes_desc') {
        unpinned.sort(function (a, b) { return b.voteCount - a.voteCount })
      } else {
        unpinned.sort(function (a, b) { return b.id - a.id })
      }

      return pinned.concat(unpinned)
    },

    commentRepliesCount() {
      var count = 0
      this.comments.forEach(function (c) { count += c.replies.length })
      return count
    }
  },

  mounted() {
    this.generateMatrixColumns()
    this.startTyping()
    this.handleKeydown = function (e) {
      if (e.key === 'Escape') {
        this.selectedItem = null
        this.showSubmitDialog = false
      }
    }.bind(this)
    window.addEventListener('keydown', this.handleKeydown)
  },

  beforeUnmount() {
    if (this.typingTimer) clearInterval(this.typingTimer)
    if (this.handleKeydown) window.removeEventListener('keydown', this.handleKeydown)
  },

  methods: {
    generateMatrixColumns() {
      var cols = []
      for (var i = 0; i < 20; i++) {
        var str = ''
        for (var j = 0; j < 40; j++) {
          str += this.matrixChars[Math.floor(Math.random() * this.matrixChars.length)] + '\n'
        }
        cols.push(str)
      }
      this.matrixColumns = cols
    },

    startTyping() {
      this.typingIndex = 0
      this.displayedTitle = ''
      this.typingTimer = setInterval(function () {
        if (this.typingIndex < this.titleFullText.length) {
          this.displayedTitle += this.titleFullText[this.typingIndex]
          this.typingIndex++
        } else {
          clearInterval(this.typingTimer)
        }
      }.bind(this), 60)
    },

    toggleTheme() {
      this.isAmberMode = !this.isAmberMode
    },

    countByStatus(status) {
      return this.feedbackItems.filter(function (i) { return i.status === status }).length
    },

    statusLabel(status) {
      var map = {
        open: 'OPEN',
        in_progress: 'IN_PROGRESS',
        planned: 'PLANNED',
        completed: 'COMPLETED'
      }
      return map[status] || status.toUpperCase()
    },

    tagLabel(tag) {
      var map = {
        bug_report: 'BUG',
        feature_request: 'FEATURE',
        improvement: 'IMPROVEMENT',
        question: 'QUESTION'
      }
      return map[tag] || tag.toUpperCase()
    },

    truncate(text, len) {
      if (text.length <= len) return text
      return text.substring(0, len) + '...'
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

    addComment() {
      if (!this.newComment.trim()) return
      this.comments.push({
        id: Date.now(),
        authorName: 'Anonymous',
        body: this.newComment,
        createdAt: 'just now',
        replies: []
      })
      this.newComment = ''
    },

    submitFeedback() {
      this.submitError = ''
      this.submitSuccess = false

      if (!this.submitForm.title.trim()) {
        this.submitError = 'TITLE IS REQUIRED'
        return
      }
      if (!this.submitForm.description.trim()) {
        this.submitError = 'DESCRIPTION IS REQUIRED'
        return
      }

      var catColors = {
        bug_report: '#EF4444',
        feature_request: '#8B5CF6',
        improvement: '#F59E0B',
        question: '#00D4FF'
      }

      this.feedbackItems.push({
        id: this.feedbackItems.length + 1,
        title: this.submitForm.title,
        body: this.submitForm.description,
        status: 'open',
        category: this.submitForm.category,
        categoryColor: catColors[this.submitForm.category] || '#8B5CF6',
        tag: this.submitForm.category,
        voteCount: 0,
        commentCount: 0,
        authorName: this.submitForm.name || 'Anonymous',
        createdAt: 'just now',
        isPinned: false,
        voted: false
      })

      this.submitSuccess = true
      this.submitForm = {
        title: '',
        category: 'feature_request',
        description: '',
        name: '',
        email: ''
      }

      var self = this
      setTimeout(function () {
        self.showSubmitDialog = false
        self.submitSuccess = false
      }, 1500)
    }
  }
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');

/* ========================================
   CSS CUSTOM PROPERTIES
   ======================================== */
.terminal-page {
  --term-green: #00FF41;
  --term-green-dim: #00aa2a;
  --term-green-glow: rgba(0, 255, 65, 0.4);
  --term-green-bg: rgba(0, 255, 65, 0.08);
  --term-bg: #0D0208;
  --term-bg-light: #0f0f0f;
  --term-amber: #FFB000;
  --term-cyan: #00D4FF;
  --term-red: #FF0040;
  --term-fg: var(--term-green);
  --term-fg-dim: var(--term-green-dim);
  --term-fg-glow: var(--term-green-glow);
  --term-fg-bg: var(--term-green-bg);
  --bezel-dark: #1a1a1a;
  --bezel-light: #2a2a2a;
  --bezel-highlight: #333333;
}

.terminal-page.amber-mode {
  --term-fg: #FFB000;
  --term-fg-dim: #aa7500;
  --term-fg-glow: rgba(255, 176, 0, 0.4);
  --term-fg-bg: rgba(255, 176, 0, 0.08);
}

/* ========================================
   RESET & BASE
   ======================================== */
.terminal-page {
  font-family: 'JetBrains Mono', monospace;
  background: var(--term-bg);
  color: var(--term-fg);
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  line-height: 1.6;
  font-size: 13px;
}

.terminal-page *,
.terminal-page *::before,
.terminal-page *::after {
  box-sizing: border-box;
}

/* ========================================
   MATRIX RAIN BACKGROUND
   ======================================== */
.matrix-rain {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0.06;
}

.matrix-column {
  position: absolute;
  top: -100%;
  font-size: 14px;
  line-height: 1.2;
  color: var(--term-fg);
  white-space: pre;
  animation: matrixFall linear infinite;
  text-shadow: 0 0 8px var(--term-fg-glow);
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 4px;
}

@keyframes matrixFall {
  0% {
    transform: translateY(-100%);
  }
  100% {
    transform: translateY(200vh);
  }
}

/* ========================================
   CRT BEZEL (MONITOR FRAME)
   ======================================== */
.crt-bezel {
  position: relative;
  z-index: 1;
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px;
}

@media (min-width: 768px) {
  .crt-bezel {
    margin: 20px auto;
    padding: 24px;
    background: linear-gradient(145deg, var(--bezel-light), var(--bezel-dark));
    border-radius: 16px;
    box-shadow:
      0 0 0 2px #111,
      0 0 0 4px var(--bezel-highlight),
      0 8px 32px rgba(0, 0, 0, 0.8),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
}

.power-led-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 0 8px;
}

.power-led {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--term-fg);
  box-shadow: 0 0 6px var(--term-fg), 0 0 12px var(--term-fg-glow);
  animation: ledPulse 2s ease-in-out infinite;
}

@keyframes ledPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.brand-label {
  font-size: 10px;
  color: #555;
  letter-spacing: 3px;
  text-transform: uppercase;
}

/* ========================================
   CRT SCREEN
   ======================================== */
.crt-screen {
  position: relative;
  background: var(--term-bg);
  border: 2px solid #222;
  overflow: hidden;
}

@media (min-width: 768px) {
  .crt-screen {
    border-radius: 8px;
    box-shadow:
      inset 0 0 60px rgba(0, 0, 0, 0.6),
      0 0 20px var(--term-fg-glow),
      0 0 60px rgba(0, 255, 65, 0.05);
    animation: crtFlicker 8s ease-in-out infinite;
  }
}

.terminal-page.amber-mode .crt-screen {
  box-shadow:
    inset 0 0 60px rgba(0, 0, 0, 0.6),
    0 0 20px rgba(255, 176, 0, 0.15),
    0 0 60px rgba(255, 176, 0, 0.05);
}

@keyframes crtFlicker {
  0%, 100% { opacity: 1; }
  92% { opacity: 1; }
  93% { opacity: 0.97; }
  94% { opacity: 1; }
  96% { opacity: 0.98; }
  97% { opacity: 1; }
}

/* ========================================
   SCANLINES
   ======================================== */
.scanlines {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.15) 0px,
    rgba(0, 0, 0, 0.15) 1px,
    transparent 1px,
    transparent 3px
  );
}

/* ========================================
   SCREEN CONTENT
   ======================================== */
.screen-content {
  position: relative;
  z-index: 1;
  padding: 24px 20px;
}

@media (min-width: 768px) {
  .screen-content {
    padding: 32px 28px;
  }
}

/* ========================================
   TERMINAL HEADER
   ======================================== */
.terminal-header {
  margin-bottom: 24px;
}

.header-line {
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
}

.prompt {
  color: var(--term-fg);
  font-weight: 700;
  margin-right: 6px;
  text-shadow: 0 0 8px var(--term-fg-glow);
}

.typing-line {
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 0 10px var(--term-fg-glow), 0 0 20px var(--term-fg-glow);
}

@media (min-width: 768px) {
  .typing-line {
    font-size: 22px;
  }
}

.typed-text {
  color: var(--term-fg);
}

.cursor-blink {
  color: var(--term-fg);
  animation: blink 1s step-end infinite;
  font-weight: 700;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.dim-text {
  color: var(--term-fg-dim);
  font-size: 12px;
}

.header-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}

/* ========================================
   BUTTONS
   ======================================== */
.terminal-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  background: transparent;
  color: var(--term-fg);
  border: 1px solid var(--term-fg-dim);
  padding: 6px 14px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-shadow: 0 0 4px var(--term-fg-glow);
}

.terminal-btn:hover {
  background: var(--term-fg-bg);
  border-color: var(--term-fg);
  box-shadow: 0 0 10px var(--term-fg-glow);
  text-shadow: 0 0 8px var(--term-fg-glow);
}

.submit-btn {
  border-color: var(--term-fg);
  font-weight: 600;
}

.theme-btn {
  color: var(--term-amber);
  border-color: rgba(255, 176, 0, 0.4);
  text-shadow: 0 0 4px rgba(255, 176, 0, 0.4);
}

.terminal-page.amber-mode .theme-btn {
  color: var(--term-green);
  border-color: rgba(0, 255, 65, 0.4);
  text-shadow: 0 0 4px rgba(0, 255, 65, 0.4);
}

.theme-btn:hover {
  background: rgba(255, 176, 0, 0.1);
  border-color: var(--term-amber);
}

.terminal-page.amber-mode .theme-btn:hover {
  background: rgba(0, 255, 65, 0.1);
  border-color: var(--term-green);
}

/* ========================================
   STATS BOX
   ======================================== */
.stats-box {
  margin-bottom: 24px;
  font-size: 12px;
}

.ascii-line {
  color: var(--term-fg-dim);
  white-space: pre;
  overflow-x: auto;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.stat-item {
  color: var(--term-fg-dim);
  white-space: nowrap;
}

.stat-value {
  color: var(--term-fg);
  font-weight: 700;
  text-shadow: 0 0 8px var(--term-fg-glow);
}

.glow-pulse {
  animation: glowPulse 3s ease-in-out infinite;
}

@keyframes glowPulse {
  0%, 100% { text-shadow: 0 0 8px var(--term-fg-glow); }
  50% { text-shadow: 0 0 16px var(--term-fg-glow), 0 0 24px var(--term-fg-glow); }
}

/* ========================================
   FILTERS
   ======================================== */
.filters-section {
  margin-bottom: 28px;
}

.filter-line {
  margin-bottom: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  font-size: 12px;
}

.filter-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  background: transparent;
  color: var(--term-fg-dim);
  border: none;
  padding: 3px 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-btn:hover {
  color: var(--term-fg);
  text-shadow: 0 0 6px var(--term-fg-glow);
}

.filter-btn.active {
  color: var(--term-bg);
  background: var(--term-fg);
  text-shadow: none;
  font-weight: 600;
}

/* ========================================
   FEEDBACK LIST
   ======================================== */
.feedback-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}

.feedback-card {
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0 2px;
  position: relative;
}

.feedback-card:hover {
  text-shadow: 0 0 6px var(--term-fg-glow);
}

.feedback-card:hover .card-top-border,
.feedback-card:hover .card-bottom-border {
  color: var(--term-fg);
  text-shadow: 0 0 8px var(--term-fg-glow);
}

.feedback-card.pinned {
  border-left: 2px solid var(--term-fg);
  padding-left: 8px;
}

.card-top-border,
.card-bottom-border {
  color: var(--term-fg-dim);
  font-size: 11px;
  white-space: pre;
  overflow: hidden;
  transition: all 0.2s ease;
}

.card-row {
  font-size: 12px;
  padding: 1px 0;
  color: var(--term-fg-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-title {
  color: var(--term-fg);
  font-weight: 600;
  font-size: 13px;
  text-shadow: 0 0 4px var(--term-fg-glow);
  white-space: normal;
}

.card-divider {
  color: var(--term-fg-dim);
  opacity: 0.3;
}

.card-body {
  color: var(--term-fg-dim);
  opacity: 0.7;
  white-space: normal;
  font-size: 11px;
  line-height: 1.5;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.card-footer {
  font-size: 10px;
  opacity: 0.5;
  margin-top: 2px;
}

/* ========================================
   STATUS & TAG BADGES
   ======================================== */
.status-badge {
  font-size: 10px;
  font-weight: 600;
  margin-left: 6px;
}

.status-open { color: var(--term-cyan); text-shadow: 0 0 4px rgba(0, 212, 255, 0.4); }
.status-in_progress { color: var(--term-amber); text-shadow: 0 0 4px rgba(255, 176, 0, 0.4); }
.status-planned { color: #A78BFA; text-shadow: 0 0 4px rgba(167, 139, 250, 0.4); }
.status-completed { color: var(--term-green); text-shadow: 0 0 4px rgba(0, 255, 65, 0.4); }

.pin-badge {
  color: var(--term-fg);
  font-weight: 700;
  margin-left: 6px;
  text-shadow: 0 0 6px var(--term-fg-glow);
  font-size: 10px;
}

.tag-badge {
  font-size: 10px;
  font-weight: 600;
}

/* ========================================
   VOTE BUTTON
   ======================================== */
.vote-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  background: transparent;
  color: var(--term-fg-dim);
  border: 1px solid transparent;
  padding: 2px 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.vote-btn:hover {
  color: var(--term-fg);
  border-color: var(--term-fg-dim);
  text-shadow: 0 0 6px var(--term-fg-glow);
}

.vote-btn.voted {
  color: var(--term-fg);
  font-weight: 700;
  text-shadow: 0 0 10px var(--term-fg-glow), 0 0 20px var(--term-fg-glow);
  border-color: var(--term-fg);
  background: var(--term-fg-bg);
}

.inline-vote {
  margin-left: 8px;
}

/* ========================================
   NO RESULTS
   ======================================== */
.no-results {
  text-align: center;
  padding: 40px 0;
  color: var(--term-fg-dim);
  font-size: 13px;
}

/* ========================================
   TERMINAL FOOTER
   ======================================== */
.terminal-footer {
  text-align: center;
  color: var(--term-fg-dim);
  font-size: 11px;
  padding-top: 20px;
  border-top: 1px solid rgba(0, 255, 65, 0.1);
}

.terminal-page.amber-mode .terminal-footer {
  border-top-color: rgba(255, 176, 0, 0.1);
}

/* ========================================
   MODAL OVERLAY
   ======================================== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
}

@media (min-width: 768px) {
  .modal-overlay {
    padding: 40px;
    align-items: center;
  }
}

.modal-crt {
  position: relative;
  background: var(--term-bg);
  border: 2px solid var(--term-fg-dim);
  max-width: 700px;
  width: 100%;
  box-shadow: 0 0 30px var(--term-fg-glow), 0 0 60px rgba(0, 0, 0, 0.5);
  max-height: 85vh;
  overflow-y: auto;
}

@media (min-width: 768px) {
  .modal-crt {
    border-radius: 4px;
  }
}

.modal-content {
  position: relative;
  z-index: 1;
  padding: 20px;
}

@media (min-width: 768px) {
  .modal-content {
    padding: 24px;
  }
}

.modal-border {
  margin-bottom: 16px;
}

.modal-line {
  color: var(--term-fg-dim);
  font-size: 11px;
  white-space: pre;
  overflow: hidden;
}

.modal-title-line {
  color: var(--term-fg);
  font-weight: 700;
  font-size: 13px;
  text-shadow: 0 0 8px var(--term-fg-glow);
}

.double-top, .double-mid, .double-bottom {
  color: var(--term-fg);
  opacity: 0.6;
}

.modal-body-content {
  margin-bottom: 16px;
}

.detail-row {
  margin-bottom: 4px;
  font-size: 12px;
}

.label-text {
  color: var(--term-fg-dim);
  margin-right: 8px;
  font-weight: 600;
}

.detail-divider {
  color: var(--term-fg-dim);
  opacity: 0.3;
  margin: 16px 0;
  font-size: 11px;
}

.detail-title {
  color: var(--term-fg);
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 12px;
  text-shadow: 0 0 6px var(--term-fg-glow);
}

.detail-body {
  color: var(--term-fg-dim);
  font-size: 12px;
  line-height: 1.8;
}

/* ========================================
   COMMENTS
   ======================================== */
.comments-header {
  color: var(--term-fg);
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 12px;
  text-shadow: 0 0 4px var(--term-fg-glow);
}

.comments-list {
  margin-bottom: 16px;
}

.comment-entry {
  margin-bottom: 10px;
}

.comment-line,
.comment-reply {
  font-size: 11px;
  line-height: 1.6;
  color: var(--term-fg-dim);
}

.comment-reply {
  margin-top: 4px;
  padding-left: 8px;
}

.reply-indent {
  color: var(--term-fg-dim);
  opacity: 0.4;
}

.comment-time {
  color: var(--term-fg-dim);
  opacity: 0.5;
  margin-right: 4px;
}

.comment-author {
  color: var(--term-cyan);
  font-weight: 600;
  margin-right: 6px;
}

.comment-body {
  color: var(--term-fg-dim);
}

.comment-input {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

/* ========================================
   FORM INPUTS
   ======================================== */
.terminal-input {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  background: transparent;
  color: var(--term-fg);
  border: none;
  border-bottom: 1px solid var(--term-fg-dim);
  padding: 6px 4px;
  flex: 1;
  outline: none;
  caret-color: var(--term-fg);
  transition: border-color 0.2s ease;
}

.terminal-input::placeholder {
  color: var(--term-fg-dim);
  opacity: 0.3;
}

.terminal-input:focus {
  border-bottom-color: var(--term-fg);
  text-shadow: 0 0 4px var(--term-fg-glow);
}

.terminal-textarea {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  background: transparent;
  color: var(--term-fg);
  border: 1px solid var(--term-fg-dim);
  padding: 8px;
  width: 100%;
  outline: none;
  caret-color: var(--term-fg);
  resize: vertical;
  margin-top: 8px;
  transition: border-color 0.2s ease;
}

.terminal-textarea:focus {
  border-color: var(--term-fg);
  box-shadow: 0 0 8px var(--term-fg-glow);
}

/* ========================================
   SUBMIT FORM
   ======================================== */
.submit-form .form-row {
  margin-bottom: 16px;
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.category-options {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 4px;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.submit-confirm {
  border-color: var(--term-fg);
  font-weight: 600;
}

.submit-error {
  color: var(--term-red);
  font-size: 12px;
  margin-top: 8px;
  text-shadow: 0 0 6px rgba(255, 0, 64, 0.4);
}

.submit-success {
  color: var(--term-fg);
  font-size: 12px;
  margin-top: 8px;
  font-weight: 600;
  text-shadow: 0 0 8px var(--term-fg-glow);
}

.modal-close-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

/* ========================================
   SCROLLBAR STYLING
   ======================================== */
.terminal-page ::-webkit-scrollbar {
  width: 6px;
}

.terminal-page ::-webkit-scrollbar-track {
  background: var(--term-bg);
}

.terminal-page ::-webkit-scrollbar-thumb {
  background: var(--term-fg-dim);
  border-radius: 3px;
}

.terminal-page ::-webkit-scrollbar-thumb:hover {
  background: var(--term-fg);
}

.modal-crt::-webkit-scrollbar {
  width: 4px;
}

.modal-crt::-webkit-scrollbar-track {
  background: var(--term-bg);
}

.modal-crt::-webkit-scrollbar-thumb {
  background: var(--term-fg-dim);
}

/* ========================================
   RESPONSIVE
   ======================================== */
@media (max-width: 767px) {
  .terminal-page {
    font-size: 11px;
  }

  .typing-line {
    font-size: 14px;
  }

  .screen-content {
    padding: 16px 12px;
  }

  .stats-row {
    flex-direction: column;
    gap: 0;
  }

  .modal-crt {
    max-height: 90vh;
  }

  .brand-label {
    display: none;
  }

  .crt-bezel {
    padding: 8px;
    margin: 0;
  }
}

/* ========================================
   SELECTION STYLING
   ======================================== */
.terminal-page ::selection {
  background: var(--term-fg);
  color: var(--term-bg);
}
</style>
