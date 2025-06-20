<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold text-gray-900">Team</h1>
            <p class="text-gray-600">Manage your team members and their access to Veerify</p>
          </div>
          <button class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            <Icon name="lucide:user-plus" class="w-4 h-4 mr-2" />
            Invite Member
          </button>
        </div>
      </div>
      
      <!-- Team Stats -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:users" class="w-8 h-8 text-blue-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Total Members</p>
              <p class="text-2xl font-bold text-gray-900">8</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:shield-check" class="w-8 h-8 text-green-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Active Admins</p>
              <p class="text-2xl font-bold text-gray-900">3</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white p-6 rounded-lg border border-gray-200">
          <div class="flex items-center">
            <Icon name="lucide:clock" class="w-8 h-8 text-purple-600" />
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Pending Invites</p>
              <p class="text-2xl font-bold text-gray-900">2</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Team Members -->
      <div class="bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">Team Members</h2>
            <div class="flex items-center space-x-3">
              <div class="relative">
                <Icon name="lucide:search" class="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Search members..." 
                  class="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
              </div>
              <select class="px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option>All Roles</option>
                <option>Admin</option>
                <option>Member</option>
                <option>Viewer</option>
              </select>
            </div>
          </div>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <!-- Team Member 1 -->
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">M</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Mikal Anderson</h3>
                  <p class="text-sm text-gray-500">m@example.com</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  Owner
                </span>
                <span class="text-sm text-gray-500">Active</span>
                <button class="text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:more-horizontal" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Team Member 2 -->
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">JS</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Jane Smith</h3>
                  <p class="text-sm text-gray-500">jane@example.com</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Admin
                </span>
                <span class="text-sm text-gray-500">Active</span>
                <button class="text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:more-horizontal" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Team Member 3 -->
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">BJ</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Bob Johnson</h3>
                  <p class="text-sm text-gray-500">bob@example.com</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  Member
                </span>
                <span class="text-sm text-gray-500">Active</span>
                <button class="text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:more-horizontal" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Team Member 4 -->
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-orange-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">AD</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Alice Davis</h3>
                  <p class="text-sm text-gray-500">alice@example.com</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  Member
                </span>
                <span class="text-sm text-gray-500">Active</span>
                <button class="text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:more-horizontal" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Team Member 5 -->
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-medium">CW</span>
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">Charlie Wilson</h3>
                  <p class="text-sm text-gray-500">charlie@example.com</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Viewer
                </span>
                <span class="text-sm text-gray-500">Active</span>
                <button class="text-gray-400 hover:text-gray-600">
                  <Icon name="lucide:more-horizontal" class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pending Invites -->
      <div class="mt-8 bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">Pending Invites</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                  <Icon name="lucide:mail" class="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">sarah@example.com</h3>
                  <p class="text-sm text-gray-500">Invited 2 days ago</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Member
                </span>
                <div class="flex items-center space-x-2">
                  <button class="text-sm text-blue-600 hover:text-blue-700">
                    Resend
                  </button>
                  <button class="text-sm text-red-600 hover:text-red-700">
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div class="flex items-center space-x-4">
                <div class="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                  <Icon name="lucide:mail" class="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <h3 class="font-medium text-gray-900">david@example.com</h3>
                  <p class="text-sm text-gray-500">Invited 5 days ago</p>
                </div>
              </div>
              <div class="flex items-center space-x-4">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Viewer
                </span>
                <div class="flex items-center space-x-2">
                  <button class="text-sm text-blue-600 hover:text-blue-700">
                    Resend
                  </button>
                  <button class="text-sm text-red-600 hover:text-red-700">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Role Permissions -->
      <div class="mt-8 bg-white rounded-lg border border-gray-200">
        <div class="p-6 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">Role Permissions</h2>
          <p class="text-sm text-gray-600 mt-1">Understand what each role can do in your workspace</p>
        </div>
        <div class="p-6">
          <div class="space-y-6">
            <div>
              <h3 class="font-medium text-gray-900 mb-3">Owner</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Full access to all features</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Manage billing and subscription</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Add and remove team members</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Delete workspace</span>
                </div>
              </div>
            </div>

            <div>
              <h3 class="font-medium text-gray-900 mb-3">Admin</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Manage feedback and features</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Configure workspace settings</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Invite team members</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:x" class="w-4 h-4 text-red-600" />
                  <span class="text-sm text-gray-600">Manage billing</span>
                </div>
              </div>
            </div>

            <div>
              <h3 class="font-medium text-gray-900 mb-3">Member</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">View and respond to feedback</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">Update feature status</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:x" class="w-4 h-4 text-red-600" />
                  <span class="text-sm text-gray-600">Manage workspace settings</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:x" class="w-4 h-4 text-red-600" />
                  <span class="text-sm text-gray-600">Invite team members</span>
                </div>
              </div>
            </div>

            <div>
              <h3 class="font-medium text-gray-900 mb-3">Viewer</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:check" class="w-4 h-4 text-green-600" />
                  <span class="text-sm text-gray-600">View feedback and analytics</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:x" class="w-4 h-4 text-red-600" />
                  <span class="text-sm text-gray-600">Respond to feedback</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:x" class="w-4 h-4 text-red-600" />
                  <span class="text-sm text-gray-600">Update feature status</span>
                </div>
                <div class="flex items-center space-x-2">
                  <Icon name="lucide:x" class="w-4 h-4 text-red-600" />
                  <span class="text-sm text-gray-600">Manage any settings</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template> 