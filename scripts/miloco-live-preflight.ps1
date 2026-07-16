# Miloco × OpenX live preflight: OpenX API + WSL miloco-cli + webhook reachability.
# Usage:
#   .\scripts\miloco-live-preflight.ps1
#   .\scripts\miloco-live-preflight.ps1 -Base http://127.0.0.1:3921

param(
    [string]$Base = $env:OPENX_API_BASE,
    [int]$Port = 3921
)

$ErrorActionPreference = "Continue"

if (-not $Base) { $Base = "http://127.0.0.1:$Port" }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$openxRoot = Split-Path -Parent $scriptDir
$wslWrapper = Join-Path $scriptDir "miloco-wsl.ps1"
$tokenPath = Join-Path $env:USERPROFILE ".openx\miloco-webhook.token"

$failed = 0

function Ok($msg) { Write-Host "OK  $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "FAIL $msg" -ForegroundColor Red; $script:failed += 1 }
function Warn($msg) { Write-Host "WARN $msg" -ForegroundColor Yellow }

Write-Host "[miloco-live] Preflight base: $Base" -ForegroundColor Cyan
Write-Host ""

# --- OpenX API ---
try {
    $health = Invoke-RestMethod -Uri "$Base/api/health" -Method Get -TimeoutSec 10
    if ($health.ok) { Ok "OpenX /api/health" } else { Fail "OpenX health not ok" }
} catch {
    Fail "OpenX unreachable: $_"
}

try {
    $executors = Invoke-RestMethod -Uri "$Base/api/executors" -Method Get -TimeoutSec 30
    $pi = $executors.executors | Where-Object { $_.id -eq "pi" } | Select-Object -First 1
    if ($pi -and $pi.available) {
        if ($pi.displayName -match "Mock") {
            Fail "Pi is Mock executor — unset OPENX_MOCK_PI for live test"
        } else {
            Ok "Pi executor available ($($pi.displayName))"
        }
        if ($pi.hint) { Warn "Pi hint: $($pi.hint)" }
    } else {
        Fail "Pi executor not available"
    }
} catch {
    Fail "GET /api/executors: $_"
}

try {
    $status = Invoke-RestMethod -Uri "$Base/api/miloco/status" -Method Get -TimeoutSec 10
    if ($status.webhook.tokenConfigured) { Ok "Miloco webhook token configured" } else { Fail "Webhook token not configured" }
    if ($status.skillsBoundToPi.Count -ge 5) {
        Ok "Miloco skills bound to pi ($($status.skillsBoundToPi.Count))"
    } else {
        Fail "Expected >=5 Miloco skills bound to pi, got $($status.skillsBoundToPi.Count)"
    }
    if ($status.webhook.url) { Ok "Webhook URL: $($status.webhook.url)" }
} catch {
    Fail "GET /api/miloco/status: $_"
}

try {
    $wh = Invoke-RestMethod -Uri "$Base/api/miloco/webhook" -Method Get -TimeoutSec 10
    if ($wh.ok -and $wh.service -eq "miloco-webhook") { Ok "GET /api/miloco/webhook probe" } else { Fail "Webhook probe unexpected response" }
} catch {
    Fail "GET /api/miloco/webhook: $_"
}

# --- Token file ---
$token = $null
if (Test-Path $tokenPath) {
    $token = (Get-Content $tokenPath -Raw).Trim()
    if ($token) { Ok "Token file: $tokenPath" } else { Fail "Empty token file" }
} else {
    Fail "Token file missing: $tokenPath (run pnpm miloco:setup)"
}

# --- WSL miloco-cli ---
if (-not (Test-Path $wslWrapper)) {
    Fail "miloco-wsl.ps1 missing"
} else {
    Ok "miloco-wsl.ps1 present"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & $wslWrapper service status 2>&1 | Out-Null
    $svcOk = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prevEap
    if ($svcOk) {
        Ok "WSL miloco-cli service status"
    } else {
        Fail "WSL miloco-cli not available (run wsl-install-miloco.ps1)"
    }
}

# --- WSL -> OpenX webhook (GET with Bearer) ---
if ($token) {
    $distro = $env:OPENX_MILOCO_WSL_DISTRO
    if (-not $distro) { $distro = "Ubuntu" }
    $hostOnly = ([Uri]$Base).Host
    $portOnly = ([Uri]$Base).Port
    if ($portOnly -le 0) { $portOnly = 3921 }
    $curlUrl = "http://${hostOnly}:${portOnly}/api/miloco/webhook"
    $curlCmd = "curl -sf --connect-timeout 5 --max-time 10 -H 'Authorization: Bearer $token' '$curlUrl'"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & wsl -d $distro bash -lc $curlCmd 2>&1 | Out-Null
    $curlOk = ($LASTEXITCODE -eq 0)
    if (-not $curlOk -and $hostOnly -eq "127.0.0.1") {
        $gw = (& wsl -d $distro bash -lc "ip route show default 2>/dev/null | cut -d' ' -f3 | head -1" 2>&1 | Out-String).Trim()
        if ($gw -match '^\d+\.\d+\.\d+\.\d+$') {
            Warn "127.0.0.1 unreachable from WSL, retry via gateway $gw"
            $curlUrl = "http://${gw}:${portOnly}/api/miloco/webhook"
            $curlCmd = "curl -sf --connect-timeout 5 --max-time 10 -H 'Authorization: Bearer $token' '$curlUrl'"
            & wsl -d $distro bash -lc $curlCmd 2>&1 | Out-Null
            $curlOk = ($LASTEXITCODE -eq 0)
            if ($curlOk) {
                Warn "Miloco webhook should use: .\scripts\miloco-connect-wsl.ps1 -WebhookHost $gw"
            }
        }
    }
    $ErrorActionPreference = $prevEap
    if ($curlOk) {
        Ok "WSL curl OpenX webhook ($curlUrl)"
    } else {
        Warn "WSL cannot reach OpenX webhook (Layer B 需要；Layer A 可从 Windows 直接 POST)"
        Warn "修复：启用 WSL 镜像网络，或 HOST=0.0.0.0 pnpm dev，再 miloco-connect-wsl.ps1 -WebhookHost <网关IP>"
    }
}

Write-Host ""
if ($failed -eq 0) {
    Write-Host "All preflight checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$failed preflight check(s) failed." -ForegroundColor Red
    exit 1
}
