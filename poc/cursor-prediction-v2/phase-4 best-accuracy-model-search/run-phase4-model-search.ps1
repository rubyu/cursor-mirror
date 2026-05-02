param(
    [string]$PythonPath = (Join-Path (Get-Location) "poc/cursor-prediction/step-5 neural-models/.venv/Scripts/python.exe"),
    [string]$ZipPath = (Join-Path (Get-Location) "cursor-mirror-trace-20260501-091537.zip"),
    [string]$Phase1ScoresPath = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json"),
    [string]$OutputDir = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-4 best-accuracy-model-search")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python not found: $PythonPath" }
if (-not (Test-Path -LiteralPath $ZipPath)) { throw "Trace zip not found: $ZipPath" }
if (-not (Test-Path -LiteralPath $Phase1ScoresPath)) { throw "Phase 1 scores not found: $Phase1ScoresPath" }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

& $PythonPath `
    (Join-Path $OutputDir "run_phase4_model_search.py") `
    --zip-path $ZipPath `
    --phase1-scores-path $Phase1ScoresPath `
    --output-dir $OutputDir
