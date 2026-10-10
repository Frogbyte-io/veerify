/**
 * Curated catalog of places to launch or list a SaaS / developer tool.
 *
 * Homepages were checked on 2026-10-10. Sites behind bot protection that answer
 * 403/429 to automated fetches (G2, Capterra, GetApp, Indie Hackers, Peerlist,
 * Reddit) were kept because they are long-standing, well-known services. Dropped
 * after the check: Sitejabber (rebranded to SmartCustomer), Slant and Software
 * Advice (unreachable), There's An AI For That and StackShare (unverifiable and
 * not clearly relevant). `submitUrl` is only set where it was seen to resolve.
 *
 * Neutral by design: plain links, no affiliate or referral parameters.
 */
export type LaunchDirectoryCategory = 'launch' | 'directory' | 'review' | 'community' | 'ai-directory'
export type LaunchDirectoryPricing = 'free' | 'paid' | 'freemium'

export interface LaunchDirectory {
  id: string
  name: string
  url: string
  submitUrl?: string
  category: LaunchDirectoryCategory
  pricing: LaunchDirectoryPricing
  audience: string
  tips: string
}

export const LAUNCH_DIRECTORY_CATEGORIES: LaunchDirectoryCategory[] = [
  'launch',
  'directory',
  'review',
  'community',
  'ai-directory',
]

