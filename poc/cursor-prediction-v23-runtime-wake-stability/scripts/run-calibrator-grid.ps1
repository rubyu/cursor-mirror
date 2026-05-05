param(
    [string]$MotionPackage = "",
    [int]$DurationSeconds = 50,
    [string]$OutputRoot = "artifacts/calibrator-v23"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
if ([string]::IsNullOrWhiteSpace($MotionPackage)) {
    $MotionPackage = Join-Path $repoRoot "poc\cursor-prediction-v22-calibrator-closed-loop\lab-data\calibrator-verification-v22.zip"
}

$variants = @(
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-baseline" },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-setex"; SetEx = $true },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-fine1000"; Fine = 1000; Yield = 250 },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-fine2000"; Fine = 2000; Yield = 500 },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-deferral1000"; Deferral = 1000 },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-setex-fine1000"; SetEx = $true; Fine = 1000; Yield = 250 },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-setex-fine1000-deferral1000"; SetEx = $true; Fine = 1000; Yield = 250; Deferral = 1000 },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-setex-fine1000-deferral1000-mmcss"; SetEx = $true; Fine = 1000; Yield = 250; Deferral = 1000; Mmcss = $true },
    @{ Model = "LeastSquares"; Offset = 0; Name = "lsq-setex-fine1000-mmcss"; SetEx = $true; Fine = 1000; Yield = 250; Mmcss = $true },
    @{ Model = "ConstantVelocity"; Offset = 2; Name = "cv-plus2-setex-fine1000"; SetEx = $true; Fine = 1000; Yield = 250 },
    @{ Model = "ConstantVelocity"; Offset = 2; Name = "cv-plus2-setex-fine1000-deferral1000"; SetEx = $true; Fine = 1000; Yield = 250; Deferral = 1000 }
)

foreach ($variant in $variants) {
    $parameters = @{
        MotionPackage = $MotionPackage
        Model = $variant.Model
        TargetOffsetMilliseconds = $variant.Offset
        DurationSeconds = $DurationSeconds
        OutputRoot = $OutputRoot
        VariantName = $variant.Name
    }

    if ($variant.ContainsKey("Fine")) {
        $parameters.RuntimeFineWaitMicroseconds = $variant.Fine
    }

    if ($variant.ContainsKey("Yield")) {
        $parameters.RuntimeYieldThresholdMicroseconds = $variant.Yield
    }

    if ($variant.ContainsKey("Deferral")) {
        $parameters.RuntimeDeadlineMessageDeferralMicroseconds = $variant.Deferral
    }

    if ($variant.ContainsKey("SetEx") -and $variant.SetEx) {
        $parameters.RuntimeSetWaitableTimerEx = $true
    }

    if ($variant.ContainsKey("Mmcss") -and $variant.Mmcss) {
        $parameters.RuntimeThreadLatencyProfile = $true
    }

    & (Join-Path $PSScriptRoot "run-calibrator-variant.ps1") @parameters
}
