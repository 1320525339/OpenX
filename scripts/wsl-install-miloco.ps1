# Install Miloco inside WSL from a Windows checkout (fixes CRLF, runs install.sh --dev).
# Usage:
#   .\scripts\wsl-install-miloco.ps1
#   .\scripts\wsl-install-miloco.ps1 -MilocoRepo "d:/Miloco"
#   .\scripts\wsl-install-miloco.ps1 -SkipInstall

param(
    [string]$MilocoRepo = "d:/Miloco",
    [string]$Distro = $env:OPENX_MILOCO_WSL_DISTRO,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Continue"

if (-not $Distro) { $Distro = "Ubuntu" }

$repoWin = (Resolve-Path $MilocoRepo -ErrorAction SilentlyContinue).Path
if (-not $repoWin) {
    Write-Error "Miloco repo not found: $MilocoRepo"
}

$drive = $repoWin.Substring(0, 1).ToLower()
$rest = $repoWin.Substring(2).Replace("\", "/")
$repoWsl = "/mnt/$drive$rest"

Write-Host "[miloco] WSL distro: $Distro" -ForegroundColor Cyan
Write-Host "[miloco] Repo (WSL): $repoWsl" -ForegroundColor Cyan

function Invoke-WslBash([string]$Command) {
    $output = & wsl -d $Distro bash -lc $Command 2>&1
    if ($output) { $output | Write-Host }
    return $LASTEXITCODE
}

$rc = Invoke-WslBash "test -d '$repoWsl' || exit 1"
if ($rc -ne 0) { Write-Error "Repo missing in WSL: $repoWsl"; exit 1 }

Write-Host "[miloco] Fixing CRLF in shell scripts..." -ForegroundColor Cyan
Invoke-WslBash "cd '$repoWsl' && find scripts -type f -name '*.sh' -exec sed -i 's/\r$//' {} + 2>/dev/null || true"
Invoke-WslBash "cd '$repoWsl' && sed -i 's/\r$//' scripts/install.sh 2>/dev/null || true"

if (-not $SkipInstall) {
    Write-Host "[miloco] Running install.sh --dev (may take several minutes)..." -ForegroundColor Cyan
    $rc = Invoke-WslBash "cd '$repoWsl' && bash scripts/install.sh --dev"
    if ($rc -ne 0) { exit $rc }
}

Write-Host "[miloco] Verifying miloco-cli..." -ForegroundColor Cyan
$rc = Invoke-WslBash 'PATH=$HOME/.local/bin:$PATH command -v miloco-cli && PATH=$HOME/.local/bin:$PATH miloco-cli service status || true'
exit $rc
