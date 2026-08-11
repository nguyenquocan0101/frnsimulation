[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [string]$HandshakeEvidencePath = ''
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$certDirectory = [System.IO.Path]::GetFullPath((Join-Path $bridgeRoot 'certs'))
$currentManifestPath = Join-Path $certDirectory 'localhost-wss-manifest.json'
$stagedManifestPath = Join-Path $certDirectory 'localhost-wss-staged-manifest.json'
if (-not $HandshakeEvidencePath) { $HandshakeEvidencePath = Join-Path $certDirectory 'localhost-wss-handshake.json' }
$handshakeFullPath = [System.IO.Path]::GetFullPath($HandshakeEvidencePath)
if ((Split-Path -Parent $handshakeFullPath) -ne $certDirectory) { throw 'Handshake evidence must be recorded in bridge/certs.' }
foreach ($path in @($currentManifestPath, $stagedManifestPath, $handshakeFullPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing rotation prerequisite: $path" }
}

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$current = Get-Content -LiteralPath $currentManifestPath -Raw | ConvertFrom-Json
$staged = Get-Content -LiteralPath $stagedManifestPath -Raw | ConvertFrom-Json
$stagedPaths = @()
$swapped = $false
$stagedTrustBound = $false
$stagedRootTarget = $null
try {
  if ($current.owner_sid -ne $currentSid -or $staged.owner_sid -ne $currentSid -or
      $current.install_root -ne $bridgeRoot -or $staged.install_root -ne $bridgeRoot -or
      $current.install_id -ne $staged.install_id) { throw 'Rotation manifests are not owned by this installation.' }

  foreach ($manifest in @($current, $staged)) {
    foreach ($path in @($manifest.certificate.cert_path, $manifest.certificate.key_path, $manifest.certificate.der_path)) {
      if ((Split-Path -Parent ([System.IO.Path]::GetFullPath([string]$path))) -ne $certDirectory) { throw 'Manifest path is outside bridge/certs.' }
    }
  }
  $currentPaths = @($current.certificate.cert_path, $current.certificate.key_path, $current.certificate.der_path)
  $currentPaths = @($currentPaths | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_).ToUpperInvariant() })
  $stagedPaths = @($staged.certificate.cert_path, $staged.certificate.key_path, $staged.certificate.der_path)
  $stagedPaths = @($stagedPaths | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
  $stagedPathsUpper = @($stagedPaths | ForEach-Object { $_.ToUpperInvariant() })
  if (([string]$current.certificate.thumbprint).ToUpperInvariant() -eq ([string]$staged.certificate.thumbprint).ToUpperInvariant() -or
      @($currentPaths | Where-Object { $stagedPathsUpper -contains $_ }).Count -gt 0) { throw 'Staged certificate must use distinct paths and thumbprint.' }

  $currentValidation = python -m bridge.control.certificates validate --cert $current.certificate.cert_path --key $current.certificate.key_path --der $current.certificate.der_path | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $currentValidation.thumbprint -ne ([string]$current.certificate.thumbprint).ToUpperInvariant()) { throw 'Current certificate PEM does not match its manifest.' }
  $stagedValidation = python -m bridge.control.certificates validate --cert $staged.certificate.cert_path --key $staged.certificate.key_path --der $staged.certificate.der_path | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $stagedValidation.thumbprint -ne ([string]$staged.certificate.thumbprint).ToUpperInvariant()) { throw 'Staged certificate PEM does not match its manifest.' }
  $stagedPublicCertificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2([string]$staged.certificate.der_path)
  $stagedThumbprint = ([string]$staged.certificate.thumbprint).ToUpperInvariant()
  if ($stagedPublicCertificate.Thumbprint -ne $stagedThumbprint) { throw 'Staged public certificate does not match its manifest.' }
  $stagedTrustBound = $true
  $stagedRootTarget = "Cert:\CurrentUser\Root\$stagedThumbprint"

  $evidence = Get-Content -LiteralPath $handshakeFullPath -Raw | ConvertFrom-Json
  $verifiedAt = [datetimeoffset]::MinValue
  if ($evidence.endpoint -ne 'wss://localhost:8766' -or $evidence.success -ne $true -or
      -not [datetimeoffset]::TryParse([string]$evidence.verified_at, [ref]$verifiedAt) -or
      (([datetimeoffset]::UtcNow - $verifiedAt.ToUniversalTime()).Duration() -gt [timespan]::FromMinutes(15)) -or
      $evidence.thumbprint -ne $stagedThumbprint) { throw 'The staged certificate must first complete a fresh recorded localhost WSS handshake.' }
  if (-not (Test-Path -LiteralPath $stagedRootTarget)) { throw 'The staged public certificate is not trusted for the current user.' }

  if ($PSCmdlet.ShouldProcess($stagedThumbprint, 'Atomically activate a WSS-verified staged certificate and retire only the old manifest targets')) {
    $backupPath = Join-Path $certDirectory 'localhost-wss-manifest.previous.json'
    [System.IO.File]::Replace($stagedManifestPath, $currentManifestPath, $backupPath, $true)
    $swapped = $true
    $oldThumbprint = ([string]$current.certificate.thumbprint).ToUpperInvariant()
    $oldRootTarget = "Cert:\CurrentUser\Root\$oldThumbprint"
    try {
      if (Test-Path -LiteralPath $oldRootTarget) { Remove-Item -LiteralPath $oldRootTarget -ErrorAction Stop }
      foreach ($path in @($current.certificate.cert_path, $current.certificate.key_path, $current.certificate.der_path)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -ErrorAction Stop }
      }
      # Delete the old ownership record only when all old cleanup succeeds.
      if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -ErrorAction Stop }
    } catch {
      throw 'Rotation activated, but old certificate cleanup failed. The previous manifest was retained for exact manual cleanup.'
    }
  }
} catch {
  # Before the atomic swap the old manifest remains active.  Clean up only
  # staged paths already proven to be contained by this bridge/certs folder.
  if (-not $swapped -and $stagedPaths.Count -gt 0) {
    if ($stagedTrustBound -and $stagedRootTarget) {
    if (Test-Path -LiteralPath $stagedRootTarget) { Remove-Item -LiteralPath $stagedRootTarget -ErrorAction SilentlyContinue }
    }
    foreach ($path in $stagedPaths + @($stagedManifestPath)) {
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
    }
  }
  throw
}
