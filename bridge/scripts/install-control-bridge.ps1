[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [string]$ManifestPath = ''
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$certDirectory = [System.IO.Path]::GetFullPath((Join-Path $bridgeRoot 'certs'))
if (-not $ManifestPath) { $ManifestPath = Join-Path $certDirectory 'localhost-wss-manifest.json' }
$manifestFullPath = [System.IO.Path]::GetFullPath($ManifestPath)
if ((Split-Path -Parent $manifestFullPath) -ne $certDirectory) { throw 'Manifest must be in the repository-owned bridge/certs directory.' }
if (-not (Test-Path -LiteralPath $manifestFullPath -PathType Leaf)) { throw 'Ownership manifest must be created before trust.' }

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$manifest = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json
if ($manifest.owner_sid -ne $currentSid -or $manifest.install_root -ne $bridgeRoot) { throw 'Manifest ownership mismatch.' }
$certPathFull = [System.IO.Path]::GetFullPath([string]$manifest.certificate.cert_path)
$keyPathFull = [System.IO.Path]::GetFullPath([string]$manifest.certificate.key_path)
$derPathFull = [System.IO.Path]::GetFullPath([string]$manifest.certificate.der_path)
foreach ($candidate in @($certPathFull, $keyPathFull, $derPathFull)) {
  if ((Split-Path -Parent $candidate) -ne $certDirectory) { throw 'Manifest certificate path is outside bridge/certs.' }
}
if (-not (Test-Path -LiteralPath $derPathFull -PathType Leaf)) { throw 'Missing public localhost certificate.' }

# Never trust a file merely because a JSON manifest names it.  The PEM pair is
# checked against the strict localhost policy before the public DER is imported.
python -m bridge.control.certificates validate --cert $certPathFull --key $keyPathFull --der $derPathFull
if ($LASTEXITCODE -ne 0) { throw 'Certificate PEM validation failed.' }
$publicCertificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($derPathFull)
$manifestThumbprint = ([string]$manifest.certificate.thumbprint).ToUpperInvariant()
if ($publicCertificate.Thumbprint -ne $manifestThumbprint) { throw 'Public certificate does not match the ownership manifest.' }

if ($PSCmdlet.ShouldProcess('Cert:\CurrentUser\Root', 'Trust the public localhost WSS certificate for this user')) {
  $imported = $null
  try {
    $imported = Import-Certificate -FilePath $derPathFull -CertStoreLocation 'Cert:\CurrentUser\Root'
    $trusted = Get-ChildItem -LiteralPath ("Cert:\CurrentUser\Root\" + $imported.Thumbprint)
    if ($trusted.HasPrivateKey -or $trusted.Thumbprint -ne $manifestThumbprint) { throw 'Trusted Root item verification failed.' }
  } catch {
    if ($imported) {
      $rollbackTarget = "Cert:\CurrentUser\Root\$($imported.Thumbprint)"
      if (Test-Path -LiteralPath $rollbackTarget) { Remove-Item -LiteralPath $rollbackTarget }
    }
    throw
  }
}
