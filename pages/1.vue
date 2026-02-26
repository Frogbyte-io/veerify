<template>
  <div :class="['fb-page', darkMode ? 'dark-mode' : 'light-mode']">
    <!-- Animated gradient background -->
    <div class="fb-bg">
      <div class="fb-bg-gradient"></div>
      <div class="fb-orb fb-orb-1"></div>
      <div class="fb-orb fb-orb-2"></div>
      <div class="fb-orb fb-orb-3"></div>
      <div class="fb-orb fb-orb-4"></div>
      <div class="fb-orb fb-orb-5"></div>
    </div>

    <!-- Main content -->
    <div class="fb-container">
      <!-- Header -->
      <header class="fb-header">
        <div class="fb-header-inner">
          <div class="fb-header-left">
            <div class="fb-logo">
              <div class="fb-logo-icon">V</div>
              <div class="fb-logo-text">
                <h1 class="fb-title">Veerify Feedback</h1>
                <p class="fb-subtitle">Help us build a better product. Share your ideas, report bugs, and vote on what matters most.</p>
              </div>
            </div>
          </div>
          <div class="fb-header-right">
            <button class="fb-theme-toggle" @click="toggleTheme" :title="darkMode ? 'Switch to light mode' : 'Switch to dark mode'">
              <svg v-if="darkMode" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
            <button class="fb-btn-submit" @click="showSubmitDialog = true">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Submit Feedback
            </button>
          </div>
        </div>
      </header>

      <!-- Stats Bar -->
      <div class="fb-stats">
        <div class="fb-stat-card" v-for="stat in statsData" :key="stat.label">
          <div class="fb-stat-icon" :style="{ background: stat.gradient }">
            <svg v-if="stat.icon === 'layers'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            <svg v-else-if="stat.icon === 'circle'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
            <svg v-else-if="stat.icon === 'loader'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            <svg v-else-if="stat.icon === 'check'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div class="fb-stat-info">
            <span class="fb-stat-value">{{ stat.value }}</span>
            <span class="fb-stat-label">{{ stat.label }}</span>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="fb-filters">
        <div class="fb-filters-row">
          <div class="fb-filter-pills">
            <button
              v-for="status in statusFilters"
              :key="status.value"
              :class="['fb-pill', selectedStatus === status.value ? 'fb-pill-active' : '']"
              @click="selectedStatus = status.value"
            >
              {{ status.label }}
            </button>
          </div>
          <div class="fb-filter-controls">
            <div class="fb-select-wrapper">
              <select v-model="selectedCategory" class="fb-select">
                <option value="all">All Categories</option>
                <option value="bug_report">Bug Report</option>
                <option value="feature_request">Feature Request</option>
                <option value="improvement">Improvement</option>
                <option value="question">Question</option>
              </select>
              <svg class="fb-select-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <button :class="['fb-sort-btn', sortBy === 'votes' ? 'fb-sort-active' : '']" @click="toggleSort">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/></svg>
              {{ sortBy === 'votes' ? 'Most Voted' : 'Newest' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Feedback List -->
      <div class="fb-list">
        <div
          v-for="item in filteredFeedback"
          :key="item.id"
          class="fb-card"
          @click="openDetail(item)"
        >
          <div class="fb-card-pin" v-if="item.isPinned">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 2C9.243 2 7 4.243 7 7c0 3.514 4.062 8.586 4.735 9.393a.35.35 0 0 0 .53 0C12.938 15.586 17 10.514 17 7c0-2.757-2.243-5-5-5zm0 7.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
            Pinned
          </div>
          <div class="fb-card-inner">
            <div class="fb-card-vote" @click.stop="toggleVote(item)">
              <div :class="['fb-vote-btn', item.voted ? 'fb-vote-active' : '']">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                <span class="fb-vote-count">{{ item.voteCount }}</span>
              </div>
            </div>
            <div class="fb-card-content">
              <div class="fb-card-header">
                <h3 class="fb-card-title">{{ item.title }}</h3>
                <div class="fb-card-badges">
                  <span :class="['fb-badge-status', 'fb-status-' + item.status]">{{ formatStatus(item.status) }}</span>
                  <span class="fb-badge-category" :style="{ '--cat-color': item.categoryColor }">
                    <span class="fb-badge-icon">{{ item.categoryIcon }}</span>
                    {{ formatCategory(item.category) }}
                  </span>
                  <span class="fb-badge-tag">{{ formatTag(item.tag) }}</span>
                </div>
              </div>
              <p class="fb-card-body">{{ item.body }}</p>
              <div class="fb-card-footer">
                <div class="fb-card-author">
                  <div class="fb-avatar">{{ item.authorName.charAt(0) }}</div>
                  <span class="fb-author-name">{{ item.authorName }}</span>
                  <span class="fb-card-date">{{ item.createdAt }}</span>
                </div>
                <div class="fb-card-comments">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {{ item.commentCount }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <footer class="fb-footer">
        <div class="fb-footer-inner">
          <span class="fb-footer-text">Powered by</span>
          <span class="fb-footer-brand">Veerify</span>
        </div>
      </footer>
    </div>

    <!-- Detail Modal -->
    <Transition name="fb-modal">
      <div v-if="selectedFeedback" class="fb-modal-overlay" @click.self="selectedFeedback = null">
        <div class="fb-modal">
          <button class="fb-modal-close" @click="selectedFeedback = null">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>

          <div class="fb-modal-body">
            <div class="fb-modal-top">
              <div class="fb-modal-vote" @click="toggleVote(selectedFeedback)">
                <div :class="['fb-vote-btn fb-vote-lg', selectedFeedback.voted ? 'fb-vote-active' : '']">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  <span class="fb-vote-count">{{ selectedFeedback.voteCount }}</span>
                  <span class="fb-vote-label">votes</span>
                </div>
              </div>
              <div class="fb-modal-info">
                <h2 class="fb-modal-title">{{ selectedFeedback.title }}</h2>
                <div class="fb-card-badges">
                  <span :class="['fb-badge-status', 'fb-status-' + selectedFeedback.status]">{{ formatStatus(selectedFeedback.status) }}</span>
                  <span class="fb-badge-category" :style="{ '--cat-color': selectedFeedback.categoryColor }">
                    <span class="fb-badge-icon">{{ selectedFeedback.categoryIcon }}</span>
                    {{ formatCategory(selectedFeedback.category) }}
                  </span>
                  <span class="fb-badge-tag">{{ formatTag(selectedFeedback.tag) }}</span>
                </div>
                <div class="fb-modal-meta">
                  <div class="fb-avatar">{{ selectedFeedback.authorName.charAt(0) }}</div>
                  <span class="fb-author-name">{{ selectedFeedback.authorName }}</span>
                  <span class="fb-card-date">{{ selectedFeedback.createdAt }}</span>
                </div>
              </div>
            </div>

            <div class="fb-modal-description">
              <p>{{ selectedFeedback.body }}</p>
            </div>

            <!-- Comments -->
            <div class="fb-comments-section">
              <h3 class="fb-comments-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Comments ({{ comments.length }})
              </h3>

              <div class="fb-comment" v-for="comment in comments" :key="comment.id">
                <div class="fb-comment-main">
                  <div class="fb-avatar fb-avatar-sm">{{ comment.authorName.charAt(0) }}</div>
                  <div class="fb-comment-body">
                    <div class="fb-comment-header">
                      <span class="fb-comment-author">{{ comment.authorName }}</span>
                      <span class="fb-comment-date">{{ comment.createdAt }}</span>
                    </div>
                    <p class="fb-comment-text">{{ comment.body }}</p>
                  </div>
                </div>
                <div class="fb-comment-reply" v-for="reply in comment.replies" :key="reply.id">
                  <div class="fb-avatar fb-avatar-sm">{{ reply.authorName.charAt(0) }}</div>
                  <div class="fb-comment-body">
                    <div class="fb-comment-header">
                      <span class="fb-comment-author">{{ reply.authorName }}</span>
                      <span class="fb-comment-date">{{ reply.createdAt }}</span>
                    </div>
                    <p class="fb-comment-text">{{ reply.body }}</p>
                  </div>
                </div>
              </div>

              <div class="fb-comment-input-wrapper">
                <div class="fb-avatar fb-avatar-sm">Y</div>
                <input type="text" class="fb-comment-input" placeholder="Write a comment..." v-model="newComment" @keyup.enter="addComment" />
                <button class="fb-comment-send" @click="addComment" :disabled="!newComment.trim()">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Submit Dialog -->
    <Transition name="fb-modal">
      <div v-if="showSubmitDialog" class="fb-modal-overlay" @click.self="showSubmitDialog = false">
        <div class="fb-modal fb-modal-submit">
          <button class="fb-modal-close" @click="showSubmitDialog = false">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>

          <div class="fb-modal-body">
            <h2 class="fb-modal-title fb-submit-title">Submit Feedback</h2>
            <p class="fb-submit-desc">Share your ideas, report bugs, or suggest improvements.</p>

            <div class="fb-form">
              <div class="fb-form-group">
                <label class="fb-label">Title</label>
                <input type="text" class="fb-input" placeholder="Brief summary of your feedback" v-model="submitForm.title" />
              </div>

              <div class="fb-form-row">
                <div class="fb-form-group fb-form-half">
                  <label class="fb-label">Category</label>
                  <div class="fb-select-wrapper">
                    <select v-model="submitForm.category" class="fb-select">
                      <option value="">Select category</option>
                      <option value="bug_report">Bug Report</option>
                      <option value="feature_request">Feature Request</option>
                      <option value="improvement">Improvement</option>
                      <option value="question">Question</option>
                    </select>
                    <svg class="fb-select-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </div>
                <div class="fb-form-group fb-form-half">
                  <label class="fb-label">Tag</label>
                  <div class="fb-select-wrapper">
                    <select v-model="submitForm.tag" class="fb-select">
                      <option value="">Select tag</option>
                      <option value="bug_report">Bug Report</option>
                      <option value="feature_request">Feature Request</option>
                      <option value="improvement">Improvement</option>
                    </select>
                    <svg class="fb-select-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </div>
              </div>

              <div class="fb-form-group">
                <label class="fb-label">Description</label>
                <textarea class="fb-textarea" rows="4" placeholder="Describe your feedback in detail..." v-model="submitForm.description"></textarea>
              </div>

              <div class="fb-form-row">
                <div class="fb-form-group fb-form-half">
                  <label class="fb-label">Your Name</label>
                  <input type="text" class="fb-input" placeholder="John Doe" v-model="submitForm.authorName" />
                </div>
                <div class="fb-form-group fb-form-half">
                  <label class="fb-label">Email</label>
                  <input type="email" class="fb-input" placeholder="john@example.com" v-model="submitForm.email" />
                </div>
              </div>

              <button class="fb-btn-gradient" @click="handleSubmit">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script>
export default {
  name: 'PublicFeedbackBoard',
  layout: false,

  data() {
    return {
      darkMode: true,
      selectedStatus: 'all',
      selectedCategory: 'all',
      sortBy: 'votes',
      selectedFeedback: null,
      showSubmitDialog: false,
      newComment: '',
      submitForm: {
        title: '',
        category: '',
        tag: '',
        description: '',
        authorName: '',
        email: ''
      },
      statusFilters: [
        { label: 'All', value: 'all' },
        { label: 'Open', value: 'open' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Planned', value: 'planned' },
        { label: 'Completed', value: 'completed' }
      ],
      statsData: [
        { label: 'Total', value: 47, icon: 'layers', gradient: 'linear-gradient(135deg, #8B5CF6, #6D28D9)' },
        { label: 'Open', value: 23, icon: 'circle', gradient: 'linear-gradient(135deg, #3B82F6, #1D4ED8)' },
        { label: 'In Progress', value: 12, icon: 'loader', gradient: 'linear-gradient(135deg, #F59E0B, #D97706)' },
        { label: 'Completed', value: 8, icon: 'check', gradient: 'linear-gradient(135deg, #10B981, #059669)' }
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
        {
          id: 3,
          authorName: 'Michael Brown',
          body: 'Would this also support system-level dark mode detection?',
          createdAt: '1 day ago',
          replies: []
        },
        {
          id: 4,
          authorName: 'Rachel Green',
          body: '+1 on this. The light theme is really harsh on the eyes at night.',
          createdAt: '2 days ago',
          replies: []
        }
      ],
      feedbackItems: [
        { id: 1, title: 'Add dark mode support for mobile app', body: 'The mobile app currently only supports light mode. Would love to see dark mode support to reduce eye strain during nighttime usage. This has been requested by many users in our community.', status: 'in_progress', category: 'feature_request', categoryColor: '#8B5CF6', categoryIcon: '\u2726', tag: 'improvement', voteCount: 142, commentCount: 23, authorName: 'Sarah Chen', createdAt: '2 days ago', isPinned: true, voted: false },
        { id: 2, title: 'Login page crashes on Safari 17', body: 'When trying to log in using Safari 17 on macOS Sonoma, the page becomes unresponsive after entering credentials. Console shows a WebKit rendering error.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', categoryIcon: '\u26A1', tag: 'bug_report', voteCount: 89, commentCount: 15, authorName: 'Marcus Johnson', createdAt: '5 hours ago', isPinned: false, voted: false },
        { id: 3, title: 'Implement webhook notifications', body: 'Would be great to have webhook support so we can integrate feedback events with our internal tools like Slack and Discord.', status: 'planned', category: 'feature_request', categoryColor: '#8B5CF6', categoryIcon: '\u2726', tag: 'feature_request', voteCount: 76, commentCount: 8, authorName: 'Alex Rivera', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 4, title: 'Export feedback data to CSV', body: 'Need ability to export all feedback data including votes and comments to CSV format for reporting and analysis purposes.', status: 'completed', category: 'feature_request', categoryColor: '#8B5CF6', categoryIcon: '\u2726', tag: 'feature_request', voteCount: 134, commentCount: 19, authorName: 'Priya Patel', createdAt: '1 week ago', isPinned: false, voted: false },
        { id: 5, title: 'Improve search performance', body: 'Search results take too long to load when there are more than 500 feedback items. The current implementation seems to be doing full-text search without proper indexing.', status: 'in_progress', category: 'improvement', categoryColor: '#F59E0B', categoryIcon: '\u2B06', tag: 'improvement', voteCount: 67, commentCount: 11, authorName: "James O'Connor", createdAt: '3 days ago', isPinned: false, voted: false },
        { id: 6, title: 'Add keyboard shortcuts', body: 'Power users would benefit from keyboard shortcuts for common actions like upvoting (U), navigating between items (J/K), and opening details (Enter).', status: 'open', category: 'feature_request', categoryColor: '#8B5CF6', categoryIcon: '\u2726', tag: 'feature_request', voteCount: 45, commentCount: 6, authorName: 'Yuki Tanaka', createdAt: '4 days ago', isPinned: false, voted: false },
        { id: 7, title: 'Email notifications not delivered', body: 'Several users report not receiving email notifications for feedback updates. This affects both verification emails and status change notifications.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', categoryIcon: '\u26A1', tag: 'bug_report', voteCount: 93, commentCount: 31, authorName: 'Emma Wilson', createdAt: '6 hours ago', isPinned: true, voted: false },
        { id: 8, title: 'Multi-language support', body: 'As our user base grows internationally, we need support for multiple languages. Starting with Spanish, French, German, and Japanese would cover most of our users.', status: 'planned', category: 'feature_request', categoryColor: '#8B5CF6', categoryIcon: '\u2726', tag: 'feature_request', voteCount: 56, commentCount: 14, authorName: 'Carlos Mendez', createdAt: '5 days ago', isPinned: false, voted: false },
        { id: 9, title: 'Dashboard loading time too slow', body: 'The main dashboard takes over 5 seconds to load on average. Profiling shows excessive API calls on initial render that could be batched.', status: 'in_progress', category: 'bug_report', categoryColor: '#EF4444', categoryIcon: '\u26A1', tag: 'bug_report', voteCount: 78, commentCount: 9, authorName: 'Nina Kowalski', createdAt: '2 days ago', isPinned: false, voted: false },
        { id: 10, title: 'Add rich text editor for feedback', body: 'Currently feedback only supports plain text. A rich text editor with markdown support, code blocks, and image attachments would greatly improve feedback quality.', status: 'open', category: 'feature_request', categoryColor: '#8B5CF6', categoryIcon: '\u2726', tag: 'feature_request', voteCount: 112, commentCount: 17, authorName: 'David Kim', createdAt: '1 day ago', isPinned: false, voted: false },
        { id: 11, title: 'Broken image uploads on Firefox', body: 'Image uploads fail silently on Firefox 121+. The upload appears to complete but the image never renders in the feedback post.', status: 'open', category: 'bug_report', categoryColor: '#EF4444', categoryIcon: '\u26A1', tag: 'bug_report', voteCount: 34, commentCount: 7, authorName: 'Lisa Zhang', createdAt: '8 hours ago', isPinned: false, voted: false },
        { id: 12, title: 'API rate limiting improvements', body: 'The current rate limiting is too aggressive for legitimate API users. Suggest implementing tiered rate limits based on authentication level and usage patterns.', status: 'completed', category: 'improvement', categoryColor: '#F59E0B', categoryIcon: '\u2B06', tag: 'improvement', voteCount: 41, commentCount: 5, authorName: 'Tom Anderson', createdAt: '2 weeks ago', isPinned: false, voted: false }
      ]
    }
  },

  computed: {
    filteredFeedback() {
      var items = this.feedbackItems.slice()

      if (this.selectedStatus !== 'all') {
        items = items.filter(function (item) {
          return item.status === this.selectedStatus
        }.bind(this))
      }

      if (this.selectedCategory !== 'all') {
        items = items.filter(function (item) {
          return item.category === this.selectedCategory
        }.bind(this))
      }

      // Pinned items first
      items.sort(function (a, b) {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return 0
      })

      // Then sort by votes or date within pinned/unpinned groups
      var sortBy = this.sortBy
      items.sort(function (a, b) {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
        if (sortBy === 'votes') {
          return b.voteCount - a.voteCount
        }
        return b.id - a.id
      })

      return items
    }
  },

  methods: {
    toggleTheme() {
      this.darkMode = !this.darkMode
    },

    toggleSort() {
      this.sortBy = this.sortBy === 'votes' ? 'newest' : 'votes'
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
      this.selectedFeedback = item
    },

    formatStatus(status) {
      var map = {
        open: 'Open',
        in_progress: 'In Progress',
        planned: 'Planned',
        completed: 'Completed'
      }
      return map[status] || status
    },

    formatCategory(cat) {
      var map = {
        bug_report: 'Bug Report',
        feature_request: 'Feature Request',
        improvement: 'Improvement',
        question: 'Question'
      }
      return map[cat] || cat
    },

    formatTag(tag) {
      var map = {
        bug_report: 'Bug',
        feature_request: 'Feature',
        improvement: 'Improvement'
      }
      return map[tag] || tag
    },

    addComment() {
      if (!this.newComment.trim()) return
      this.comments.push({
        id: Date.now(),
        authorName: 'You',
        body: this.newComment,
        createdAt: 'Just now',
        replies: []
      })
      this.newComment = ''
    },

    handleSubmit() {
      if (!this.submitForm.title.trim()) return
      this.feedbackItems.unshift({
        id: Date.now(),
        title: this.submitForm.title,
        body: this.submitForm.description,
        status: 'open',
        category: this.submitForm.category || 'feature_request',
        categoryColor: '#8B5CF6',
        categoryIcon: '\u2726',
        tag: this.submitForm.tag || 'feature_request',
        voteCount: 0,
        commentCount: 0,
        authorName: this.submitForm.authorName || 'Anonymous',
        createdAt: 'Just now',
        isPinned: false,
        voted: false
      })
      this.submitForm = { title: '', category: '', tag: '', description: '', authorName: '', email: '' }
      this.showSubmitDialog = false
    }
  }
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');

/* ==========================================
   CSS Custom Properties
   ========================================== */
.dark-mode {
  --fb-bg: #0a0a1a;
  --fb-surface: rgba(255, 255, 255, 0.05);
  --fb-surface-hover: rgba(255, 255, 255, 0.08);
  --fb-surface-strong: rgba(255, 255, 255, 0.1);
  --fb-border: rgba(255, 255, 255, 0.1);
  --fb-border-light: rgba(255, 255, 255, 0.06);
  --fb-text: #f0f0f5;
  --fb-text-secondary: rgba(240, 240, 245, 0.6);
  --fb-text-muted: rgba(240, 240, 245, 0.4);
  --fb-glass-bg: rgba(255, 255, 255, 0.06);
  --fb-glass-border: rgba(255, 255, 255, 0.12);
  --fb-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  --fb-glass-highlight: rgba(255, 255, 255, 0.08);
  --fb-overlay: rgba(0, 0, 0, 0.6);
  --fb-input-bg: rgba(255, 255, 255, 0.06);
  --fb-accent: #a78bfa;
  --fb-accent-glow: rgba(167, 139, 250, 0.3);
}

.light-mode {
  --fb-bg: #f5f0ff;
  --fb-surface: rgba(255, 255, 255, 0.6);
  --fb-surface-hover: rgba(255, 255, 255, 0.75);
  --fb-surface-strong: rgba(255, 255, 255, 0.85);
  --fb-border: rgba(0, 0, 0, 0.08);
  --fb-border-light: rgba(0, 0, 0, 0.05);
  --fb-text: #1a1a2e;
  --fb-text-secondary: rgba(26, 26, 46, 0.65);
  --fb-text-muted: rgba(26, 26, 46, 0.4);
  --fb-glass-bg: rgba(255, 255, 255, 0.55);
  --fb-glass-border: rgba(255, 255, 255, 0.8);
  --fb-glass-shadow: 0 8px 32px rgba(100, 60, 180, 0.1);
  --fb-glass-highlight: rgba(255, 255, 255, 0.9);
  --fb-overlay: rgba(100, 60, 180, 0.2);
  --fb-input-bg: rgba(255, 255, 255, 0.7);
  --fb-accent: #7c3aed;
  --fb-accent-glow: rgba(124, 58, 237, 0.2);
}

/* ==========================================
   Reset & Base
   ========================================== */
.fb-page {
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  font-family: 'DM Sans', -apple-system, sans-serif;
  color: var(--fb-text);
  transition: color 0.3s ease;
}

.fb-page *,
.fb-page *::before,
.fb-page *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ==========================================
   Animated Gradient Background
   ========================================== */
.fb-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.fb-bg-gradient {
  position: absolute;
  inset: -50%;
  width: 200%;
  height: 200%;
  background: conic-gradient(
    from 0deg at 50% 50%,
    #6d28d9 0deg,
    #0d9488 60deg,
    #ec4899 120deg,
    #f97316 180deg,
    #8b5cf6 240deg,
    #14b8a6 300deg,
    #6d28d9 360deg
  );
  animation: fbGradientRotate 20s linear infinite;
  filter: blur(80px) saturate(1.5);
  opacity: 0.4;
}

.light-mode .fb-bg-gradient {
  opacity: 0.25;
  filter: blur(100px) saturate(1.2);
}

@keyframes fbGradientRotate {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.1); }
  100% { transform: rotate(360deg) scale(1); }
}

/* Floating orbs */
.fb-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.35;
}

.light-mode .fb-orb {
  opacity: 0.2;
}

.fb-orb-1 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #8b5cf6, transparent 70%);
  top: 10%;
  left: 10%;
  animation: fbFloat1 15s ease-in-out infinite;
}

.fb-orb-2 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, #ec4899, transparent 70%);
  top: 60%;
  right: 10%;
  animation: fbFloat2 18s ease-in-out infinite;
}

