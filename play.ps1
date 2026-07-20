$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5173
$maiaPort = 8765
$hostAddress = "127.0.0.1"
$projectPathPrefix = $projectRoot.TrimEnd("\") + "\"
$runtimeRoot = Join-Path $projectRoot ".runtime\maia3"
$maiaLogsRoot = Join-Path $runtimeRoot "logs"
$maiaEngine = Join-Path $runtimeRoot "venv\Scripts\python.exe"
$maiaBridgeScript = Join-Path $projectRoot "tools\maia3-bridge.mjs"
$maiaSetupScript = Join-Path $projectRoot "tools\setup-maia3.ps1"

function Stop-ProjectMaiaProcesses {
  $projectProcesses = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = [string]$_.CommandLine
    $commandLine.IndexOf($runtimeRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $commandLine.IndexOf($maiaBridgeScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  foreach ($projectProcess in $projectProcesses) {
    Stop-Process -Id $projectProcess.ProcessId -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $projectProcess.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }
}

& $maiaSetupScript
New-Item -ItemType Directory -Force -Path $maiaLogsRoot | Out-Null

# Stop only previous Maia processes installed by this project. This prevents
# orphaned Python engines when play is executed repeatedly.
Stop-ProjectMaiaProcesses

# Never trust a health response from an unrelated service already bound to the
# Maia port. A stale or foreign listener can make the launcher open a UI that
# cannot actually talk to this project's engine.
$maiaListeners = @(Get-NetTCPConnection -State Listen -LocalPort $maiaPort -ErrorAction SilentlyContinue)
if ($maiaListeners.Count -gt 0) {
  $owners = $maiaListeners |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_)"
      "PID $($_): $([string]$process.CommandLine)"
    }
  throw "El puerto $maiaPort sigue ocupado después de limpiar Maia-3. Cierra estos procesos y vuelve a ejecutar play:`n$($owners -join "`n")"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "No se encontró Node.js para iniciar el puente local de Maia-3." }
$previousEnginePath = $env:MAIA3_ENGINE_PATH
$previousBridgePort = $env:MAIA3_BRIDGE_PORT
$previousHfHome = $env:HF_HOME
$previousEngineMode = $env:MAIA3_ENGINE_MODE
$env:MAIA3_ENGINE_PATH = $maiaEngine
$env:MAIA3_BRIDGE_PORT = "$maiaPort"
$env:HF_HOME = Join-Path $runtimeRoot "huggingface"
$env:MAIA3_ENGINE_MODE = "python-entrypoint"
$maiaBridgeStdout = Join-Path $maiaLogsRoot "bridge.stdout.log"
$maiaBridgeStderr = Join-Path $maiaLogsRoot "bridge.stderr.log"
try {
  $maiaBridge = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @("`"$maiaBridgeScript`"") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $maiaBridgeStdout `
    -RedirectStandardError $maiaBridgeStderr `
    -PassThru
} finally {
  $env:MAIA3_ENGINE_PATH = $previousEnginePath
  $env:MAIA3_BRIDGE_PORT = $previousBridgePort
  $env:HF_HOME = $previousHfHome
  $env:MAIA3_ENGINE_MODE = $previousEngineMode
}

function Stop-MaiaCompanion {
  Stop-ProjectMaiaProcesses
}

function Get-MaiaStartupDiagnostics {
  $entries = @()
  foreach ($logPath in @($maiaBridgeStderr, $maiaBridgeStdout)) {
    if (Test-Path -LiteralPath $logPath) {
      $entries += "--- $logPath ---"
      $entries += Get-Content -LiteralPath $logPath -Tail 40 -ErrorAction SilentlyContinue
    }
  }
  if ($entries.Count -eq 0) { return "No se generaron logs del bridge." }
  return ($entries -join [Environment]::NewLine)
}

$maiaReady = $false
# Maia may need to load the checkpoint on the first search. The bridge reports
# ready only after that warmup, so do not open the app until it succeeds.
$maiaReadyDeadline = [DateTimeOffset]::UtcNow.AddSeconds(75)
while (-not $maiaReady -and [DateTimeOffset]::UtcNow -lt $maiaReadyDeadline) {
  try {
    $health = Invoke-RestMethod -Uri "http://${hostAddress}:$maiaPort/health" -TimeoutSec 2
    $maiaReady = $health.status -eq "ready"
  } catch {
    $maiaReady = $false
  }
  if ($maiaBridge.HasExited) {
    Stop-MaiaCompanion
    throw "El puente local de Maia-3 no pudo iniciarse. Diagnóstico:`n$(Get-MaiaStartupDiagnostics)"
  }
  if (-not $maiaReady) { Start-Sleep -Milliseconds 250 }
}
if (-not $maiaReady) {
  $diagnostics = Get-MaiaStartupDiagnostics
  Stop-MaiaCompanion
  throw "Maia-3 no estuvo listo tras 75 segundos. Diagnóstico:`n$diagnostics"
}

