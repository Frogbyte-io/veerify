// Display colour for a support tag: its own colour when set, otherwise a stable
// pick from a small palette so the same tag always gets the same dot.
const TAG_PALETTE = [
  'oklch(0.68 0.19 25)',
  'oklch(0.72 0.15 150)',
  'oklch(0.68 0.15 260)',
  'oklch(0.75 0.15 75)',
  'oklch(0.66 0.16 320)',
  'oklch(0.7 0.12 200)',
]

export function supportTagColor(tag: { id?: string | null; name?: string | null; color?: string | null }): string {
  if (tag.color) return tag.color
  const key = tag.id || tag.name || ''
  let hash = 0
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}
