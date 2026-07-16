param(
  [Parameter(Mandatory = $true)]
  [string]$Text
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& "$root\scripts\miloco-wsl.ps1" notify push --text $Text
if ($LASTEXITCODE -ne 0) {
  Write-Output (@{ ok = $false; needsBind = $true } | ConvertTo-Json -Compress)
  exit 1
}
Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
