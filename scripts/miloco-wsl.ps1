# Miloco CLI wrapper for OpenX on Windows (delegates to WSL Ubuntu).
# Usage: .\scripts\miloco-wsl.ps1 device list
#        .\scripts\miloco-wsl.ps1 service status

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$MilocoArgs
)

$ErrorActionPreference = "Continue"

$distro = $env:OPENX_MILOCO_WSL_DISTRO
if (-not $distro) { $distro = "Ubuntu" }

if ($MilocoArgs.Count -eq 0) {
    Write-Host "Usage: miloco-wsl.ps1 <miloco-cli args...>" -ForegroundColor Yellow
    Write-Host "Example: miloco-wsl.ps1 device list" -ForegroundColor Yellow
    exit 1
}

$escaped = ($MilocoArgs | ForEach-Object {
    if ($_ -match "[\s`"'\\$]") {
        "'" + ($_ -replace "'", "'\\''") + "'"
    } else {
        $_
    }
}) -join " "

$cmd = "miloco-cli $escaped"
$output = & wsl -d $distro bash -lc $cmd 2>&1
if ($output) { $output | Write-Output }
exit $LASTEXITCODE
