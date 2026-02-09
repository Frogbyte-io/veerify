<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-foreground">Dashboard</h1>
        <p class="text-muted-foreground">Welcome to your Veerify feedback management dashboard</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <!-- Stats Cards -->
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
            <Icon name="lucide:users" class="w-8 h-8 text-green-600 dark:text-green-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">Active Users</p>
              <p class="text-2xl font-bold text-card-foreground">1,284</p>
            </div>
          </div>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border">
          <div class="flex items-center">
            <Icon name="lucide:trending-up" class="w-8 h-8 text-purple-600 dark:text-purple-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">Features Shipped</p>
              <p class="text-2xl font-bold text-card-foreground">18</p>
            </div>
          </div>
        </div>

        <div class="bg-card p-6 rounded-lg border border-border">
          <div class="flex items-center">
            <Icon name="lucide:heart" class="w-8 h-8 text-red-600 dark:text-red-400" />
            <div class="ml-4">
              <p class="text-sm font-medium text-muted-foreground">User Satisfaction</p>
              <p class="text-2xl font-bold text-card-foreground">94%</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="mt-8 bg-card rounded-lg border border-border">
        <div class="p-6 border-b border-border">
          <h2 class="text-lg font-semibold text-card-foreground">Recent Activity</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <Icon name="lucide:message-square" class="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-card-foreground">New feature request submitted</p>
                <p class="text-xs text-muted-foreground">2 hours ago</p>
              </div>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <Icon name="lucide:check" class="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-card-foreground">Feature marked as completed</p>
                <p class="text-xs text-muted-foreground">4 hours ago</p>
              </div>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                <Icon name="lucide:user-plus" class="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-card-foreground">New user registered</p>
                <p class="text-xs text-muted-foreground">1 day ago</p>
              </div>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                <Icon name="lucide:star" class="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p class="text-sm font-medium text-card-foreground">Feature received 10+ upvotes</p>
                <p class="text-xs text-muted-foreground">2 days ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Feature Requests -->
      <div class="mt-8 bg-card rounded-lg border border-border">
        <div class="p-6 border-b border-border">
          <h2 class="text-lg font-semibold text-card-foreground">Top Feature Requests</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 border border-border rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:zap" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground">Dark mode support</h3>
                  <p class="text-sm text-muted-foreground">Requested by 45 users</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  In Progress
                </span>
                <span class="text-sm font-medium text-card-foreground">45 votes</span>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-border rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:smartphone" class="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground">Mobile app</h3>
                  <p class="text-sm text-muted-foreground">Requested by 32 users</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                >
                  Planned
                </span>
                <span class="text-sm font-medium text-card-foreground">32 votes</span>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-border rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:bell" class="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 class="font-medium text-card-foreground">Email notifications</h3>
                  <p class="text-sm text-muted-foreground">Requested by 28 users</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground"
                >
                  Under Review
                </span>
                <span class="text-sm font-medium text-card-foreground">28 votes</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>
