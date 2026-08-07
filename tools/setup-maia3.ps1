$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeRoot = Join-Path $projectRoot ".runtime\maia3"
$manifestPath = Join-Path $projectRoot "tools\maia3-manifest.json"
$venvRoot = Join-Path $runtimeRoot "venv"
$python = Join-Path $venvRoot "Scripts\python.exe"
$commitMarker = Join-Path $runtimeRoot "source-commit.txt"
$installReport = Join-Path $runtimeRoot "install-report.json"
$resolvedPackages = Join-Path $runtimeRoot "resolved-packages.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$pythonMin = [version]$manifest.python.min
$pythonMaxExclusive = [version]$manifest.python.maxExclusive
$maiaCommit = [string]$manifest.source.commit
$maiaRepository = [string]$manifest.source.url
$engine = Join-Path $venvRoot ([string]$manifest.source.entrypoint)
$checkpointFileName = [string]$manifest.checkpoint.filename
$expectedHash = [string]$manifest.checkpoint.sha256
$checkpointSizeBytes = [long]$manifest.checkpoint.sizeBytes
$upstreamDependencies = @(
  $manifest.source.directDependencies.PSObject.Properties |
    ForEach-Object { "$($_.Name) $($_.Value)" }
)

function Test-PipSupportsInstallReport {
  param(
    [string]$PythonExecutable
  )

  $helpText = & $PythonExecutable -m pip install --help | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo inspeccionar pip en el entorno local de Maia-3."
  }
  return $helpText -match "(?m)^\s+--report\s"
}

function Write-ResolvedPackagesSnapshot {
  param(
    [string]$PythonExecutable,
    [string]$OutputPath
  )

  $packagesJson = & $PythonExecutable -m pip list --format=json
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo registrar el entorno Python local de Maia-3."
  }

  $pythonVersion = & $PythonExecutable -c "import platform; print(platform.python_version())"
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo leer la version de Python del entorno local de Maia-3."
  }

  $snapshot = [ordered]@{
    sourceCommit = $maiaCommit
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    pythonVersion = $pythonVersion
    packages = ($packagesJson | ConvertFrom-Json)
  }
  $snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding ascii
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

if (-not (Test-Path -LiteralPath $python)) {
  $systemPython = Get-Command python -ErrorAction SilentlyContinue
  if (-not $systemPython) {
    throw "Maia-3 necesita Python 3.10-3.12. Instala Python y vuelve a ejecutar play."
  }
  $version = & $systemPython.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
  if ([version]$version -lt $pythonMin -or [version]$version -ge $pythonMaxExclusive) {
    throw "Maia-3 necesita Python 3.10-3.12; se encontro Python $version."
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
  Write-Warning ("Advertencia: Maia-3 fija el commit de origen y el hash del checkpoint, pero sus dependencias transitivas siguen abiertas por upstream ({0}). Este entorno guardara un install-report local con la resolucion exacta antes de confiar en esas dependencias." -f ($upstreamDependencies -join ", "))
  $installArguments = @("-m", "pip", "install", "--disable-pip-version-check")
  if (Test-PipSupportsInstallReport -PythonExecutable $python) {
    $installArguments += @("--report", $installReport)
  } else {
    Write-Warning "pip en este entorno no soporta --report; solo se guardara un snapshot local de paquetes instalados."
  }
  $installArguments += "git+$maiaRepository@$maiaCommit"
  & $python @installArguments
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar Maia-3." }
  if (-not (Test-Path -LiteralPath $engine)) {
    throw "La instalacion termino sin crear el ejecutable UCI maia3-5m."
  }
  Set-Content -LiteralPath $commitMarker -Value $maiaCommit -Encoding ascii
  Write-ResolvedPackagesSnapshot -PythonExecutable $python -OutputPath $resolvedPackages
} elseif (-not (Test-Path -LiteralPath $resolvedPackages)) {
  Write-ResolvedPackagesSnapshot -PythonExecutable $python -OutputPath $resolvedPackages
}

$previousHfHome = $env:HF_HOME
$env:HF_HOME = Join-Path $runtimeRoot "huggingface"
try {
  $checkpoint = Get-ChildItem -LiteralPath $env:HF_HOME -Filter $checkpointFileName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $checkpoint) {
    Write-Host "Descargando el checkpoint oficial Maia3-5M (aprox. 21 MB)..."
    & (Join-Path $venvRoot "Scripts\maia3-cache.exe") --model maia3-5m
    if ($LASTEXITCODE -ne 0) { throw "No se pudo descargar el checkpoint Maia3-5M." }
    $checkpoint = Get-ChildItem -LiteralPath $env:HF_HOME -Filter $checkpointFileName -File -Recurse | Select-Object -First 1
  }
  if (-not $checkpoint) { throw "No se encontro el checkpoint Maia3-5M despues de descargarlo." }
  if ($checkpoint.Length -ne $checkpointSizeBytes) {
    throw "El tamano del checkpoint Maia3-5M no coincide con el registrado."
  }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $checkpoint.FullName).Hash
  if ($actualHash -ne $expectedHash) {
    throw "El hash del checkpoint Maia3-5M no coincide con el registrado."
  }
} finally {
  $env:HF_HOME = $previousHfHome
}

Write-Host "Maia-3 5M esta listo para jugar offline."
