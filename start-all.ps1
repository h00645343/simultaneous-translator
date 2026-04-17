[CmdletBinding()]
param(
  [int]$AppPort = 3004,
  [switch]$RestartExisting
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $workspaceRoot "logs"

$services = @(
  @{
    Name = "Vosk"
    Port = 2700
    Command = "D:\software\vosk-server\.venv\Scripts\python.exe"
    Arguments = @(
      "D:\software\vosk-server\websocket\asr_server.py",
      "D:\software\vosk-model-small-cn-0.22"
    )
    WorkingDirectory = "D:\software\vosk-server\websocket"
    Env = @{}
  },
  @{
    Name = "LibreTranslate"
    Port = 5000
    Command = "D:\software\libretranslate\.venv\Scripts\libretranslate.exe"
    Arguments = @("--host", "0.0.0.0", "--port", "5000", "--load-only", "zh,en,de,fr,ja")
    WorkingDirectory = "D:\software\LibreTranslate-src"
    Env = @{
      XDG_DATA_HOME = "D:\software\LibreTranslate-data\share"
      XDG_CONFIG_HOME = "D:\software\LibreTranslate-data\config"
      XDG_CACHE_HOME = "D:\software\LibreTranslate-data\cache"
      ARGOS_PACKAGES_DIR = "D:\software\LibreTranslate-data\packages"
    }
  },
  @{
    Name = "Piper"
    Port = 5001
    Command = "D:\software\piper\.venv\Scripts\python.exe"
    Arguments = @(
      "-m",
      "piper.http_server",
      "--host",
      "0.0.0.0",
      "--port",
      "5001",
      "--data-dir",
      "D:\software\piper\voices",
      "-m",
      "D:\software\piper\voices\en_US-lessac-medium.onnx"
    )
    WorkingDirectory = "D:\software\piper"
    Env = @{}
  },
  @{
    Name = "VOICEVOX"
    Port = 50021
    Command = "D:\software\voicevox-engine\0.25.1\windows-cpu\run.exe"
    Arguments = @("--host", "0.0.0.0", "--port", "50021")
    WorkingDirectory = "D:\software\voicevox-engine\0.25.1\windows-cpu"
    Env = @{}
  },
  @{
    Name = "App"
    Port = $AppPort
    Command = "C:\Program Files\nodejs\node.exe"
    Arguments = @("server.js")
    WorkingDirectory = $workspaceRoot
    Env = @{
      PORT = [string]$AppPort
      VOICEVOX_URL = "http://localhost:50021"
    }
  }
)

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Assert-Exists {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Path not found: $Path"
  }
}

function Quote-CmdValue {
  param([string]$Value)

  return '"' + ($Value -replace '"', '""') + '"'
}

function Format-CmdArgument {
  param([string]$Value)

  if ($Value -match '[\s"]') {
    return Quote-CmdValue -Value $Value
  }

  return $Value
}

function Get-ListeningPids {
  param([int]$Port)

  $lines = netstat -ano | Select-String ":$Port"
  $procIds = @()

  foreach ($line in $lines) {
    if ($line.Line -match "LISTENING\s+(\d+)$") {
      $procIds += [int]$matches[1]
    }
  }

  return $procIds | Sort-Object -Unique
}

function Stop-PortProcess {
  param([int]$Port)

  foreach ($procId in Get-ListeningPids -Port $Port) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "Stopped PID $procId on port $Port"
    } catch {
      Write-Warning ("Failed to stop PID {0} on port {1}: {2}" -f $procId, $Port, $_.Exception.Message)
    }
  }
}

function Wait-ForPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ((Get-ListeningPids -Port $Port).Count -gt 0) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Start-ServiceProcess {
  param([hashtable]$Service)

  Assert-Exists -Path $Service.Command
  Assert-Exists -Path $Service.WorkingDirectory

  $stdoutLog = Join-Path $logDir ("{0}.out.log" -f $Service.Name.ToLowerInvariant())
  $stderrLog = Join-Path $logDir ("{0}.err.log" -f $Service.Name.ToLowerInvariant())
  $envCommands = @()
  foreach ($entry in $Service.Env.GetEnumerator()) {
    $envCommands += ('set "{0}={1}"' -f $entry.Key, $entry.Value)
  }

  $commandParts = @(
    ('cd /d {0}' -f (Quote-CmdValue -Value $Service.WorkingDirectory))
  )
  $commandParts += $envCommands

  $programInvocation = @(
    (Quote-CmdValue -Value $Service.Command)
  ) + @($Service.Arguments | ForEach-Object { Format-CmdArgument -Value ([string]$_) })

  $commandParts += (
    '{0} 1>{1} 2>{2}' -f (
      $programInvocation -join ' '
    ), (
      Quote-CmdValue -Value $stdoutLog
    ), (
      Quote-CmdValue -Value $stderrLog
    )
  )

  $cmdScript = $commandParts -join ' && '
  $process = Start-Process `
    -FilePath "$env:SystemRoot\System32\cmd.exe" `
    -ArgumentList @('/d', '/c', $cmdScript) `
    -WindowStyle Hidden `
    -PassThru

  Write-Host ("Started {0} (PID {1})" -f $Service.Name, $process.Id)
}

Ensure-Directory -Path $logDir

foreach ($service in $services) {
  if ($RestartExisting) {
    Stop-PortProcess -Port $service.Port
    Start-Sleep -Milliseconds 600
  } elseif ((Get-ListeningPids -Port $service.Port).Count -gt 0) {
    Write-Host ("Skip {0}: port {1} already in use" -f $service.Name, $service.Port)
    continue
  }

  Start-ServiceProcess -Service $service
  if (-not (Wait-ForPort -Port $service.Port)) {
    Write-Warning ("{0} did not start listening on port {1} within timeout" -f $service.Name, $service.Port)
  }
}

Write-Host ""
Write-Host "Ports:"
foreach ($service in $services) {
  $active = (Get-ListeningPids -Port $service.Port).Count -gt 0
  $state = if ($active) { "UP" } else { "DOWN" }
  Write-Host ("  {0,-14} {1,-5} {2}" -f $service.Name, $service.Port, $state)
}

Write-Host ""
Write-Host ("App URL: http://localhost:{0}" -f $AppPort)
Write-Host ("Logs: {0}" -f $logDir)
