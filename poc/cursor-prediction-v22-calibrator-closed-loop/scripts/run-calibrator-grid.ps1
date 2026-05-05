param(
    [string]$MotionPackage = "",
    [int]$DurationSeconds = 50,
    [string]$OutputRoot = "artifacts/calibrator-v22"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
if ([string]::IsNullOrWhiteSpace($MotionPackage)) {
    $MotionPackage = Join-Path $repoRoot "poc\cursor-prediction-v22-calibrator-closed-loop\lab-data\calibrator-verification-v22.zip"
}

$variants = @(
    @{ Model = "ConstantVelocity"; Offset = 2; Name = "constant-velocity-offset-plus2" },
    @{ Model = "ConstantVelocity"; Offset = 0; Name = "constant-velocity-offset-0" },
    @{ Model = "ConstantVelocity"; Offset = -2; Name = "constant-velocity-offset-minus2" },
    @{ Model = "LeastSquares"; Offset = 0; Name = "least-squares-offset-0" },
    @{ Model = "DistilledMLP"; Offset = -4; Name = "distilled-mlp-offset-minus4" },
    @{ Model = "RuntimeEventSafeMLP"; Offset = -4; Name = "runtime-event-safe-mlp-offset-minus4" },
    @{ Model = "RuntimeEventSafeMLP"; Offset = -2; Name = "runtime-event-safe-mlp-offset-minus2" }
)

foreach ($variant in $variants) {
    & (Join-Path $PSScriptRoot "run-calibrator-variant.ps1") `
        -MotionPackage $MotionPackage `
        -Model $variant.Model `
        -TargetOffsetMilliseconds $variant.Offset `
        -DurationSeconds $DurationSeconds `
        -OutputRoot $OutputRoot `
        -VariantName $variant.Name
}
