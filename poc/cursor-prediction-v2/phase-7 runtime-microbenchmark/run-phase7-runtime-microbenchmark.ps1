param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [string]$TraceZip = "",
    [string]$OutputDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$sourcePath = Join-Path $PSScriptRoot "RuntimeMicrobenchmark.cs"
$source = Get-Content -Raw -LiteralPath $sourcePath

Add-Type -TypeDefinition $source -Language CSharp

[CursorPredictionV2.Phase7.RuntimeMicrobenchmark]::Run(
    (Resolve-Path -LiteralPath $RepoRoot).Path,
    (Resolve-Path -LiteralPath $OutputDir).Path,
    $TraceZip
)
