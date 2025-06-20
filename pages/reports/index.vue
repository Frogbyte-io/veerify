<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900">Analytics</h1>
        <p class="text-gray-600">Insights and analytics for your feedback management</p>
      </div>
      
      <!-- Report Filters -->
      <div class="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div class="flex flex-wrap items-center gap-4">
          <div>
            <label class="block text-sm text-gray-600 mb-1">Date Range</label>
            <select class="px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
              <option>Last 3 months</option>
              <option>Last year</option>
              <option>Custom range</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">Board</label>
            <select class="px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option>All Boards</option>
              <option>Feature Requests</option>
              <option>Bug Reports</option>
              <option>General Feedback</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">Status</label>
            <select class="px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option>All Statuses</option>
              <option>Open</option>
              <option>In Progress</option>
              <option>Completed</option>
              <option>Rejected</option>
            </select>
          </div>
          <div class="flex items-end">
            <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
              <Icon name="lucide:filter" class="w-4 h-4 mr-2 inline" />
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      <!-- Key Metrics -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-600">Total Feedback</h3>
            <Icon name="lucide:message-square" class="w-5 h-5 text-blue-600" />
          </div>
          <p class="text-2xl font-bold text-gray-900">1,247</p>
          <p class="text-sm text-blue-600 mt-1">+15.2% from last month</p>
        </div>
        
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-600">Active Users</h3>
            <Icon name="lucide:users" class="w-5 h-5 text-green-600" />
          </div>
          <p class="text-2xl font-bold text-gray-900">3,284</p>
          <p class="text-sm text-green-600 mt-1">+8.1% from last month</p>
        </div>
        
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-600">Completion Rate</h3>
            <Icon name="lucide:check-circle" class="w-5 h-5 text-purple-600" />
          </div>
          <p class="text-2xl font-bold text-gray-900">78.5%</p>
          <p class="text-sm text-purple-600 mt-1">+12.3% from last month</p>
        </div>
        
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-600">Avg Response Time</h3>
            <Icon name="lucide:clock" class="w-5 h-5 text-orange-600" />
          </div>
          <p class="text-2xl font-bold text-gray-900">2.4d</p>
          <p class="text-sm text-orange-600 mt-1">-0.8d from last month</p>
        </div>
      </div>

      <!-- Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <!-- Feedback Trend -->
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Feedback Trend</h3>
            <button class="text-sm text-gray-500 hover:text-gray-700">
              <Icon name="lucide:more-horizontal" class="w-4 h-4" />
            </button>
          </div>
          <div class="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <div class="text-center">
              <Icon name="lucide:trending-up" class="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p class="text-gray-500">Feedback Trend Chart</p>
              <p class="text-sm text-gray-400">Line chart visualization would go here</p>
            </div>
          </div>
        </div>

        <!-- Feature Status Distribution -->
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Feature Status</h3>
            <button class="text-sm text-gray-500 hover:text-gray-700">
              <Icon name="lucide:more-horizontal" class="w-4 h-4" />
            </button>
          </div>
          <div class="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <div class="text-center">
              <Icon name="lucide:pie-chart" class="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p class="text-gray-500">Status Distribution</p>
              <p class="text-sm text-gray-400">Donut chart visualization would go here</p>
            </div>
          </div>
        </div>
      </div>

      <!-- User Engagement -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <!-- Top Contributors -->
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Top Contributors</h3>
            <button class="text-sm text-gray-500 hover:text-gray-700">
              <Icon name="lucide:more-horizontal" class="w-4 h-4" />
            </button>
          </div>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">JD</span>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">John Doe</p>
                  <p class="text-xs text-gray-500">john@example.com</p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-sm font-medium text-gray-900">23 submissions</p>
                <p class="text-xs text-gray-500">156 votes</p>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">AS</span>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">Alice Smith</p>
                  <p class="text-xs text-gray-500">alice@example.com</p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-sm font-medium text-gray-900">18 submissions</p>
                <p class="text-xs text-gray-500">142 votes</p>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">BJ</span>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">Bob Johnson</p>
                  <p class="text-xs text-gray-500">bob@example.com</p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-sm font-medium text-gray-900">15 submissions</p>
                <p class="text-xs text-gray-500">98 votes</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Feature Categories -->
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Popular Categories</h3>
            <button class="text-sm text-gray-500 hover:text-gray-700">
              <Icon name="lucide:more-horizontal" class="w-4 h-4" />
            </button>
          </div>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:zap" class="w-4 h-4 text-blue-600" />
                </div>
                <span class="text-sm font-medium text-gray-900">New Features</span>
              </div>
              <div class="flex items-center space-x-2">
                <div class="w-24 bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full" style="width: 65%"></div>
                </div>
                <span class="text-sm text-gray-600">65%</span>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:bug" class="w-4 h-4 text-red-600" />
                </div>
                <span class="text-sm font-medium text-gray-900">Bug Reports</span>
              </div>
              <div class="flex items-center space-x-2">
                <div class="w-24 bg-gray-200 rounded-full h-2">
                  <div class="bg-red-600 h-2 rounded-full" style="width: 25%"></div>
                </div>
                <span class="text-sm text-gray-600">25%</span>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:settings" class="w-4 h-4 text-green-600" />
                </div>
                <span class="text-sm font-medium text-gray-900">Improvements</span>
              </div>
              <div class="flex items-center space-x-2">
                <div class="w-24 bg-gray-200 rounded-full h-2">
                  <div class="bg-green-600 h-2 rounded-full" style="width: 10%"></div>
                </div>
                <span class="text-sm text-gray-600">10%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Export Reports -->
      <div class="bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">Export Reports</h2>
            <button class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
              <Icon name="lucide:download" class="w-4 h-4 mr-2" />
              Generate Report
            </button>
          </div>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:file-text" class="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Monthly Feedback Summary</h3>
                  <p class="text-sm text-gray-500">Generated 1 hour ago • Product Team</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <button class="p-2 text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:download" class="w-4 h-4" />
                </button>
                <button class="p-2 text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:share" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:file-text" class="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">User Engagement Analytics</h3>
                  <p class="text-sm text-gray-500">Generated 2 days ago • Marketing Team</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <button class="p-2 text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:download" class="w-4 h-4" />
                </button>
                <button class="p-2 text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:share" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Icon name="lucide:file-text" class="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Feature Completion Report</h3>
                  <p class="text-sm text-gray-500">Generated 1 week ago • Development Team</p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <button class="p-2 text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:download" class="w-4 h-4" />
                </button>
                <button class="p-2 text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:share" class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template> 