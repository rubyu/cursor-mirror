param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",
    [switch]$RequireStableTag
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$buildArgs = @{
    Configuration = $Configuration
}
if ($RequireStableTag) {
    $buildArgs.RequireStableTag = $true
}

& (Join-Path $root "scripts\build.ps1") @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$tests = Join-Path $root "artifacts\bin\$Configuration\CursorMirror.Tests.exe"
& $tests
exit $LASTEXITCODE
