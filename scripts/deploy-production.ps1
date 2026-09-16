[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TunnelUrl,

  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$webRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path
$configPath = Join-Path $webRoot "onnx-submission-config.mjs"
$normalizedUrl = $TunnelUrl.TrimEnd("/")

function Resolve-VercelCommand {
  $installed = Get-Command vercel.cmd -ErrorAction SilentlyContinue
  if ($installed) {
    return $installed.Source
  }

  $npxRoot = Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
  if (Test-Path $npxRoot) {
    $cached = Get-ChildItem $npxRoot -Filter "vercel.cmd" -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($cached) {
      return $cached.FullName
    }
  }

  throw "Vercel CLI was not found. Install it with 'npm install --global vercel@59.17.0' and retry."
}

try {
  $uri = [Uri]$normalizedUrl
} catch {
  throw "TunnelUrl must be a valid HTTPS URL."
}

if ($uri.Scheme -ne "https" -or $uri.IsLoopback) {
  throw "TunnelUrl must be a non-loopback HTTPS URL."
}

Write-Host "Checking control plane: $normalizedUrl/healthz"
$health = Invoke-WebRequest -UseBasicParsing -Uri "$normalizedUrl/healthz" -TimeoutSec 20
if ($health.StatusCode -ne 200) {
  throw "Control plane health check returned HTTP $($health.StatusCode)."
}

Push-Location $webRoot
try {
  $vercelCommand = Resolve-VercelCommand
  $linkPath = Join-Path $webRoot ".vercel\project.json"
  if (-not (Test-Path -LiteralPath $linkPath)) {
    throw "No Vercel project is linked. Log in with the account that owns the production domain, then run 'vercel link --project fairino-robot-simulator'."
  }
  $link = Get-Content -LiteralPath $linkPath -Raw | ConvertFrom-Json
  if ($link.projectName -ne "fairino-robot-simulator") {
    throw "The linked Vercel project is '$($link.projectName)', not 'fairino-robot-simulator'. Deployment stopped."
  }
  Write-Host "Checking Vercel login"
  & $vercelCommand whoami
  if ($LASTEXITCODE -ne 0) {
    throw "Vercel is not logged in. Run 'npx vercel login' and retry."
  }

  if (-not $SkipTests) {
    Write-Host "Running frontend tests"
    & npm test
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend tests failed; deployment was not started."
    }
  }

  $source = [IO.File]::ReadAllText($configPath)
  $pattern = '(?m)^(\s*globalThis\.__TECHCAMP_ONNX_API_URL__\s*\|\|\s*")[^"]*(";\s*)$'
  $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
    param([System.Text.RegularExpressions.Match]$match)
    $match.Groups[1].Value + $normalizedUrl + $match.Groups[2].Value
  }
  $updated = [regex]::Replace($source, $pattern, $evaluator)
  if ($updated -eq $source) {
    throw "Could not find the production API URL in onnx-submission-config.mjs."
  }
  [IO.File]::WriteAllText($configPath, $updated, [Text.UTF8Encoding]::new($false))
  Write-Host "Updated onnx-submission-config.mjs"

  Write-Host "Deploying production to Vercel"
  & $vercelCommand --prod
  if ($LASTEXITCODE -ne 0) {
    throw "Vercel deployment failed. The API URL remains updated locally; inspect the error and retry."
  }
} finally {
  Pop-Location
}
