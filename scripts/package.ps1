param(
    [string]$Version = "0.1.0",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$configuration = "Release"
$buildScript = Join-Path $root "scripts\build.ps1"
$testScript = Join-Path $root "scripts\test.ps1"
$bin = Join-Path $root "artifacts\bin\$configuration"
$packageRoot = Join-Path $root "artifacts\package"
$stage = Join-Path $packageRoot "CursorMirror-$Version"
$zip = Join-Path $packageRoot "CursorMirror-$Version-windows.zip"
$sha = "$zip.sha256"

if (-not $SkipTests) {
    & $testScript -Configuration $configuration
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    & $buildScript -Configuration $configuration
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (Test-Path $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item -LiteralPath (Join-Path $bin "CursorMirror.exe") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $stage

if (Test-Path $zip) {
    Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zip
Set-Content -LiteralPath $sha -Value ($hash.Hash.ToLowerInvariant() + "  " + (Split-Path -Leaf $zip)) -Encoding ASCII

Write-Host "Packaged:"
Write-Host "  $zip"
Write-Host "  $sha"