.fb-orb-3 {
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, #14b8a6, transparent 70%);
  bottom: 10%;
  left: 30%;
  animation: fbFloat3 12s ease-in-out infinite;
}

.fb-orb-4 {
  width: 250px;
  height: 250px;
  background: radial-gradient(circle, #f97316, transparent 70%);
  top: 30%;
  right: 30%;
  animation: fbFloat4 20s ease-in-out infinite;
}

.fb-orb-5 {
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, #6d28d9, transparent 70%);
  top: 50%;
  left: 60%;
  animation: fbFloat5 16s ease-in-out infinite;
}

@keyframes fbFloat1 {
  0%, 100% { transform: translate(0, 0); }
  33% { transform: translate(60px, -40px); }
  66% { transform: translate(-30px, 50px); }
}

@keyframes fbFloat2 {
  0%, 100% { transform: translate(0, 0); }
  33% { transform: translate(-50px, 30px); }
  66% { transform: translate(40px, -60px); }
}

@keyframes fbFloat3 {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(70px, -30px); }
}

@keyframes fbFloat4 {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(-40px, -40px); }
  50% { transform: translate(20px, 60px); }
  75% { transform: translate(50px, -20px); }
}

@keyframes fbFloat5 {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-60px, 40px); }
}

/* ==========================================
   Container
   ========================================== */
