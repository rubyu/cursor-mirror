param(
    [string]$Python = "poc\cursor-prediction\step-5 neural-models\.venv\Scripts\python.exe",
    [string]$TraceZip = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $ScriptDir "run_phase6_distillation.py"

$argsList = @($Runner)
if ($TraceZip -ne "") {
    $argsList += @("--trace-zip", $TraceZip)
}

& $Python @argsList