# A previous launcher could leave Vite running in the background. Reusing that
# listener can show an old bundle, so stop only Vite processes owned by this repo.
$listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
$listenerProcessIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)

foreach ($listenerProcessId in $listenerProcessIds) {
  $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerProcessId"
  $commandLine = [string]$listenerProcess.CommandLine
  $isProjectVite =
    $commandLine.IndexOf($projectPathPrefix, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf("vite", [StringComparison]::OrdinalIgnoreCase) -ge 0

  if (-not $isProjectVite) {
    Stop-MaiaCompanion
    throw "El puerto $port está ocupado por otro programa (PID $listenerProcessId). Ciérralo antes de ejecutar play."
  }

  Stop-Process -Id $listenerProcessId -Force
  Wait-Process -Id $listenerProcessId -Timeout 5 -ErrorAction SilentlyContinue
}

$vite = Join-Path $projectRoot "apps\web\node_modules\.bin\vite.cmd"
$viteStdout = Join-Path $maiaLogsRoot "vite.stdout.log"
$viteStderr = Join-Path $maiaLogsRoot "vite.stderr.log"
if (Test-Path -LiteralPath $vite) {
  $server = Start-Process `
    -FilePath $vite `
    -ArgumentList @(
      "--host",
      $hostAddress,
      "--port",
      "$port",
      "--strictPort",
      "--force"
    ) `
    -WorkingDirectory (Join-Path $projectRoot "apps\web") `
    -WindowStyle Minimized `
    -RedirectStandardOutput $viteStdout `
    -RedirectStandardError $viteStderr `
    -PassThru
} else {
  $vite = Join-Path $projectRoot "node_modules\.bin\vite.cmd"
  if (-not (Test-Path -LiteralPath $vite)) {
    Stop-MaiaCompanion
    throw "No se encontró pnpm ni Vite local. Ejecuta una instalación de Node.js y las dependencias del proyecto."
  }
  $server = Start-Process `
    -FilePath $vite `
    -ArgumentList @("--host", $hostAddress, "--port", "$port", "--strictPort", "--force") `
    -WorkingDirectory (Join-Path $projectRoot "apps\web") `
    -WindowStyle Minimized `
    -PassThru
}

$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $client.Connect($hostAddress, $port)
    $ready = $client.Connected
    $client.Dispose()
  } catch {
    $ready = $false
  }

  if ($ready) { break }
  if ($server.HasExited) {
    Stop-MaiaCompanion
    throw "El servidor de Chess Coach terminó antes de abrir la aplicación."
  }
  Start-Sleep -Milliseconds 250
}

if (-not $ready) {
  Stop-MaiaCompanion
  throw "No se pudo iniciar Chess Coach en http://${hostAddress}:$port"
}

$cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Start-Process "http://${hostAddress}:$port/?play=$cacheBuster"