.fb-container {
  position: relative;
  z-index: 1;
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}

/* ==========================================
   Header
   ========================================== */
.fb-header {
  margin-bottom: 32px;
}

.fb-header-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.fb-logo {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.fb-logo-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: 24px;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
}

.fb-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 28px;
  line-height: 1.2;
  background: linear-gradient(135deg, var(--fb-text), var(--fb-accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.fb-subtitle {
  font-size: 14px;
  color: var(--fb-text-secondary);
  margin-top: 4px;
  max-width: 480px;
  line-height: 1.5;
}

.fb-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.fb-theme-toggle {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--fb-glass-border);
  background: var(--fb-glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--fb-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.fb-theme-toggle:hover {
  background: var(--fb-surface-hover);
  transform: scale(1.05);
}

.fb-btn-submit {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 14px;
  border: 1px solid var(--fb-glass-border);
  background: var(--fb-glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--fb-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.fb-btn-submit::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(236, 72, 153, 0.15));
  opacity: 0;
  transition: opacity 0.3s ease;
}

.fb-btn-submit:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px var(--fb-accent-glow);
}

.fb-btn-submit:hover::before {
  opacity: 1;
}

/* ==========================================
   Stats Bar
   ========================================== */
.fb-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.fb-stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: var(--fb-glass-bg);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--fb-glass-border);
  box-shadow: var(--fb-glass-shadow);
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.fb-stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--fb-glass-highlight), transparent);
}

