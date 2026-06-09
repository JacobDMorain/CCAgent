param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Action
  )

  Write-Host ""
  Write-Host "==> $Title"
  & $Action
}

function Invoke-Native {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
  throw "pnpm.cmd was not found in PATH. Install pnpm or run this from an environment where pnpm.cmd is available."
}

Invoke-Step "Installing workspace dependencies if needed" {
  if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Invoke-Native "pnpm.cmd" @("install")
  } else {
    Write-Host "node_modules exists; skipping pnpm install."
  }
}

if (-not $SkipBuild) {
  Invoke-Step "Building CCAgent packages" {
    Invoke-Native "pnpm.cmd" @("build")
  }
} else {
  Write-Host ""
  Write-Host "==> Skipping build because -SkipBuild was supplied"
}

Invoke-Step "Starting CCAgent GUI" {
  Invoke-Native "pnpm.cmd" @("dev:gui")
}
