param(
    [string]$Version,
    [switch]$SkipTests,
    [switch]$RequireStableTag
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$configuration = "Release"
$buildScript = Join-Path $root "scripts\build.ps1"
$testScript = Join-Path $root "scripts\test.ps1"
$bin = Join-Path $root "artifacts\bin\$configuration"
$packageRoot = Join-Path $root "artifacts\package"
$versionJson = Join-Path $bin "CursorMirror.version.json"

if (-not $SkipTests) {
    $testArgs = @{
        Configuration = $configuration
    }
    if ($RequireStableTag) {
        $testArgs.RequireStableTag = $true
    }

    & $testScript @testArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    $buildArgs = @{
        Configuration = $configuration
    }
    if ($RequireStableTag) {
        $buildArgs.RequireStableTag = $true
    }

    & $buildScript @buildArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$versionInfo = Get-Content -LiteralPath $versionJson -Raw | ConvertFrom-Json
if (-not [string]::IsNullOrWhiteSpace($Version) -and $Version -ne $versionInfo.PackageVersion) {
    throw "Package version '$Version' does not match resolved build version '$($versionInfo.PackageVersion)'."
}

$packageVersion = $versionInfo.PackageVersion
$stage = Join-Path $packageRoot "CursorMirror-$packageVersion"
$zip = Join-Path $packageRoot "CursorMirror-$packageVersion-windows.zip"
$sha = "$zip.sha256"

if (Test-Path $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item -LiteralPath (Join-Path $bin "CursorMirror.exe") -Destination $stage
Copy-Item -LiteralPath (Join-Path $bin "CursorMirror.Core.dll") -Destination $stage
Copy-Item -LiteralPath (Join-Path $bin "CursorMirror.TraceTool.exe") -Destination $stage
Copy-Item -LiteralPath (Join-Path $bin "CursorMirror.Demo.exe") -Destination $stage
Copy-Item -LiteralPath (Join-Path $bin "CursorMirror.Calibrator.exe") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "CONTRIBUTING.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination $stage

if (Test-Path $zip) {
    Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zip
Set-Content -LiteralPath $sha -Value ($hash.Hash.ToLowerInvariant() + "  " + (Split-Path -Leaf $zip)) -Encoding ASCII

Write-Host "Packaged:"
Write-Host "  Version: $($versionInfo.InformationalVersion)"
Write-Host "  $zip"
Write-Host "  $sha"
