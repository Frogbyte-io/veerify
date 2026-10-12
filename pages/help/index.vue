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

      <!-- Marketing -->
      <div class="mt-8 bg-card rounded-lg border border-border">
        <div class="p-6 border-b border-border">
          <h2 class="text-lg font-semibold text-card-foreground">Marketing</h2>
          <p class="text-sm text-muted-foreground mt-1">
            Help your product get found by search engines, AI assistants and people discussing the problem it solves
          </p>
        </div>
        <div class="p-6 space-y-8">
          <!-- Marketing: Getting Started -->
          <div>
            <h3 class="font-medium text-card-foreground mb-4">Getting started</h3>
            <div class="space-y-4">
              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">1</span>
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Turn on Marketing</h4>
                  <p class="text-sm text-muted-foreground">
                    Enable the Marketing tool in Settings, under Tools. Then turn it on for each product in that
                    product's Features tab. Marketing only appears for a product when both switches are on.
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">2</span>
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Add and verify your site</h4>
                  <p class="text-sm text-muted-foreground">
                    Enter your product's website and prove you own it. Veerify accepts a DNS TXT record, a meta tag, or
                    a verification file. If your product already has a verified custom domain on the same site, it
                    counts as verified automatically. Nothing is crawled until the site is verified.
                    <NuxtLink to="/marketing/settings" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open Marketing settings
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">3</span>
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Add brand and competitor names</h4>
                  <p class="text-sm text-muted-foreground">
                    Add your brand name with any aliases, plus the competitors you want to track. Veerify uses these
                    names to find your product in AI answers and public posts. Competitors are only tracked by name and
                    public pages.
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
                  <h4 class="font-medium text-card-foreground mb-1">Add your own API keys</h4>
                  <p class="text-sm text-muted-foreground">
                    Features that call AI models or outside services use keys from your team. You can add keys for
                    Anthropic, OpenAI, Gemini and Perplexity, plus Firecrawl (full site crawls) and PageSpeed (Core Web
                    Vitals). Keys are encrypted and never shown again after saving, only their last four characters.
                    Only team admins can add or remove them.
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">5</span>
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Set monthly budgets (optional)</h4>
                  <p class="text-sm text-muted-foreground">
                    Set a monthly cap per AI provider if you want to limit spend. When a cap is reached, runs for that
                    provider stop until the next month.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Marketing: Features -->
          <div>
            <h3 class="font-medium text-card-foreground mb-4">Features</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mt-1">
                  <Icon name="lucide:gauge" class="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Site audit</h4>
                  <p class="text-sm text-muted-foreground">
                    Checks titles, descriptions, links, structured data and sitemaps across your site and gives it a
                    score. It also shows whether search and AI crawlers are allowed in robots.txt and whether your
                    llms.txt file is valid. Basic mode checks the key site files and home page. A full crawl checks more
                    pages and needs a Firecrawl key.
                    <NuxtLink to="/marketing/audit" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open site audit
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mt-1"
                >
                  <Icon name="lucide:sparkles" class="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">AI visibility</h4>
                  <p class="text-sm text-muted-foreground">
                    Asks AI assistants the questions your customers ask, such as "best tool for collecting feedback",
                    and checks whether they mention your product and your competitors. Each prompt runs several times,
                    so results show a mention rate and share of voice rather than a single yes or no. Results come from
                    the provider APIs, so they approximate what people see in the consumer apps.
                    <NuxtLink to="/marketing/ai-visibility" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open AI visibility
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mt-1">
                  <Icon name="lucide:search" class="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Search</h4>
                  <p class="text-sm text-muted-foreground">
                    Connect Google Search Console to see clicks, impressions, average position and top queries for your
                    verified site. Data is synced daily and shown alongside your audit results. Only sites you have
                    verified can be connected.
                    <NuxtLink to="/marketing/search" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open search
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center mt-1"
                >
                  <Icon name="lucide:at-sign" class="w-4 h-4 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Mentions</h4>
                  <p class="text-sm text-muted-foreground">
                    Finds posts on Hacker News, Reddit and Bluesky that mention your brand, competitors or problem
                    keywords. Triage each mention as new, seen or dismissed, or escalate it to a support conversation
                    (needs Support enabled). A daily email digest summarises new mentions. You can turn the digest off
                    in your notification settings.
                    <NuxtLink to="/marketing/mentions" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open mentions
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center mt-1">
                  <Icon name="lucide:megaphone" class="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Announcements</h4>
                  <p class="text-sm text-muted-foreground">
                    When you publish a changelog entry, Veerify drafts posts for X, LinkedIn, Bluesky and your
                    newsletter. You can edit or regenerate each draft. Nothing is ever posted automatically. You copy
                    the text and post it yourself.
                    <NuxtLink to="/marketing/announcements" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open announcements
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center mt-1"
                >
                  <Icon name="lucide:star" class="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Reviews and testimonials</h4>
                  <p class="text-sm text-muted-foreground">
                    Off by default for each product. When turned on, it can email customers who gave a high rating or
                    whose requested feature shipped, asking for a review or a testimonial. Only verified recipients are
                    contacted, each address at most once per cooldown period, and every email has an unsubscribe link.
                    Approved testimonials appear on your public wall.
                    <NuxtLink to="/marketing/reviews" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open reviews
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-teal-100 dark:bg-teal-900/30 rounded-lg flex items-center justify-center mt-1">
                  <Icon name="lucide:messages-square" class="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Customer language</h4>
                  <p class="text-sm text-muted-foreground">
                    Finds the words customers use in feedback and support conversations, and turns them into keyword and
                    prompt suggestions. Feedback and support text is only sent to an AI provider after a team admin
                    gives consent, separately for each source. You can withdraw consent at any time.
                    <NuxtLink to="/marketing/language" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open customer language
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div
                  class="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center mt-1"
                >
                  <Icon name="lucide:target" class="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Competitors</h4>
                  <p class="text-sm text-muted-foreground">
                    Watches public pages of competitors you have listed, such as pricing and changelog pages, and shows
                    what changed. Pages are checked once a day. Veerify respects each site's robots.txt and never
                    fetches a page that robots.txt blocks. Competitor sites are never crawled beyond these pages.
                    <NuxtLink to="/marketing/competitors" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open competitors
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-pink-100 dark:bg-pink-900/30 rounded-lg flex items-center justify-center mt-1">
                  <Icon name="lucide:rocket" class="w-4 h-4 text-pink-600 dark:text-pink-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Launch kit</h4>
                  <p class="text-sm text-muted-foreground">
                    A checklist of launch sites and directories, such as Product Hunt, BetaList, AlternativeTo and G2,
                    with a submission link for each. Track each one as to do, in progress, submitted, live, rejected or
                    skipped. You can add your own directories.
                    <NuxtLink to="/marketing/launch" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open launch kit
                    </NuxtLink>
                  </p>
                </div>
              </div>

              <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg flex items-center justify-center mt-1">
                  <Icon name="lucide:list-checks" class="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div>
                  <h4 class="font-medium text-card-foreground mb-1">Changelog</h4>
                  <p class="text-sm text-muted-foreground">
                    Write release notes with labels such as new, improved and fixed, and link each entry to the feedback
                    it ships. Entries start as drafts and are published when you are ready. Published entries appear on
                    your public changelog page and in an RSS feed.
                    <NuxtLink to="/dashboard/changelog" class="text-blue-600 dark:text-blue-400 hover:underline">
                      Open changelog
                    </NuxtLink>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Marketing: Privacy and Costs -->
          <div>
            <h3 class="font-medium text-card-foreground mb-4">Privacy and costs</h3>
            <ul class="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>
                A basic audit fetches your robots.txt, llms.txt, sitemap and home page directly from Veerify. A full
                crawl sends your site to Firecrawl (your key, or the one set by the install), which fetches the pages.
                Competitor pages are fetched directly from Veerify, once a day.
              </li>
              <li>
                Prompts, brand names and product facts are sent to the AI provider you chose when you run AI visibility
                or announcement drafts. Feedback and support text is sent only if you have given consent in Customer
                language.
              </li>
              <li>
                LLM costs are billed by your own provider accounts, because you bring your own keys. Veerify does not
                charge for AI usage. The usage card shows estimates based on token counts. Your provider's invoice is
                the accurate figure.
              </li>
              <li>Mention excerpts are stored for a limited time and can be deleted at any time.</li>
            </ul>
          </div>

          <!-- Marketing: Self-hosters -->
          <div>
            <h3 class="font-medium text-card-foreground mb-2">Marketing for self-hosters</h3>
            <p class="text-sm text-muted-foreground">
              Every Marketing feature works on a self-hosted install. Set <code>SECRETS_ENCRYPTION_KEY</code> so teams
              can save their own keys. The other settings are optional and each one unlocks a single capability, such as
              <code>FIRECRAWL_API_KEY</code> for full crawls or <code>REDDIT_CLIENT_ID</code> for Reddit mentions. The
              Marketing environment variables table in the project README lists them all. Marketing settings also shows
              which integrations are configured.
            </p>
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
