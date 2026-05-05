param(
    [string]$MotionPackage = "",

    [string]$Model = "LeastSquares",
    [int]$TargetOffsetMilliseconds = 0,
    [int]$DurationSeconds = 50,
    [string]$RuntimeMode = "ProductRuntime",
    [string]$OutputRoot = "artifacts/calibrator-v23",
    [string]$VariantName = "",
    [Nullable[int]]$RuntimeWakeAdvanceMilliseconds = $null,
    [Nullable[int]]$RuntimeFineWaitMicroseconds = $null,
    [Nullable[int]]$RuntimeYieldThresholdMicroseconds = $null,
    [Nullable[int]]$RuntimeDeadlineMessageDeferralMicroseconds = $null,
    [switch]$RuntimeSetWaitableTimerEx,
    [switch]$RuntimeThreadLatencyProfile
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$calibrator = Join-Path $repoRoot "artifacts\bin\Release\CursorMirror.Calibrator.exe"
if (-not (Test-Path -LiteralPath $calibrator)) {
    throw "Calibrator executable was not found. Run scripts\build.ps1 -Configuration Release first."
}

if ([string]::IsNullOrWhiteSpace($MotionPackage)) {
    $MotionPackage = Join-Path $repoRoot "poc\cursor-prediction-v22-calibrator-closed-loop\lab-data\calibrator-verification-v22.zip"
}

$motionPath = Resolve-Path $MotionPackage
if ([string]::IsNullOrWhiteSpace($VariantName)) {
    $safeModel = $Model -replace '[^A-Za-z0-9_-]', ''
    $VariantName = "$safeModel-offset$TargetOffsetMilliseconds-${DurationSeconds}s"
}

$outputDirectory = Join-Path $repoRoot (Join-Path $OutputRoot $VariantName)
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$calibrationOutput = Join-Path $outputDirectory "calibration.zip"
$runtimeOutput = Join-Path $outputDirectory "product-runtime.zip"
$commandLinePath = Join-Path $outputDirectory "command.txt"

$arguments = @(
    "--auto-run",
    "--exit-after-run",
    "--duration-seconds", $DurationSeconds.ToString([System.Globalization.CultureInfo]::InvariantCulture),
    "--motion-package", $motionPath.Path,
    "--runtime-mode", $RuntimeMode,
    "--dwm-prediction-model", $Model,
    "--dwm-target-offset-ms", $TargetOffsetMilliseconds.ToString([System.Globalization.CultureInfo]::InvariantCulture),
    "--output", $calibrationOutput,
    "--product-runtime-outlier-output", $runtimeOutput
)

if ($RuntimeWakeAdvanceMilliseconds.HasValue) {
    $arguments += @("--runtime-wake-advance-ms", $RuntimeWakeAdvanceMilliseconds.Value.ToString([System.Globalization.CultureInfo]::InvariantCulture))
}

if ($RuntimeFineWaitMicroseconds.HasValue) {
    $arguments += @("--runtime-fine-wait-us", $RuntimeFineWaitMicroseconds.Value.ToString([System.Globalization.CultureInfo]::InvariantCulture))
}

if ($RuntimeYieldThresholdMicroseconds.HasValue) {
    $arguments += @("--runtime-yield-threshold-us", $RuntimeYieldThresholdMicroseconds.Value.ToString([System.Globalization.CultureInfo]::InvariantCulture))
}

if ($RuntimeDeadlineMessageDeferralMicroseconds.HasValue) {
    $arguments += @("--runtime-deadline-message-deferral-us", $RuntimeDeadlineMessageDeferralMicroseconds.Value.ToString([System.Globalization.CultureInfo]::InvariantCulture))
}

if ($RuntimeSetWaitableTimerEx.IsPresent) {
    $arguments += "--runtime-set-waitable-timer-ex"
}

if ($RuntimeThreadLatencyProfile.IsPresent) {
    $arguments += "--runtime-thread-latency-profile"
}

function ConvertTo-CommandLineArgument {
    param([string]$Value)

    if ($null -eq $Value) {
        return '""'
    }

    if ($Value.Length -gt 0 -and $Value.IndexOfAny([char[]]@(' ', "`t", "`n", "`r", '"')) -lt 0) {
        return $Value
    }

    return '"' + ($Value -replace '"', '\"') + '"'
}

("`"" + $calibrator + "`" " + (($arguments | ForEach-Object { "`"" + $_ + "`"" }) -join " ")) |
    Set-Content -Path $commandLinePath -Encoding UTF8

Write-Host "Launching Calibrator variant:"
Write-Host "  Variant: $VariantName"
Write-Host "  Calibration: $calibrationOutput"
Write-Host "  Product runtime: $runtimeOutput"
Write-Host "  Command: $commandLinePath"
Write-Host ""
Write-Host "This will move the real cursor, enter full screen, and block user mouse input until completion or any key press."

$argumentLine = (($arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " ")
$process = Start-Process -FilePath $calibrator -ArgumentList $argumentLine -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Calibrator exited with code $($process.ExitCode)."
}

Write-Host "Completed variant: $VariantName"

