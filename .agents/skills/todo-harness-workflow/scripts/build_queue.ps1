param(
  [string]$TodoPath = "TODO.md"
)

if (-not (Test-Path $TodoPath)) {
  Write-Error "TODO file not found: $TodoPath"
  exit 1
}

$lines = Get-Content $TodoPath
$queue = @()

for ($i = 0; $i -lt $lines.Length; $i++) {
  $line = $lines[$i]
  if ($line -match "^- \[ \] (.+)$") {
    $title = $matches[1].Trim()
    $lineNumber = $i + 1
    $itemId = "TODO-L{0:D3}" -f $lineNumber
    $queue += [PSCustomObject]@{
      item_id = $itemId
      line = $lineNumber
      text = $title
    }
  }
}

$queue | ConvertTo-Json -Depth 3
