Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path (Split-Path -Parent $scriptRoot) 'Sticker'
$outputRoot = Join-Path $scriptRoot 'assets\random-picker'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

1..8 | ForEach-Object {
  $source = Join-Path $sourceRoot ("Sticker ({0}).png" -f $_)
  $target = Join-Path $outputRoot ("sticker-{0:D2}.webp" -f $_)
  ffmpeg -y -loglevel error -i $source `
    -vf 'scale=348:348:force_original_aspect_ratio=decrease,pad=360:360:(ow-iw)/2:(oh-ih)/2:color=0x00000000' `
    -c:v libwebp -q:v 82 -compression_level 6 $target
}
