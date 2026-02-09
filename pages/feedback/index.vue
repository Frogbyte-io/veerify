<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold text-foreground">Feedback</h1>
            <p class="text-muted-foreground">Manage and respond to user feedback and feature requests</p>
          </div>
          <button
            class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add Feedback
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-card rounded-lg border border-border p-6 mb-6">
        <div class="flex flex-wrap items-center gap-4">
          <div>
            <label class="block text-sm text-muted-foreground mb-1">Status</label>
            <select class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground">
              <option>All Status</option>
              <option>Open</option>
              <option>In Progress</option>
              <option>Planned</option>
              <option>Completed</option>
              <option>Rejected</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-muted-foreground mb-1">Category</label>
            <select class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground">
              <option>All Categories</option>
              <option>Feature Request</option>
              <option>Bug Report</option>
              <option>Improvement</option>
              <option>Integration</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-muted-foreground mb-1">Sort By</label>
            <select class="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground">
              <option>Most Recent</option>
              <option>Most Popular</option>
              <option>Oldest First</option>
              <option>Most Comments</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="block text-sm text-muted-foreground mb-1">Search</label>
            <div class="relative">
              <Icon
                name="lucide:search"
                class="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search feedback..."
                class="w-full pl-10 pr-4 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Feedback Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-card p-6 rounded-lg border border-border">
          <div class="flex items-center">
            <Icon name="lucide:message-square" class="w-8 h-8 text-blue-600 dark:text-blue-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">Total Feedback</p>
              <p class="text-2xl font-bold text-card-foreground">247</p>
            </div>
          </div>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border">
          <div class="flex items-center">
            <Icon name="lucide:clock" class="w-8 h-8 text-orange-600 dark:text-orange-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">Open</p>
              <p class="text-2xl font-bold text-card-foreground">89</p>
            </div>
          </div>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border">
          <div class="flex items-center">
            <Icon name="lucide:play" class="w-8 h-8 text-blue-600 dark:text-blue-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">In Progress</p>
              <p class="text-2xl font-bold text-card-foreground">34</p>
            </div>
          </div>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border">
          <div class="flex items-center">
            <Icon name="lucide:check-circle" class="w-8 h-8 text-green-600 dark:text-green-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">Completed</p>
              <p class="text-2xl font-bold text-card-foreground">124</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Feedback List -->
      <div class="bg-card rounded-lg border border-border">
        <div class="p-6 border-b border-border">
          <h2 class="text-lg font-semibold text-card-foreground">Recent Feedback</h2>
        </div>
        <div class="divide-y divide-border">
          <!-- Feedback Item 1 -->
          <div class="p-6 hover:bg-muted transition-colors">
            <div class="flex items-start space-x-4">
              <div class="flex flex-col items-center space-y-2">
                <button class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors">
                  <Icon name="lucide:chevron-up" class="w-4 h-4 text-muted-foreground" />
                  <span class="text-sm font-medium text-card-foreground">45</span>
                </button>
              </div>
              <div class="flex-1">
                <div class="flex items-start justify-between">
                  <div>
                    <h3 class="text-lg font-medium text-card-foreground mb-2">Dark mode support</h3>
                    <p class="text-muted-foreground mb-3">
                      It would be great to have a dark mode option for better usability during night hours. Many users
                      have requested this feature.
                    </p>
                    <div class="flex items-center space-x-4 text-sm text-muted-foreground">
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:user" class="w-4 h-4" />
                        <span>John Doe</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:calendar" class="w-4 h-4" />
                        <span>2 days ago</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:message-circle" class="w-4 h-4" />
                        <span>12 comments</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center space-x-2">
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                    >
                      In Progress
                    </span>
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                    >
                      Feature Request
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Feedback Item 2 -->
          <div class="p-6 hover:bg-muted transition-colors">
            <div class="flex items-start space-x-4">
              <div class="flex flex-col items-center space-y-2">
                <button class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors">
                  <Icon name="lucide:chevron-up" class="w-4 h-4 text-muted-foreground" />
                  <span class="text-sm font-medium text-card-foreground">32</span>
                </button>
              </div>
              <div class="flex-1">
                <div class="flex items-start justify-between">
                  <div>
                    <h3 class="text-lg font-medium text-card-foreground mb-2">Mobile app for iOS and Android</h3>
                    <p class="text-muted-foreground mb-3">
                      A native mobile application would make it much easier to submit and track feedback on the go.
                    </p>
                    <div class="flex items-center space-x-4 text-sm text-muted-foreground">
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:user" class="w-4 h-4" />
                        <span>Alice Smith</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:calendar" class="w-4 h-4" />
                        <span>5 days ago</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:message-circle" class="w-4 h-4" />
                        <span>8 comments</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center space-x-2">
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                    >
                      Planned
                    </span>
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                    >
                      Feature Request
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Feedback Item 3 -->
          <div class="p-6 hover:bg-muted transition-colors">
            <div class="flex items-start space-x-4">
              <div class="flex flex-col items-center space-y-2">
                <button class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors">
                  <Icon name="lucide:chevron-up" class="w-4 h-4 text-muted-foreground" />
                  <span class="text-sm font-medium text-card-foreground">28</span>
                </button>
              </div>
              <div class="flex-1">
                <div class="flex items-start justify-between">
                  <div>
                    <h3 class="text-lg font-medium text-card-foreground mb-2">Email notifications for status updates</h3>
                    <p class="text-muted-foreground mb-3">
                      Users should receive email notifications when the status of their submitted feedback changes.
                    </p>
                    <div class="flex items-center space-x-4 text-sm text-muted-foreground">
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:user" class="w-4 h-4" />
                        <span>Bob Johnson</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:calendar" class="w-4 h-4" />
                        <span>1 week ago</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:message-circle" class="w-4 h-4" />
                        <span>15 comments</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center space-x-2">
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground"
                    >
                      Under Review
                    </span>
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                    >
                      Improvement
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Feedback Item 4 -->
          <div class="p-6 hover:bg-muted transition-colors">
            <div class="flex items-start space-x-4">
              <div class="flex flex-col items-center space-y-2">
                <button class="flex flex-col items-center p-2 rounded-lg hover:bg-accent transition-colors">
                  <Icon name="lucide:chevron-up" class="w-4 h-4 text-muted-foreground" />
                  <span class="text-sm font-medium text-card-foreground">19</span>
                </button>
              </div>
              <div class="flex-1">
                <div class="flex items-start justify-between">
                  <div>
                    <h3 class="text-lg font-medium text-card-foreground mb-2">Search functionality is slow</h3>
                    <p class="text-muted-foreground mb-3">
                      The search feature takes too long to return results, especially when searching through large
                      amounts of feedback.
                    </p>
                    <div class="flex items-center space-x-4 text-sm text-muted-foreground">
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:user" class="w-4 h-4" />
                        <span>Sarah Wilson</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:calendar" class="w-4 h-4" />
                        <span>3 days ago</span>
                      </div>
                      <div class="flex items-center space-x-1">
                        <Icon name="lucide:message-circle" class="w-4 h-4" />
                        <span>6 comments</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center space-x-2">
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                    >
                      Bug Report
                    </span>
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                    >
                      High Priority
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div class="p-6 border-t border-border">
          <div class="flex items-center justify-between">
            <div class="text-sm text-muted-foreground">Showing 1 to 10 of 247 results</div>
            <div class="flex items-center space-x-2">
              <button class="px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50" disabled>
                Previous
              </button>
              <button class="px-3 py-2 text-sm bg-blue-600 text-white rounded-md">1</button>
              <button class="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">2</button>
              <button class="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">3</button>
              <button class="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>
