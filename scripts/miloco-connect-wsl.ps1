# Connect Miloco backend (WSL) to OpenX webhook on Windows.
# Usage:
#   .\scripts\miloco-connect-wsl.ps1
#   .\scripts\miloco-connect-wsl.ps1 -Host 127.0.0.1 -Port 3921

param(
    [string]$WebhookHost = "127.0.0.1",
    [int]$Port = 3921
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$openxRoot = Split-Path -Parent $scriptDir
$wslWrapper = Join-Path $scriptDir "miloco-wsl.ps1"

if (-not (Test-Path $wslWrapper)) {
    Write-Error "miloco-wsl.ps1 not found: $wslWrapper"
}

$tokenPath = Join-Path $env:USERPROFILE ".openx\miloco-webhook.token"
if (-not (Test-Path $tokenPath)) {
    Write-Host "Token file not found: $tokenPath" -ForegroundColor Yellow
    Write-Host "Start OpenX server first (pnpm dev) to auto-generate the token, or run:" -ForegroundColor Yellow
    Write-Host "  node scripts/setup-miloco-integration.mjs" -ForegroundColor Yellow
    exit 1
}

$token = (Get-Content $tokenPath -Raw).Trim()
if (-not $token) {
    Write-Error "Empty token in $tokenPath"
}

$webhookUrl = "http://${WebhookHost}:${Port}/api/miloco/webhook"

Write-Host "[miloco] Configuring Miloco agent webhook in WSL..." -ForegroundColor Cyan
Write-Host "  webhook_url: $webhookUrl"
Write-Host "  token: $($token.Substring(0, [Math]::Min(8, $token.Length)))..."

& $wslWrapper config set agent.webhook_url $webhookUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $wslWrapper config set agent.auth_bearer $token
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[miloco] Miloco agent webhook configured." -ForegroundColor Green
Write-Host ""
Write-Host "Network note:" -ForegroundColor Yellow
Write-Host "  - WSL2 mirrored networking: 127.0.0.1 usually works."
Write-Host "  - If webhook fails from WSL, try host IP from: ip route | grep default"
Write-Host "    Example: .\scripts\miloco-connect-wsl.ps1 -WebhookHost 172.x.x.x"
