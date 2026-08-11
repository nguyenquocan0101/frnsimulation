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
if (-not (Test-Path -LiteralPath $manifestFullPath -PathType Leaf)) { throw 'Missing ownership manifest.' }

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$manifest = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json
if ($manifest.owner_sid -ne $currentSid -or $manifest.install_root -ne $bridgeRoot) { throw 'Manifest ownership mismatch.' }
$thumbprint = [string]$manifest.certificate.thumbprint
if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'Invalid manifest thumbprint.' }
$ownedFiles = @(
  [string]$manifest.certificate.cert_path,
  [string]$manifest.certificate.key_path,
  [string]$manifest.certificate.der_path
)
foreach ($file in $ownedFiles) {
  if ((Split-Path -Parent ([System.IO.Path]::GetFullPath($file))) -ne $certDirectory) { throw 'Manifest file is outside bridge/certs.' }
}
$homeDirectory = [Environment]::GetFolderPath('UserProfile')
$allowedShortcuts = @(
  (Join-Path $homeDirectory 'Desktop\Start TechCamp Bridge.lnk'),
  (Join-Path $homeDirectory 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Start TechCamp Bridge.lnk')
)
$actualShortcutSet = [string]::Join('|', @($manifest.shortcuts | ForEach-Object { [System.IO.Path]::GetFullPath($_) } | Sort-Object))
$expectedShortcutSet = [string]::Join('|', @($allowedShortcuts | ForEach-Object { [System.IO.Path]::GetFullPath($_) } | Sort-Object))
if ($actualShortcutSet -ne $expectedShortcutSet) { throw 'Manifest shortcut target mismatch.' }

if ($PSCmdlet.ShouldProcess($thumbprint, 'Remove only the manifest-recorded Current User trusted certificate and local artifacts')) {
  $certificateTarget = "Cert:\CurrentUser\Root\$thumbprint"
  if (Test-Path -LiteralPath $certificateTarget) { Remove-Item -LiteralPath $certificateTarget }
  foreach ($path in $ownedFiles + @($manifest.shortcuts, $manifestFullPath)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
  }
}
