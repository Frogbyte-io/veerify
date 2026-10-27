export function normalizeCsvHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(value)
      value = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(value)
      value = ''
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      continue
    }

    value += char
  }

  row.push(value)
  if (row.some((cell) => cell.length > 0)) rows.push(row)
  return rows
}

export function csvRowsToObjects(content: string): Record<string, string>[] {
  const rows = parseCsv(content)
  if (rows.length === 0) return []
  const headers = rows[0].map((header) => normalizeCsvHeader(header))
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? ''
    })
    return record
  })
}