.fb-stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--fb-glass-shadow), 0 0 20px var(--fb-accent-glow);
}

.fb-stat-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}

.fb-stat-info {
  display: flex;
  flex-direction: column;
}

.fb-stat-value {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
}

.fb-stat-label {
  font-size: 12px;
  color: var(--fb-text-secondary);
  margin-top: 2px;
}

/* ==========================================
   Filters
   ========================================== */
.fb-filters {
  margin-bottom: 20px;
}

.fb-filters-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.fb-filter-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.fb-pill {
  padding: 7px 16px;
  border-radius: 100px;
  border: 1px solid var(--fb-glass-border);
  background: var(--fb-glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--fb-text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.fb-pill:hover {
  background: var(--fb-surface-hover);
  color: var(--fb-text);
}

.fb-pill-active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(236, 72, 153, 0.15));
  border-color: rgba(139, 92, 246, 0.4);
  color: var(--fb-accent);
  box-shadow: 0 0 16px var(--fb-accent-glow);
}

.fb-filter-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fb-select-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.fb-select {
  appearance: none;
  padding: 7px 32px 7px 14px;
  border-radius: 100px;
  border: 1px solid var(--fb-glass-border);
  background: var(--fb-glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--fb-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.3s ease;
  outline: none;
}

.fb-select:hover,
.fb-select:focus {
  background: var(--fb-surface-hover);
  border-color: var(--fb-accent);
}

.fb-select option {
  background: #1a1a2e;
  color: #f0f0f5;
}

.light-mode .fb-select option {
  background: #fff;
  color: #1a1a2e;
}

.fb-select-arrow {
  position: absolute;
  right: 10px;
  pointer-events: none;
  color: var(--fb-text-muted);
}

.fb-sort-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 100px;
  border: 1px solid var(--fb-glass-border);
  background: var(--fb-glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--fb-text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.fb-sort-btn:hover {
  background: var(--fb-surface-hover);
  color: var(--fb-text);
}

.fb-sort-active {
  color: var(--fb-accent);
  border-color: rgba(139, 92, 246, 0.3);
}

/* ==========================================
   Feedback List
   ========================================== */
.fb-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 48px;
}

.fb-card {
  position: relative;
  border-radius: 20px;
  background: var(--fb-glass-bg);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--fb-glass-border);
  box-shadow: var(--fb-glass-shadow);
  cursor: pointer;
  transition: all 0.3s ease;
  overflow: hidden;
}

