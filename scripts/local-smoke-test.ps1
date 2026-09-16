[CmdletBinding()]
param(
  [switch]$StopAfterTest
)

$ErrorActionPreference = "Stop"
$webRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiRoot = Join-Path $webRoot "vps\onnx-submissions"
$agentRoot = "E:\fmsimulation\TechCamp-colgnaoh"
$dataRoot = Join-Path ([IO.Path]::GetTempPath()) ("techcamp-onnx-local-test-" + [Guid]::NewGuid().ToString("N"))
$apiProcess = $null
$webProcess = $null
$agentProcess = $null

function Stop-TestProcess($process) {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

try {
  $ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(8080, 8787) }
  if ($ports) {
    $used = ($ports | Select-Object -ExpandProperty LocalPort -Unique) -join ", "
    throw "Local test ports already in use: $used"
  }

  New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
  $env:ONNX_DATA_ROOT = $dataRoot
  $env:ONNX_ALLOWED_ORIGINS = "http://127.0.0.1:8080,http://localhost:8080"
  $env:TEACHER_PASSWORD = "0909"
  $env:TECHCAMP_AGENT_TOKEN = "local-smoke-agent-token"
  $env:TECHCAMP_CONTROL_PLANE_URL = "http://127.0.0.1:8787"
  $env:TECHCAMP_RUNTIME_ROOT = $agentRoot
  $env:TECHCAMP_FR5_IP = "192.168.58.2"

  $apiProcess = Start-Process -FilePath "python.exe" `
    -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8787", "--no-access-log") `
    -WorkingDirectory $apiRoot -WindowStyle Hidden -PassThru
  $webProcess = Start-Process -FilePath "node.exe" `
    -ArgumentList @(".\serve.mjs", "8080") `
    -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru
  $agentProcess = Start-Process -FilePath "python.exe" `
    -ArgumentList @(".\techcamp_agent.py", "--dry-run") `
    -WorkingDirectory $agentRoot -WindowStyle Hidden -PassThru

  $health = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:8787/healthz" -TimeoutSec 2
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $health) {
    throw "Local FastAPI did not become healthy."
  }

  Start-Sleep -Seconds 2
  $session = Invoke-RestMethod -Method Post -UseBasicParsing `
    -Uri "http://127.0.0.1:8787/v1/teacher/session" `
    -Headers @{ Origin = "http://127.0.0.1:8080" } `
    -ContentType "application/json" `
    -Body (@{ password = "0909" } | ConvertTo-Json)
  $headers = @{
    Authorization = "Bearer $($session.token)"
    Origin = "http://127.0.0.1:8080"
  }
  $agentStatus = Invoke-RestMethod -UseBasicParsing `
    -Uri "http://127.0.0.1:8787/v1/teacher/agent-status" -Headers $headers
  if (-not $agentStatus.online) {
    throw "Local Agent did not publish a heartbeat."
  }

  $source = @"
from techcamp_api import TechCamp

def main():
    with TechCamp() as bot:
        bot.move_to("P1")
        bot.move_down()
        bot.grip()
        bot.move_up()
        bot.move_to("HOME")
        bot.release()

if __name__ == "__main__":
    main()
"@
  $job = Invoke-RestMethod -Method Post -UseBasicParsing `
    -Uri "http://127.0.0.1:8787/v1/teacher/jobs" -Headers $headers `
    -ContentType "application/json" `
    -Body (@{
      submissionId = "local-smoke-test"
      source = $source
      robotModel = "FR5"
      pointsTable = "points_HCM.json"
      modelAvailable = $false
      action = "real_run"
    } | ConvertTo-Json)
  $confirmed = Invoke-RestMethod -Method Post -UseBasicParsing `
    -Uri "http://127.0.0.1:8787/v1/teacher/jobs/$($job.jobId)/confirm" -Headers $headers `
    -ContentType "application/json" `
    -Body (@{ confirmation = "physical_run" } | ConvertTo-Json)

  $final = $null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 250
    $final = Invoke-RestMethod -UseBasicParsing `
      -Uri "http://127.0.0.1:8787/v1/teacher/jobs/$($job.jobId)" -Headers $headers
    if ($final.status -in @("succeeded", "failed", "timeout", "cancelled")) {
      break
    }
  }
  if ($final.status -ne "succeeded") {
    throw "Local smoke job ended with status '$($final.status)': $($final.error)"
  }

  [pscustomobject]@{
    WebUrl = "http://127.0.0.1:8080"
    ApiHealth = $health.status
    AgentOnline = $agentStatus.online
    JobId = $job.jobId
    ConfirmedStatus = $confirmed.status
    FinalStatus = $final.status
    Outcome = $final.result.outcome
    Cleanup = ($final.cleanup | ConvertTo-Json -Compress)
    WebPid = $webProcess.Id
    ApiPid = $apiProcess.Id
    AgentPid = $agentProcess.Id
  } | Format-List
} catch {
  Stop-TestProcess $agentProcess
  Stop-TestProcess $apiProcess
  Stop-TestProcess $webProcess
  throw
} finally {
  if ($StopAfterTest) {
    Stop-TestProcess $agentProcess
    Stop-TestProcess $apiProcess
    Stop-TestProcess $webProcess
  }
}
