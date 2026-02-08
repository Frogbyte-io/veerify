<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p class="text-gray-600">Welcome to your Veerify feedback management dashboard</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <!-- Stats Cards -->
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:message-square" class="w-8 h-8 text-blue-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Total Feedback</p>
              <p class="text-2xl font-bold text-gray-900">247</p>
            </div>
          </div>
        </div>

        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:users" class="w-8 h-8 text-green-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Active Users</p>
              <p class="text-2xl font-bold text-gray-900">1,284</p>
            </div>
          </div>
        </div>

        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:trending-up" class="w-8 h-8 text-purple-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Features Shipped</p>
              <p class="text-2xl font-bold text-gray-900">18</p>
            </div>
          </div>
        </div>

        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:heart" class="w-8 h-8 text-red-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">User Satisfaction</p>
              <p class="text-2xl font-bold text-gray-900">94%</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="mt-8 bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">Recent Activity</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <Icon name="lucide:message-square" class="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900">New feature request submitted</p>
                <p class="text-xs text-gray-500">2 hours ago</p>
              </div>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900">Feature marked as completed</p>
                <p class="text-xs text-gray-500">4 hours ago</p>
              </div>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                <Icon name="lucide:user-plus" class="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900">New user registered</p>
                <p class="text-xs text-gray-500">1 day ago</p>
              </div>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                <Icon name="lucide:star" class="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900">Feature received 10+ upvotes</p>
                <p class="text-xs text-gray-500">2 days ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Feature Requests -->
      <div class="mt-8 bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">Top Feature Requests</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:zap" class="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Dark mode support</h3>
                  <p class="text-sm text-gray-500">Requested by 45 users</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                >
                  In Progress
                </span>
                <span class="text-sm font-medium text-gray-900">45 votes</span>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:smartphone" class="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Mobile app</h3>
                  <p class="text-sm text-gray-500">Requested by 32 users</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                >
                  Planned
                </span>
                <span class="text-sm font-medium text-gray-900">32 votes</span>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:bell" class="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Email notifications</h3>
                  <p class="text-sm text-gray-500">Requested by 28 users</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                >
                  Under Review
                </span>
                <span class="text-sm font-medium text-gray-900">28 votes</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>