.fb-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--fb-glass-highlight), transparent);
}

.fb-card:hover {
  transform: translateY(-2px);
  background: var(--fb-surface-hover);
  box-shadow: var(--fb-glass-shadow), 0 0 30px var(--fb-accent-glow);
  border-color: rgba(139, 92, 246, 0.2);
}

.fb-card-pin {
  position: absolute;
  top: 10px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--fb-accent);
  font-weight: 500;
  opacity: 0.8;
}

.fb-card-inner {
  display: flex;
  gap: 16px;
  padding: 18px 20px;
}

.fb-card-vote {
  flex-shrink: 0;
}

.fb-vote-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 12px 8px;
  border-radius: 14px;
  border: 1px solid var(--fb-border);
  background: var(--fb-surface);
  transition: all 0.3s ease;
  min-width: 54px;
}

.fb-vote-btn:hover {
  border-color: var(--fb-accent);
  background: rgba(139, 92, 246, 0.1);
}

.fb-vote-active {
  border-color: var(--fb-accent) !important;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(236, 72, 153, 0.1)) !important;
  color: var(--fb-accent);
  box-shadow: 0 0 16px var(--fb-accent-glow);
}

.fb-vote-active svg {
  color: var(--fb-accent);
}

.fb-vote-count {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 15px;
}

