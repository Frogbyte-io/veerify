const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/** A minimal standalone HTML page for token links that are opened straight from an email. */
export function renderNoticePage(input: { title: string; body: string }): string {
  // `body` is trusted markup built by the caller; any user data in it must go through escapeHtmlText.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtmlText(input.title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1a1a1a;line-height:1.5}
button{background:#6366f1;color:#fff;border:0;border-radius:6px;padding:.6rem 1.1rem;font-size:1rem;cursor:pointer}
</style>
</head>
<body>
<h1>${escapeHtmlText(input.title)}</h1>
${input.body}
</body>
</html>`
}
