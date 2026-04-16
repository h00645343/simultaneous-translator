[CmdletBinding()]
param(
  [int[]]$Ports = @(2700, 5000, 5001, 50021, 3004, 3005)
)

$ErrorActionPreference = "Stop"

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

foreach ($port in $Ports) {
  $procIds = Get-ListeningPids -Port $port

  if ($procIds.Count -eq 0) {
    Write-Host ("Port {0}: no listening process" -f $port)
    continue
  }

  foreach ($procId in $procIds) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "Stopped PID $procId on port $port"
    } catch {
      Write-Warning ("Failed to stop PID {0} on port {1}: {2}" -f $procId, $port, $_.Exception.Message)
    }
  }
}
