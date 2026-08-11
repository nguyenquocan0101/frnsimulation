[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$')][string]$StageName = 'localhost-staged',
  [ValidateRange(1, 30)][int]$ValidDays = 30
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$certDirectory = [System.IO.Path]::GetFullPath((Join-Path $bridgeRoot 'certs'))
$certificatePath = Join-Path $certDirectory ($StageName + '-cert.pem')
$keyPath = Join-Path $certDirectory ($StageName + '-key.pem')
$derPath = Join-Path $certDirectory ($StageName + '-cert.cer')
$createdPaths = @($certificatePath, $keyPath, $derPath)

if ($PSCmdlet.ShouldProcess($certDirectory, 'Generate a protected machine-local localhost WSS certificate and PEM key')) {
  foreach ($path in $createdPaths) {
    if (Test-Path -LiteralPath $path) { throw 'Refusing to overwrite existing certificate material; choose a new staged name.' }
  }

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  New-Item -ItemType Directory -Force -Path $certDirectory | Out-Null
  try {
    # Only the repository-owned bridge/certs directory is hardened.  A caller
    # cannot supply an arbitrary directory for this operation.
    $directoryAcl = New-Object System.Security.AccessControl.DirectorySecurity
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryAcl.SetOwner($currentSid)
    $directoryAcl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($currentSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $certDirectory -AclObject $directoryAcl

    python -m bridge.control.certificates generate --cert $certificatePath --key $keyPath --der $derPath --valid-days $ValidDays
    if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed.' }
    python -m bridge.control.certificates validate --cert $certificatePath --key $keyPath --der $derPath
    if ($LASTEXITCODE -ne 0) { throw 'Generated PEM pair did not meet the localhost WSS policy.' }

    # The private key is the only secret: remove inherited and broad rules,
    # retain FullControl only for this Windows user, then verify the result.
    $keyAcl = New-Object System.Security.AccessControl.FileSecurity
    $keyAcl.SetAccessRuleProtection($true, $false)
    $keyAcl.SetOwner($currentSid)
    [void]$keyAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($currentSid, 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $keyPath -AclObject $keyAcl
    $verifiedAcl = Get-Acl -LiteralPath $keyPath
    if (-not $verifiedAcl.AreAccessRulesProtected -or $verifiedAcl.Access.Count -ne 1 -or
        $verifiedAcl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $currentSid.Value) {
      throw 'Private key ACL verification failed.'
    }
  } catch {
    # Roll back only the exact staged files created by this invocation.
    foreach ($path in $createdPaths) {
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
    }
    throw
  }
}
