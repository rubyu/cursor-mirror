$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$Python = Join-Path $RepoRoot "poc\cursor-prediction\step-5 neural-models\.venv\Scripts\python.exe"
$Script = Join-Path $PSScriptRoot "run_phase5_robustness.py"

& $Python $Script `
  --zip-path (Join-Path $RepoRoot "cursor-mirror-trace-20260501-091537.zip") `
  --compatibility-zip-paths (Join-Path $RepoRoot "cursor-mirror-trace-20260501-000443.zip") `
  --phase1-scores-path (Join-Path $RepoRoot "poc\cursor-prediction-v2\phase-1 data-audit-timebase\scores.json") `
  --phase4-runner-path (Join-Path $RepoRoot "poc\cursor-prediction-v2\phase-4 best-accuracy-model-search\run_phase4_model_search.py") `
  --output-dir $PSScriptRoot
