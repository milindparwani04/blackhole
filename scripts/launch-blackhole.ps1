# Starts Blackhole (if it isn't already running) and opens it in an app window.
# Run via launch-blackhole.vbs so no console window appears.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$port = 4317
$url = "http://127.0.0.1:$port/"
$logDir = Join-Path $root 'data\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'launcher.log'
function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format s) $m" }

function Test-Up {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$($url)api/health").StatusCode -eq 200 } catch { $false }
}

# 1. SearXNG (trophy lookup). Optional: Blackhole works without it, lookups just report it as unavailable.
try {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($docker) {
    & docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) {
      $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
      if (Test-Path $dd) { Log 'starting Docker Desktop'; Start-Process $dd }
    }
    # Docker can take a while; start the container in the background once the engine answers.
    Start-Job -ScriptBlock {
      for ($i = 0; $i -lt 60; $i++) {
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -eq 0) { & docker start blackhole-searxng *> $null; break }
        Start-Sleep -Seconds 3
      }
    } | Out-Null
  }
} catch { Log "docker check failed: $_" }

# 2. Blackhole server.
if (-not (Test-Up)) {
  if (-not (Test-Path (Join-Path $root 'apps\web\dist\index.html'))) {
    Log 'building UI'
    Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'build' -WorkingDirectory $root -WindowStyle Hidden -Wait
  }
  Log 'starting server'
  $cmd = "set NODE_ENV=production&& `"$root\node_modules\.bin\tsx.cmd`" apps\api\src\server.ts >> `"$logDir\server.log`" 2>&1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Up)) {
    Log 'server did not start'
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Blackhole could not start. See $logDir\server.log", 'Blackhole') | Out-Null
    exit 1
  }
}

# 3. Open as an app window (Chrome or Edge app mode), else the default browser.
# @() keeps this an array even when only one browser is found (otherwise [0] is the first character).
$browsers = @(@(
  (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)',
  (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)',
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) })
try {
  if ($browsers.Count) { Start-Process -FilePath $browsers[0] -ArgumentList "--app=$url", '--window-size=1500,950' }
  else { Start-Process $url }
} catch {
  Log "app window failed ($_); using default browser"
  Start-Process $url
}
Log 'opened'