.fb-vote-lg {
  padding: 14px 20px 12px;
  min-width: 80px;
  border-radius: 18px;
}

.fb-vote-lg .fb-vote-count {
  font-size: 22px;
}

.fb-vote-label {
  font-size: 11px;
  color: var(--fb-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.fb-card-content {
  flex: 1;
  min-width: 0;
}

.fb-card-header {
  margin-bottom: 6px;
}

.fb-card-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: 16px;
  line-height: 1.35;
  margin-bottom: 8px;
}

.fb-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.fb-badge-status {
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fb-status-open {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.light-mode .fb-status-open {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  border-color: rgba(59, 130, 246, 0.2);
}

.fb-status-in_progress {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.light-mode .fb-status-in_progress {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
  border-color: rgba(245, 158, 11, 0.2);
}

.fb-status-planned {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, 0.25);
}

.light-mode .fb-status-planned {
  background: rgba(139, 92, 246, 0.1);
  color: #7c3aed;
  border-color: rgba(139, 92, 246, 0.2);
}

.fb-status-completed {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.light-mode .fb-status-completed {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border-color: rgba(16, 185, 129, 0.2);
}

.fb-badge-category {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 500;
  background: color-mix(in srgb, var(--cat-color) 15%, transparent);
  color: var(--cat-color);
  border: 1px solid color-mix(in srgb, var(--cat-color) 25%, transparent);
}

.fb-badge-icon {
  font-size: 10px;
}

.fb-badge-tag {
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 500;
  background: var(--fb-surface);
  color: var(--fb-text-secondary);
  border: 1px solid var(--fb-border-light);
}

.fb-card-body {
  font-size: 13px;
  color: var(--fb-text-secondary);
  line-height: 1.55;
  margin: 8px 0 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fb-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.fb-card-author {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fb-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: #fff;
  flex-shrink: 0;
}

.fb-avatar-sm {
  width: 28px;
  height: 28px;
  font-size: 11px;
}

.fb-author-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--fb-text-secondary);
}

.fb-card-date {
  font-size: 12px;
  color: var(--fb-text-muted);
}

.fb-card-comments {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--fb-text-muted);
}

/* ==========================================
   Modal
   ========================================== */
.fb-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--fb-overlay);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.fb-modal {
  position: relative;
  width: 100%;
  max-width: 680px;
  max-height: 85vh;
  overflow-y: auto;
  border-radius: 24px;
  background: var(--fb-glass-bg);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  border: 1px solid var(--fb-glass-border);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4), inset 0 1px 0 var(--fb-glass-highlight);
}

