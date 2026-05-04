param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [int]$Frames = 360,

    [string]$OutputDirectory = (Join-Path $PSScriptRoot "out"),

    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

if (-not $NoBuild) {
    & (Join-Path $PSScriptRoot "build.ps1") -Configuration $Configuration
}

$exe = Join-Path $PSScriptRoot "bin\$Configuration\SyntheticOverlayHarness.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Harness executable not found at '$exe'."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
& $exe --output $OutputDirectory --frames $Frames
if ($LASTEXITCODE -ne 0) {
    throw "Synthetic overlay harness failed."
}

Write-Host "Report: $(Join-Path $OutputDirectory "report.md")"