export const LAUNCH_DIRECTORIES: LaunchDirectory[] = [
  {
    id: 'product-hunt',
    name: 'Product Hunt',
    url: 'https://www.producthunt.com',
    submitUrl: 'https://www.producthunt.com/launch',
    category: 'launch',
    pricing: 'free',
    audience: 'Early adopters, makers and tech press looking for new products every day.',
    tips: 'Prepare the page, gallery and first comment ahead of time. Ask friends for honest feedback, not upvotes, since vote solicitation breaks their rules.',
  },
  {
    id: 'hacker-news-show-hn',
    name: 'Hacker News (Show HN)',
    url: 'https://news.ycombinator.com/showhn.html',
    submitUrl: 'https://news.ycombinator.com/submit',
    category: 'launch',
    pricing: 'free',
    audience: 'Technical readers who like things they can try right now.',
    tips: 'Read the Show HN rules first: it must be something people can try without sign-up walls. Be there to answer comments and never ask for upvotes.',
  },
  {
    id: 'betalist',
    name: 'BetaList',
    url: 'https://betalist.com',
    submitUrl: 'https://betalist.com/submit',
    category: 'launch',
    pricing: 'freemium',
    audience: 'Early adopters who want to try startups before they are widely known.',
    tips: 'Best before or around your first public release. A free submission is queued; paid options only speed it up.',
  },
  {
    id: 'uneed',
    name: 'Uneed',
    url: 'https://uneed.best',
    submitUrl: 'https://uneed.best/submit-a-tool',
    category: 'launch',
    pricing: 'freemium',
    audience: 'Indie makers and early adopters browsing a daily launch ranking.',
    tips: 'Free launches wait in a queue. Follow their guidelines on engagement and do not ask for coordinated votes.',
  },
  {
    id: 'peerlist',
    name: 'Peerlist',
    url: 'https://peerlist.io',
    category: 'launch',
    pricing: 'free',
    audience: 'Developers, designers and founders who share work through weekly launches.',
    tips: 'Build a real profile first and post your launch in the weekly Launchpad. Engage with other projects, as the community rewards participation.',
  },
  {
    id: 'devhunt',
    name: 'DevHunt',
    url: 'https://devhunt.org',
    category: 'launch',
    pricing: 'freemium',
    audience: 'Developers looking for new dev tools, with weekly voting cycles.',
    tips: 'Only fits tools aimed at developers. Describe the technical problem you solve and follow their submission rules.',
  },
  {
    id: 'microlaunch',
    name: 'Microlaunch',
    url: 'https://microlaunch.net',
    submitUrl: 'https://microlaunch.net/submit',
    category: 'launch',
    pricing: 'freemium',
    audience: 'Indie makers and small startups who launch and cross-promote each other.',
    tips: 'Free launches are enough to start. Keep your listing honest and respect their rules on promotion.',
  },
  {
    id: 'fazier',
    name: 'Fazier',
    url: 'https://fazier.com',
    submitUrl: 'https://fazier.com/submit',
    category: 'launch',
    pricing: 'freemium',
    audience: 'Founders and early adopters browsing daily product launches.',
    tips: 'Write a clear one-line pitch and real screenshots. Follow their launch guidelines instead of recruiting votes.',
  },
  {
    id: 'indie-hackers',
    name: 'Indie Hackers',
    url: 'https://www.indiehackers.com',
    category: 'community',
    pricing: 'free',
    audience: 'Bootstrapped founders who share numbers, lessons and products.',
    tips: 'Share what you learned, not just a link. Read the group rules on self-promotion and contribute to other threads first.',
  },
  {
    id: 'reddit',
    name: 'Reddit (relevant subreddits)',
    url: 'https://www.reddit.com/r/SideProject/',
    category: 'community',
    pricing: 'free',
    audience: 'Niche communities such as r/SideProject, r/SaaS and subreddits for your own audience.',
    tips: 'Every subreddit has its own self-promotion rules, so read them and the 9:1 participation norm before posting. Lead with a genuine story or question, and never post the same text in many places.',
  },
  {
    id: 'dev-to',
    name: 'DEV Community',
    url: 'https://dev.to',
    submitUrl: 'https://dev.to/new',
    category: 'community',
    pricing: 'free',
    audience: 'Developers who read tutorials and build-in-public posts.',
    tips: 'Write something useful, such as how you built it or a problem you solved, and mention the product naturally. Follow their guidelines on promotional content.',
  },
  {
    id: 'hashnode',
    name: 'Hashnode',
    url: 'https://hashnode.com',
    submitUrl: 'https://hashnode.com/onboard',
    category: 'community',
    pricing: 'free',
    audience: 'Developers and engineers who read and write technical blogs.',
    tips: 'Publish a technical post on your own domain and cross-post with a canonical link. Teach something rather than pitching.',
  },
  {
    id: 'github-awesome-lists',
    name: 'GitHub awesome lists',
    url: 'https://github.com/sindresorhus/awesome',
    category: 'community',
    pricing: 'free',
    audience: 'Developers browsing curated lists for tools in a specific niche.',
    tips: "Only submit to lists where your tool truly fits, and follow each list's contribution guide exactly. Maintainers reject self-promotional or off-topic entries.",
  },
  {
    id: 'linkedin-page',
    name: 'LinkedIn company page',
    url: 'https://www.linkedin.com',
    submitUrl: 'https://www.linkedin.com/company/setup/new/',
    category: 'community',
    pricing: 'free',
    audience: 'B2B buyers, recruiters and your professional network.',
    tips: "Create the page, then announce the launch from the founders' own profiles too. Keep posts about what customers get, not just features.",
  },
  {
    id: 'x-launch-thread',
    name: 'X (launch thread)',
    url: 'https://x.com',
    category: 'community',
    pricing: 'free',
    audience: 'Founders, developers and builders who follow launches.',
    tips: 'Post a short thread with a demo clip and the problem you solve. Engage with replies and avoid mass tagging or unsolicited mentions.',
  },
  {
    id: 'bluesky-launch-thread',
    name: 'Bluesky (launch thread)',
    url: 'https://bsky.app',
    category: 'community',
    pricing: 'free',
    audience: 'Developers, designers and tech people active on Bluesky.',
    tips: 'Share a short thread with a demo and what you learned. Join relevant feeds respectfully and skip repeated promotional posts.',
  },
  {
    id: 'alternativeto',
    name: 'AlternativeTo',
    url: 'https://alternativeto.net',
    category: 'directory',
    pricing: 'free',
    audience: 'People searching for an alternative to a tool they already know.',
    tips: 'Pick the products you are a true alternative to and describe the differences honestly. Follow their submission guidelines.',
  },
  {
    id: 'saashub',
    name: 'SaaSHub',
    url: 'https://www.saashub.com',
    submitUrl: 'https://www.saashub.com/services/submit',
    category: 'directory',
    pricing: 'freemium',
    audience: 'Buyers comparing software, with a focus on alternatives.',
    tips: 'A free listing is enough to start. Verify ownership and keep the description factual.',
  },
  {
    id: 'startup-stash',
    name: 'Startup Stash',
    url: 'https://startupstash.com',
    submitUrl: 'https://startupstash.com/add-listing/',
    category: 'directory',
    pricing: 'freemium',
    audience: 'Founders looking for tools and resources to run a startup.',
    tips: 'Best if your product helps other founders. Choose the right category and keep claims accurate.',
  },
  {
    id: 'openalternative',
    name: 'OpenAlternative',
    url: 'https://openalternative.co',
    submitUrl: 'https://openalternative.co/submit',
    category: 'directory',
    pricing: 'free',
    audience: 'People looking for open source alternatives to commercial software.',
    tips: 'Only for open source projects with a public repository and an open license. Skip it if your product is closed source.',
  },
  {
    id: 'sourceforge',
    name: 'SourceForge',
    url: 'https://sourceforge.net',
    submitUrl: 'https://sourceforge.net/software/vendors/new',
    category: 'directory',
    pricing: 'freemium',
    audience: 'Business software buyers and open source users.',
    tips: 'Use the vendor listing for commercial software and the project hosting for open source. Keep the listing accurate and up to date.',
  },
  {
    id: 'crunchbase',
    name: 'Crunchbase',
    url: 'https://www.crunchbase.com',
    category: 'directory',
    pricing: 'freemium',
    audience: 'Investors, journalists and partners researching companies.',
    tips: 'Claim or create your organization profile with accurate facts. It helps credibility and search presence more than direct sign-ups.',
  },
  {
    id: 'g2',
    name: 'G2',
    url: 'https://www.g2.com',
    category: 'review',
    pricing: 'freemium',
    audience: 'Business software buyers who read verified reviews.',
    tips: 'Claim your free profile, then invite real customers to review. Follow their review guidelines and never offer rewards that bias the rating.',
  },
  {
    id: 'capterra',
    name: 'Capterra',
    url: 'https://www.capterra.com',
    category: 'review',
    pricing: 'freemium',
    audience: 'Small and mid-size businesses comparing software.',
    tips: 'A basic vendor listing is free. Collect genuine reviews from customers and follow their review policies.',
  },
  {
    id: 'getapp',
    name: 'GetApp',
    url: 'https://www.getapp.com',
    category: 'review',
    pricing: 'freemium',
    audience: 'Businesses researching software, from the same group as Capterra.',
    tips: 'Listings are usually shared with Capterra, so one vendor profile covers both. Keep pricing and features up to date.',
  },
  {
    id: 'trustpilot',
    name: 'Trustpilot',
    url: 'https://www.trustpilot.com',
    submitUrl: 'https://business.trustpilot.com',
    category: 'review',
    pricing: 'freemium',
    audience: 'Consumers and buyers checking whether a company can be trusted.',
    tips: 'Claim your profile and invite real customers. Reply to reviews politely and follow their rules against buying or gating reviews.',
  },
  {
    id: 'futurepedia',
    name: 'Futurepedia',
    url: 'https://www.futurepedia.io',
    category: 'ai-directory',
    pricing: 'freemium',
    audience: 'People browsing AI tools by category.',
    tips: 'Only relevant if AI is a real part of your product. Describe the AI features accurately and check their current submission process.',
  },
]

const BY_ID = new Map(LAUNCH_DIRECTORIES.map((directory) => [directory.id, directory]))

export function getLaunchDirectory(id: string): LaunchDirectory | undefined {
  return BY_ID.get(id)
}