.light-mode .fb-modal {
  background: rgba(255, 255, 255, 0.75);
  box-shadow: 0 24px 80px rgba(100, 60, 180, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.fb-modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--fb-border);
  background: var(--fb-surface);
  color: var(--fb-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  z-index: 2;
}

.fb-modal-close:hover {
  background: var(--fb-surface-hover);
  color: var(--fb-text);
}

.fb-modal-body {
  padding: 32px;
}

.fb-modal-top {
  display: flex;
  gap: 20px;
  margin-bottom: 24px;
}

.fb-modal-vote {
  flex-shrink: 0;
}

.fb-modal-info {
  flex: 1;
  min-width: 0;
}

.fb-modal-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 1.3;
  margin-bottom: 10px;
}

.fb-modal-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.fb-modal-description {
  padding: 20px;
  border-radius: 16px;
  background: var(--fb-surface);
  border: 1px solid var(--fb-border-light);
  margin-bottom: 28px;
}

.fb-modal-description p {
  font-size: 14px;
  line-height: 1.7;
  color: var(--fb-text-secondary);
}

/* ==========================================
   Comments
   ========================================== */
.fb-comments-section {
  border-top: 1px solid var(--fb-border-light);
  padding-top: 24px;
}

.fb-comments-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 20px;
  color: var(--fb-text);
}

.fb-comment {
  margin-bottom: 16px;
}

.fb-comment-main {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}

.fb-comment-reply {
  display: flex;
  gap: 12px;
  margin-left: 40px;
  padding-left: 16px;
  border-left: 2px solid var(--fb-border-light);
  margin-bottom: 8px;
}

.fb-comment-body {
  flex: 1;
  min-width: 0;
}

