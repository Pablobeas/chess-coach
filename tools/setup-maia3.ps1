$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeRoot = Join-Path $projectRoot ".runtime\maia3"
$venvRoot = Join-Path $runtimeRoot "venv"
$python = Join-Path $venvRoot "Scripts\python.exe"
$engine = Join-Path $venvRoot "Scripts\maia3-5m.exe"
$commitMarker = Join-Path $runtimeRoot "source-commit.txt"
$expectedHash = "BA14208B2992D85502F5FB501934ABF6AAAEB355E9F3FDF90E326911F562524F"
$maiaCommit = "1e13597c42d4858b7cfd7cfdae01e297263364b2"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

if (-not (Test-Path -LiteralPath $python)) {
  $systemPython = Get-Command python -ErrorAction SilentlyContinue
  if (-not $systemPython) {
    throw "Maia-3 necesita Python 3.10-3.12. Instala Python y vuelve a ejecutar play."
  }
  $version = & $systemPython.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
  if ([version]$version -lt [version]"3.10" -or [version]$version -ge [version]"3.13") {
    throw "Maia-3 necesita Python 3.10-3.12; se encontró Python $version."
  }
  Write-Host "Preparando el entorno local de Maia-3 (solo la primera vez)..."
  & $systemPython.Source -m venv $venvRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $python)) {
    throw "No se pudo crear el entorno Python local de Maia-3."
  }
}

if (-not (Test-Path -LiteralPath $engine) -or
    -not (Test-Path -LiteralPath $commitMarker) -or
    (Get-Content -LiteralPath $commitMarker -Raw).Trim() -ne $maiaCommit) {
  Write-Host "Instalando Maia-3 desde el commit oficial fijado $maiaCommit..."
  & $python -m pip install --disable-pip-version-check "git+https://github.com/CSSLab/maia3.git@$maiaCommit"
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar Maia-3." }
  if (-not (Test-Path -LiteralPath $engine)) {
    throw "La instalación terminó sin crear el ejecutable UCI maia3-5m."
  }
  Set-Content -LiteralPath $commitMarker -Value $maiaCommit -Encoding ascii
}

$previousHfHome = $env:HF_HOME
$env:HF_HOME = Join-Path $runtimeRoot "huggingface"
try {
  $checkpoint = Get-ChildItem -LiteralPath $env:HF_HOME -Filter "maia3-5m.pt" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $checkpoint) {
    Write-Host "Descargando el checkpoint oficial Maia3-5M (aprox. 21 MB)..."
    & (Join-Path $venvRoot "Scripts\maia3-cache.exe") --model maia3-5m
    if ($LASTEXITCODE -ne 0) { throw "No se pudo descargar el checkpoint Maia3-5M." }
    $checkpoint = Get-ChildItem -LiteralPath $env:HF_HOME -Filter "maia3-5m.pt" -File -Recurse | Select-Object -First 1
  }
  if (-not $checkpoint) { throw "No se encontró el checkpoint Maia3-5M después de descargarlo." }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $checkpoint.FullName).Hash
  if ($actualHash -ne $expectedHash) {
    throw "El hash del checkpoint Maia3-5M no coincide con el registrado."
  }
} finally {
  $env:HF_HOME = $previousHfHome
}

Write-Host "Maia-3 5M está listo para jugar offline."
