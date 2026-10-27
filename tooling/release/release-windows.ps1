# Build + optionally publish the Windows NSIS installer (x64).
# Run from a Windows machine with Node 22, pnpm, and Python venv set up.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tooling/release/release-windows.ps1
#   powershell -ExecutionPolicy Bypass -File tooling/release/release-windows.ps1 -Publish
#
# Publish needs:
#   $env:GH_TOKEN = "ghp_..."   # repo scope on the Coloride GitHub repository
#
# Artifacts land in client/desktop/release/:
#   Coloride-<version>-win-x64-setup.exe
#   latest.yml   (electron-updater feed for Windows)

param(
  [switch]$Publish
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==> Repo root: $Root"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm not found. Install: npm install -g pnpm@9"
}

# Build the bundled Python host before creating the installer.
& (Join-Path $Root "tooling\build\build-sidecar.ps1")
if ($LASTEXITCODE -ne 0) { throw "Sidecar build failed" }

Write-Host "==> Install JS deps"
pnpm install --frozen-lockfile

Write-Host "==> Build web frontend"
pnpm build:web

$ElectronDir = Join-Path $Root "client\desktop"
Set-Location $ElectronDir

if ($Publish) {
  if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
    throw "Set GH_TOKEN (GitHub classic token with repo scope) before -Publish"
  }
  if (-not $env:GH_TOKEN -and $env:GITHUB_TOKEN) {
    $env:GH_TOKEN = $env:GITHUB_TOKEN
  }
  Write-Host "==> electron-builder --win nsis --x64 --publish always"
  pnpm exec electron-builder --win nsis --x64 --publish always
} else {
  Write-Host "==> electron-builder --win nsis --x64 --publish never"
  pnpm exec electron-builder --win nsis --x64 --publish never
}

$ReleaseDir = Join-Path $ElectronDir "release"
Write-Host ""
Write-Host "Done. Artifacts:"
Get-ChildItem $ReleaseDir -File | Where-Object {
  $_.Name -match 'win|\.exe|latest\.yml'
} | ForEach-Object {
  Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
}

$Setup = Get-ChildItem $ReleaseDir -Filter "Coloride-*-win-*-setup.exe" | Select-Object -First 1
if ($Setup) {
  $Sha = (Get-FileHash $Setup.FullName -Algorithm SHA256).Hash.ToLower()
  Write-Host ""
  Write-Host "Website /releases/latest.json fields:"
  Write-Host ("  version from client/desktop/package.json")
  Write-Host ("  win32-x64 downloadUrl → GitHub release asset: {0}" -f $Setup.Name)
  Write-Host ("  sha256: {0}" -f $Sha)
}
