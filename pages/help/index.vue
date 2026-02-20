<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-foreground">Help Center</h1>
        <p class="text-muted-foreground">Find answers to your questions and get support for Veerify</p>
      </div>

      <!-- Search Bar -->
      <div class="mb-8">
        <div class="relative max-w-md">
          <Icon
            name="lucide:search"
            class="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search help articles..."
            class="w-full pl-10 pr-4 py-3 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-card p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:book-open" class="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 class="font-semibold text-card-foreground mb-2">User Guide</h3>
          <p class="text-sm text-muted-foreground">Complete guide to using Veerify for feedback management</p>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:video" class="w-6 h-6 text-green-600 dark:text-green-400" />
          </div>
          <h3 class="font-semibold text-card-foreground mb-2">Video Tutorials</h3>
          <p class="text-sm text-muted-foreground">Step-by-step tutorials for managing feedback</p>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:message-circle" class="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <h3 class="font-semibold text-card-foreground mb-2">Contact Support</h3>
          <p class="text-sm text-muted-foreground">Get help from our support team</p>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:zap" class="w-6 h-6 text-orange-600 dark:text-orange-400" />
          </div>
          <h3 class="font-semibold text-card-foreground mb-2">API Documentation</h3>
          <p class="text-sm text-muted-foreground">Integration guides and API references</p>
        </div>
      </div>

      <!-- Popular Articles -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- FAQ Section -->
        <div class="bg-card rounded-lg border border-border">
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold text-card-foreground">Frequently Asked Questions</h2>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div class="border-b border-border pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-card-foreground">How do I create a feedback board?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                </button>
                <div class="mt-3 text-sm text-muted-foreground hidden">
                  To create a new feedback board, navigate to your dashboard and click "Create Board"...
                </div>
              </div>

              <div class="border-b border-border pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-card-foreground">How can I invite users to submit feedback?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div class="border-b border-border pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-card-foreground">Can I customize the feedback forms?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div class="border-b border-border pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-card-foreground">How do I manage feature requests?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div class="pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-card-foreground">Can I integrate Veerify with other tools?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Getting Started -->
        <div class="bg-card rounded-lg border border-border">
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold text-card-foreground">Getting Started</h2>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">1</span>
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground mb-1">Set up your workspace</h3>
                  <p class="text-sm text-muted-foreground">Create your first feedback board and customize settings</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">2</span>
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground mb-1">Invite your users</h3>
                  <p class="text-sm text-muted-foreground">Share your feedback board with customers and users</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">3</span>
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground mb-1">Organize feedback</h3>
                  <p class="text-sm text-muted-foreground">
                    Use tags, categories, and statuses to organize submissions
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">4</span>
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground mb-1">Create your roadmap</h3>
                  <p class="text-sm text-muted-foreground">Plan and share your product development roadmap</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">5</span>
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground mb-1">Engage with users</h3>
                  <p class="text-sm text-muted-foreground">Respond to feedback and keep users updated</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Popular Resources -->
      <div class="mt-8 bg-card rounded-lg border border-border">
        <div class="p-6 border-b border-border">
          <h2 class="text-lg font-semibold text-card-foreground">Popular Resources</h2>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:file-text" class="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 class="font-medium text-card-foreground mb-1">Setting up SSO</h3>
                <p class="text-sm text-muted-foreground">Configure single sign-on for your team</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:code" class="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 class="font-medium text-card-foreground mb-1">Widget Integration</h3>
                <p class="text-sm text-muted-foreground">Embed feedback widgets in your app</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:bell" class="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 class="font-medium text-card-foreground mb-1">Notification Setup</h3>
                <p class="text-sm text-muted-foreground">Configure alerts for new feedback</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:users" class="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 class="font-medium text-card-foreground mb-1">Team Management</h3>
                <p class="text-sm text-muted-foreground">Add team members and manage permissions</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:bar-chart" class="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 class="font-medium text-card-foreground mb-1">Analytics Guide</h3>
                <p class="text-sm text-muted-foreground">Understanding your feedback analytics</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:settings" class="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <h3 class="font-medium text-card-foreground mb-1">Custom Branding</h3>
                <p class="text-sm text-muted-foreground">Customize your feedback portal appearance</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Contact Support -->
      <div class="mt-8 bg-blue-50 dark:bg-blue-950/30 rounded-lg p-6">
        <div class="text-center">
          <Icon name="lucide:headphones" class="w-12 h-12 text-blue-600 dark:text-blue-400 mx-auto mb-4" />
          <h3 class="text-lg font-semibold text-foreground mb-2">Still need help?</h3>
          <p class="text-muted-foreground mb-6">Our support team is here to help you get the most out of Veerify</p>
          <div class="flex justify-center space-x-4">
            <button
              class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Icon name="lucide:message-circle" class="w-4 h-4 mr-2" />
              Start Live Chat
            </button>
            <button
              class="inline-flex items-center px-4 py-2 bg-card text-foreground border border-border rounded-md hover:bg-muted transition-colors"
            >
              <Icon name="lucide:mail" class="w-4 h-4 mr-2" />
              Send Email
            </button>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>
