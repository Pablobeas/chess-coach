$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $projectRoot "tools\dev-with-maia.mjs"
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {
  throw "No se encontro Node.js para iniciar Chess Coach."
}

& $node.Source $launcher --open @args
