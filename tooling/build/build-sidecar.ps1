# Build Windows onedir PyInstaller sidecar for Electron packaging (faster cold start).
# Usage:
#   powershell -ExecutionPolicy Bypass -File tooling/build/build-sidecar.ps1
#   powershell -ExecutionPolicy Bypass -File tooling/build/build-sidecar.ps1 -OutDir client/desktop/resources/sidecar

param(
  [string]$OutDir = "client/desktop/resources/sidecar",
  [string]$Name = "coloride-sidecar"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$Desktop = Join-Path $Root "core\ide-host"
$OutAbs = Join-Path $Root $OutDir
New-Item -ItemType Directory -Force -Path $OutAbs | Out-Null

$VenvPython = Join-Path $Desktop ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Write-Host "==> creating venv"
  python -m venv (Join-Path $Desktop ".venv")
}

Write-Host "==> install backend + pyinstaller"
& $VenvPython -m pip install -q -U pip
& $VenvPython -m pip install -q -e $Desktop "pyinstaller>=6.3,<7"

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Desktop "build")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Desktop "dist")
Get-ChildItem $Desktop -Filter "*.spec" -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Host "==> pyinstaller onedir $Name"
Push-Location $Desktop
try {
  & $VenvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name $Name `
    --paths src `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols `
    --hidden-import uvicorn.protocols.http `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan `
    --hidden-import uvicorn.lifespan.on `
    --collect-all uvicorn `
    --collect-all asyncssh `
    --collect-all keyring `
    pyinstaller_entry.py
} finally {
  Pop-Location
}

$Dir = Join-Path $Desktop "dist\$Name"
if (-not (Test-Path $Dir)) {
  throw "PyInstaller did not produce onedir $Dir"
}
Get-ChildItem $OutAbs -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force (Join-Path $Dir "*") $OutAbs
$Exe = Join-Path $OutAbs "$Name.exe"
if (-not (Test-Path $Exe)) {
  throw "Expected flattened $Exe"
}
Write-Host "Wrote $Exe"
Get-Item $Exe | Format-List Name, Length, FullName