.fb-comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.fb-comment-author {
  font-size: 13px;
  font-weight: 600;
  color: var(--fb-text);
}

.fb-comment-date {
  font-size: 11px;
  color: var(--fb-text-muted);
}

.fb-comment-text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--fb-text-secondary);
}

.fb-comment-input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--fb-input-bg);
  border: 1px solid var(--fb-border);
  transition: border-color 0.3s ease;
}

.fb-comment-input-wrapper:focus-within {
  border-color: var(--fb-accent);
}

.fb-comment-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--fb-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  outline: none;
}

.fb-comment-input::placeholder {
  color: var(--fb-text-muted);
}

.fb-comment-send {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.fb-comment-send:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
}

.fb-comment-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ==========================================
   Submit Dialog
   ========================================== */
.fb-modal-submit {
  max-width: 560px;
}

.fb-submit-title {
  margin-bottom: 4px;
}

.fb-submit-desc {
  font-size: 14px;
  color: var(--fb-text-secondary);
  margin-bottom: 24px;
}

.fb-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.fb-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fb-form-row {
  display: flex;
  gap: 12px;
}

.fb-form-half {
  flex: 1;
}

.fb-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--fb-text-secondary);
}

.fb-input {
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--fb-border);
  background: var(--fb-input-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--fb-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 14px;
  outline: none;
  transition: all 0.3s ease;
  width: 100%;
}

.fb-input:focus {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-glow);
}

.fb-input::placeholder {
  color: var(--fb-text-muted);
}

.fb-textarea {
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--fb-border);
  background: var(--fb-input-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--fb-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 14px;
  outline: none;
  resize: vertical;
  transition: all 0.3s ease;
  width: 100%;
  min-height: 100px;
}

.fb-textarea:focus {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-glow);
}

.fb-textarea::placeholder {
  color: var(--fb-text-muted);
}

.fb-btn-gradient {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
  color: #fff;
  font-family: 'DM Sans', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-top: 4px;
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.35);
}

.fb-btn-gradient:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px rgba(139, 92, 246, 0.5);
}

/* ==========================================
   Footer
   ========================================== */
.fb-footer {
  text-align: center;
  padding: 24px 0;
}

.fb-footer-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 100px;
  background: var(--fb-glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--fb-glass-border);
}

.fb-footer-text {
  font-size: 13px;
  color: var(--fb-text-muted);
}

.fb-footer-brand {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 14px;
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ==========================================
   Modal Transitions
   ========================================== */
.fb-modal-enter-active,
.fb-modal-leave-active {
  transition: all 0.3s ease;
}

.fb-modal-enter-active .fb-modal,
.fb-modal-leave-active .fb-modal {
  transition: all 0.3s ease;
}

.fb-modal-enter-from,
.fb-modal-leave-to {
  opacity: 0;
}

.fb-modal-enter-from .fb-modal,
.fb-modal-leave-to .fb-modal {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

/* ==========================================
   Scrollbar
   ========================================== */
.fb-modal::-webkit-scrollbar {
  width: 6px;
}

.fb-modal::-webkit-scrollbar-track {
  background: transparent;
}

.fb-modal::-webkit-scrollbar-thumb {
  background: var(--fb-border);
  border-radius: 3px;
}

.fb-modal::-webkit-scrollbar-thumb:hover {
  background: var(--fb-text-muted);
}

/* ==========================================
   Responsive
   ========================================== */
@media (max-width: 768px) {
  .fb-container {
    padding: 20px 14px 40px;
  }

  .fb-header-inner {
    flex-direction: column;
    gap: 16px;
  }

  .fb-header-right {
    width: 100%;
    justify-content: flex-end;
  }

  .fb-stats {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .fb-filters-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .fb-filter-controls {
    width: 100%;
    justify-content: space-between;
  }

  .fb-card-inner {
    padding: 14px;
    gap: 12px;
  }

  .fb-card-title {
    font-size: 15px;
  }

  .fb-modal-overlay {
    padding: 12px;
    align-items: flex-end;
  }

  .fb-modal {
    max-height: 90vh;
    border-radius: 20px 20px 0 0;
  }

  .fb-modal-body {
    padding: 24px 20px;
  }

  .fb-modal-top {
    flex-direction: column;
    gap: 16px;
  }

  .fb-modal-title {
    font-size: 19px;
  }

  .fb-form-row {
    flex-direction: column;
    gap: 16px;
  }
}

@media (max-width: 480px) {
  .fb-stats {
    grid-template-columns: 1fr 1fr;
  }

  .fb-stat-card {
    padding: 12px;
  }

  .fb-stat-value {
    font-size: 18px;
  }

  .fb-title {
    font-size: 22px;
  }

  .fb-logo-icon {
    width: 44px;
    height: 44px;
    font-size: 20px;
  }

  .fb-card-badges {
    gap: 4px;
  }

  .fb-badge-status,
  .fb-badge-category,
  .fb-badge-tag {
    font-size: 10px;
    padding: 2px 8px;
  }
}
</style>
