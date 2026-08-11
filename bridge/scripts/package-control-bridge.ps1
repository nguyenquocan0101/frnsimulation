param([string]$Output = (Join-Path (Get-Location) 'control-bridge-package'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Output | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\control.example.json') $Output -Force
Copy-Item (Join-Path $PSScriptRoot '..\control-requirements.txt') $Output -Force
Write-Host "Prepared dry-run control package at $Output"
