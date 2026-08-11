[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$')][string]$StageName = 'localhost-staged',
  [string]$InstallId = '',
  [ValidateSet('localhost-wss-manifest.json', 'localhost-wss-staged-manifest.json')][string]$ManifestName = 'localhost-wss-manifest.json'
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$certDirectory = [System.IO.Path]::GetFullPath((Join-Path $bridgeRoot 'certs'))
$manifestPath = Join-Path $certDirectory $ManifestName
$certificatePath = Join-Path $certDirectory ($StageName + '-cert.pem')
$keyPath = Join-Path $certDirectory ($StageName + '-key.pem')
$currentManifestPath = Join-Path $certDirectory 'localhost-wss-manifest.json'
if ($ManifestName -eq 'localhost-wss-staged-manifest.json' -and (Test-Path -LiteralPath $currentManifestPath -PathType Leaf)) {
  $currentManifest = Get-Content -LiteralPath $currentManifestPath -Raw | ConvertFrom-Json
  if ($InstallId -and $InstallId -ne $currentManifest.install_id) { throw 'A staged manifest must keep the existing installation identity.' }
  $InstallId = [string]$currentManifest.install_id
}
if (-not $InstallId) { $InstallId = 'localhost-wss-' + [guid]::NewGuid().ToString('N') }
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$homeDirectory = [Environment]::GetFolderPath('UserProfile')
$shortcuts = @(
  (Join-Path $homeDirectory 'Desktop\Start TechCamp Bridge.lnk'),
  (Join-Path $homeDirectory 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Start TechCamp Bridge.lnk')
)

if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf) -or -not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
  throw 'Generate the staged PEM certificate pair before creating its ownership manifest.'
}
if ($PSCmdlet.ShouldProcess($manifestPath, 'Create the local ownership manifest for this user')) {
  if (Test-Path -LiteralPath $manifestPath) { throw 'Ownership manifest already exists; use an explicit rotation workflow.' }
  $result = python -m bridge.control.certificates validate --cert $certificatePath --key $keyPath
  if ($LASTEXITCODE -ne 0) { throw 'Certificate PEM validation failed.' }
  $thumbprint = ($result | ConvertFrom-Json).thumbprint
  $json = python -m bridge.control.certificates manifest --install-id $InstallId --owner-sid $currentSid --cert $certificatePath --key $keyPath --thumbprint $thumbprint --shortcut $shortcuts[0] --shortcut $shortcuts[1]
  if ($LASTEXITCODE -ne 0) { throw 'Ownership manifest validation failed.' }
  $temporaryPath = $manifestPath + '.tmp-' + [guid]::NewGuid().ToString('N')
  try {
    [System.IO.File]::WriteAllText($temporaryPath, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $manifestPath
  } catch {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -ErrorAction SilentlyContinue }
    throw
  }
}
