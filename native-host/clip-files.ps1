<#
  Puts one or more files on the Windows clipboard as a real file drop
  (CF_HDROP), the same thing Explorer's Ctrl+C produces — so pasting into
  Claude Code, a chat app, or a folder attaches the file rather than its text.

  Set-Clipboard would nearly do it, but SetDataObject($obj, $true) is what
  flushes the data to the OS so it survives this process exiting.
#>
param(
  [Parameter(Mandatory = $true)][string]$ListFile
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$paths = Get-Content -LiteralPath $ListFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($paths -isnot [array]) { $paths = @($paths) }

$existing = @()
foreach ($p in $paths) {
  if (Test-Path -LiteralPath $p) { $existing += (Resolve-Path -LiteralPath $p).ProviderPath }
}
if ($existing.Count -eq 0) { throw "none of the listed files exist" }

$collection = New-Object System.Collections.Specialized.StringCollection
foreach ($p in $existing) { [void]$collection.Add($p) }

$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList($collection)

# Tell Explorer this is a copy, not a move.
$effect = New-Object System.IO.MemoryStream
$effect.Write([byte[]](5, 0, 0, 0), 0, 4)
$data.SetData('Preferred DropEffect', $effect)

[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)

Write-Output ("copied {0} file(s)" -f $existing.Count)
