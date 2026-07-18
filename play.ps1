$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5173
$hostAddress = "127.0.0.1"

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpm) {
  $server = Start-Process `
    -FilePath $pnpm.Source `
    -ArgumentList @(
      "--filter",
      "@chess-coach/web",
      "dev",
      "--host",
      $hostAddress,
      "--port",
      "$port"
    ) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Minimized `
    -PassThru
} else {
  $vite = Join-Path $projectRoot "node_modules\.bin\vite.cmd"
  if (-not (Test-Path -LiteralPath $vite)) {
    throw "No se encontró pnpm ni Vite local. Ejecuta una instalación de Node.js y las dependencias del proyecto."
  }
  $server = Start-Process `
    -FilePath $vite `
    -ArgumentList @("--host", $hostAddress, "--port", "$port") `
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
    throw "El servidor de Chess Coach terminó antes de abrir la aplicación."
  }
  Start-Sleep -Milliseconds 250
}

if (-not $ready) {
  throw "No se pudo iniciar Chess Coach en http://localhost:$port"
}

Start-Process "http://localhost:$port"
