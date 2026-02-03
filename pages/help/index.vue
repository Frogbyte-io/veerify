<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900">Help Center</h1>
        <p class="text-gray-600">Find answers to your questions and get support for Veerify</p>
      </div>

      <!-- Search Bar -->
      <div class="mb-8">
        <div class="relative max-w-md">
          <Icon name="lucide:search" class="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search help articles..."
            class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-white p-6 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:book-open" class="w-6 h-6 text-blue-600" />
          </div>
          <h3 class="font-semibold text-gray-900 mb-2">User Guide</h3>
          <p class="text-sm text-gray-600">Complete guide to using Veerify for feedback management</p>
        </div>

        <div class="bg-white p-6 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:video" class="w-6 h-6 text-green-600" />
          </div>
          <h3 class="font-semibold text-gray-900 mb-2">Video Tutorials</h3>
          <p class="text-sm text-gray-600">Step-by-step tutorials for managing feedback</p>
        </div>

        <div class="bg-white p-6 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:message-circle" class="w-6 h-6 text-purple-600" />
          </div>
          <h3 class="font-semibold text-gray-900 mb-2">Contact Support</h3>
          <p class="text-sm text-gray-600">Get help from our support team</p>
        </div>

        <div class="bg-white p-6 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
          <div class="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
            <Icon name="lucide:zap" class="w-6 h-6 text-orange-600" />
          </div>
          <h3 class="font-semibold text-gray-900 mb-2">API Documentation</h3>
          <p class="text-sm text-gray-600">Integration guides and API references</p>
        </div>
      </div>

      <!-- Popular Articles -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- FAQ Section -->
        <div class="bg-white rounded-lg border border-gray-200">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-semibold text-gray-900">Frequently Asked Questions</h2>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div class="border-b border-gray-100 pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-gray-900">How do I create a feedback board?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-gray-400" />
                </button>
                <div class="mt-3 text-sm text-gray-600 hidden">
                  To create a new feedback board, navigate to your dashboard and click "Create Board"...
                </div>
              </div>

              <div class="border-b border-gray-100 pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-gray-900">How can I invite users to submit feedback?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-gray-400" />
                </button>
              </div>

              <div class="border-b border-gray-100 pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-gray-900">Can I customize the feedback forms?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-gray-400" />
                </button>
              </div>

              <div class="border-b border-gray-100 pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-gray-900">How do I manage feature requests?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-gray-400" />
                </button>
              </div>

              <div class="pb-4">
                <button class="flex items-center justify-between w-full text-left">
                  <h3 class="font-medium text-gray-900">Can I integrate Veerify with other tools?</h3>
                  <Icon name="lucide:chevron-down" class="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Getting Started -->
        <div class="bg-white rounded-lg border border-gray-200">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-semibold text-gray-900">Getting Started</h2>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div class="flex items-start space-x-3">
                <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                  <span class="text-xs font-medium text-blue-600">1</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900 mb-1">Set up your workspace</h3>
                  <p class="text-sm text-gray-600">Create your first feedback board and customize settings</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                  <span class="text-xs font-medium text-blue-600">2</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900 mb-1">Invite your users</h3>
                  <p class="text-sm text-gray-600">Share your feedback board with customers and users</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                  <span class="text-xs font-medium text-blue-600">3</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900 mb-1">Organize feedback</h3>
                  <p class="text-sm text-gray-600">Use tags, categories, and statuses to organize submissions</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                  <span class="text-xs font-medium text-blue-600">4</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900 mb-1">Create your roadmap</h3>
                  <p class="text-sm text-gray-600">Plan and share your product development roadmap</p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                  <span class="text-xs font-medium text-blue-600">5</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900 mb-1">Engage with users</h3>
                  <p class="text-sm text-gray-600">Respond to feedback and keep users updated</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Popular Resources -->
      <div class="mt-8 bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">Popular Resources</h2>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:file-text" class="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h3 class="font-medium text-gray-900 mb-1">Setting up SSO</h3>
                <p class="text-sm text-gray-600">Configure single sign-on for your team</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:code" class="w-4 h-4 text-green-600" />
              </div>
              <div>
                <h3 class="font-medium text-gray-900 mb-1">Widget Integration</h3>
                <p class="text-sm text-gray-600">Embed feedback widgets in your app</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:bell" class="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <h3 class="font-medium text-gray-900 mb-1">Notification Setup</h3>
                <p class="text-sm text-gray-600">Configure alerts for new feedback</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:users" class="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <h3 class="font-medium text-gray-900 mb-1">Team Management</h3>
                <p class="text-sm text-gray-600">Add team members and manage permissions</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:bar-chart" class="w-4 h-4 text-red-600" />
              </div>
              <div>
                <h3 class="font-medium text-gray-900 mb-1">Analytics Guide</h3>
                <p class="text-sm text-gray-600">Understanding your feedback analytics</p>
              </div>
            </div>

            <div class="flex items-start space-x-3">
              <div class="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center mt-1">
                <Icon name="lucide:settings" class="w-4 h-4 text-yellow-600" />
              </div>
              <div>
                <h3 class="font-medium text-gray-900 mb-1">Custom Branding</h3>
                <p class="text-sm text-gray-600">Customize your feedback portal appearance</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Contact Support -->
      <div class="mt-8 bg-blue-50 rounded-lg p-6">
        <div class="text-center">
          <Icon name="lucide:headphones" class="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Still need help?</h3>
          <p class="text-gray-600 mb-6">Our support team is here to help you get the most out of Veerify</p>
          <div class="flex justify-center space-x-4">
            <button
              class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Icon name="lucide:message-circle" class="w-4 h-4 mr-2" />
              Start Live Chat
            </button>
            <button
              class="inline-flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
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
