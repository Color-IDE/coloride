# Setup Python venv + install Coloride desktop backend deps (Windows).
# Run from repo root OR any cwd:
#   powershell -ExecutionPolicy Bypass -File tooling/dev/setup-backend-windows.ps1

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Backend = Join-Path $Root "core\ide-host"
$Venv = Join-Path $Backend ".venv"
$Py = Join-Path $Venv "Scripts\python.exe"
$Pip = Join-Path $Venv "Scripts\pip.exe"

Write-Host "==> Repo root: $Root"
Write-Host "==> Backend:   $Backend"

# Prefer `py -3.12` then `python`
$PythonCmd = $null
$PythonArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  $PythonCmd = "py"
  $PythonArgs = @("-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $PythonCmd = "python"
} else {
  Write-Error "Python not found. Install Python 3.12+ from https://www.python.org/downloads/ and tick 'Add python.exe to PATH'."
}

Write-Host "==> Using launcher: $PythonCmd $($PythonArgs -join ' ')"
& $PythonCmd @PythonArgs --version

if (-not (Test-Path $Py)) {
  Write-Host "==> Creating venv at $Venv"
  & $PythonCmd @PythonArgs -m venv $Venv
}

if (-not (Test-Path $Py)) {
  Write-Error "venv python missing: $Py"
}

Write-Host "==> Upgrading pip"
& $Py -m pip install -U pip wheel setuptools

Write-Host "==> Installing backend package (editable)"
& $Pip install -e $Backend

Write-Host "==> Verifying imports"
& $Py -c "import uvicorn, fastapi, asyncssh, coloride_desktop; print('ok', uvicorn.__version__)"

Write-Host ""
Write-Host "Done. Start the app with:"
Write-Host "  pnpm dev"
Write-Host ""
Write-Host "If Electron still misses the venv, set:"
Write-Host "  `$env:COLORIDE_PYTHON = `"$Py`""
Write-Host "  pnpm dev"
