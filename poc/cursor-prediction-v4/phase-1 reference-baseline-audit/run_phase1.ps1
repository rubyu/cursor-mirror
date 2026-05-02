param(
    [string]$ZipPath = (Join-Path $PSScriptRoot "..\..\..\cursor-mirror-trace-20260501-195819.zip")
)

$ErrorActionPreference = "Stop"

node (Join-Path $PSScriptRoot "analyze_phase1.js") --zip $ZipPath --out $PSScriptRoot
