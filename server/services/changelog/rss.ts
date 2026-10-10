/** RSS 2.0 builder for the public changelog. Pure: no I/O. */

export interface RssItem {
  title: string
  link: string
  guid: string
  pubDate: Date
  description: string
  categories: string[]
}

export interface RssChannel {
  title: string
  link: string
  description: string
  selfUrl: string
  items: RssItem[]
}

// Characters that are illegal in XML 1.0 documents
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * `markdownToPlainText` strips tags from sanitised HTML but leaves entities
 * (`&amp;`) encoded. Decode them so escaping once yields correct feed text
 * rather than a double-escaped `&amp;amp;`.
 */
export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function buildRssFeed(channel: RssChannel): string {
  const lastBuild = channel.items[0]?.pubDate ?? new Date(0)
  const items = channel.items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
      <description>${escapeXml(item.description)}</description>
${item.categories.map((c) => `      <category>${escapeXml(c)}</category>\n`).join('')}    </item>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`
}
