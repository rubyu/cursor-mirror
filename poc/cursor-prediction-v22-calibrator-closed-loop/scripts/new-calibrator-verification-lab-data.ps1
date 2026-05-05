param(
    [string]$OutDir = "poc/cursor-prediction-v22-calibrator-closed-loop/lab-data",
    [string]$Name = "calibrator-verification-v22",
    [int]$SampleRateHz = 240
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$coreAssembly = Join-Path $repoRoot "artifacts\bin\Release\CursorMirror.Core.dll"
if (-not (Test-Path -LiteralPath $coreAssembly)) {
    throw "CursorMirror.Core.dll was not found. Run scripts\build.ps1 -Configuration Release first."
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
[System.Reflection.Assembly]::LoadFrom($coreAssembly) | Out-Null

$resolvedOutDir = Join-Path $repoRoot $OutDir
New-Item -ItemType Directory -Force -Path $resolvedOutDir | Out-Null

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$marginX = [Math]::Max(80, [int]($screen.Width * 0.10))
$marginY = [Math]::Max(80, [int]($screen.Height * 0.18))
$bounds = [System.Drawing.Rectangle]::new(
    $screen.Left + $marginX,
    $screen.Top + $marginY,
    [Math]::Max(1, $screen.Width - ($marginX * 2)),
    [Math]::Max(1, $screen.Height - ($marginY * 2)))

function New-LabPoint {
    param(
        [double]$X,
        [double]$Y
    )

    return [CursorMirror.MotionLab.MotionLabPoint]::new(
        $bounds.Left + ($bounds.Width * $X),
        $bounds.Top + ($bounds.Height * $Y))
}

function New-SpeedPoint {
    param(
        [double]$Progress,
        [double]$Multiplier,
        [double]$EasingWidth = 0.08,
        [string]$Easing = "smoothstep"
    )

    $point = [CursorMirror.MotionLab.MotionLabSpeedPoint]::new()
    $point.Progress = $Progress
    $point.Multiplier = $Multiplier
    $point.EasingWidth = $EasingWidth
    $point.Easing = $Easing
    return $point
}

function New-HoldSegment {
    param(
        [double]$Progress,
        [double]$DurationMilliseconds,
        [double]$ResumeEasingMilliseconds = 80
    )

    $hold = [CursorMirror.MotionLab.MotionLabHoldSegment]::new()
    $hold.Progress = $Progress
    $hold.DurationMilliseconds = $DurationMilliseconds
    $hold.ResumeEasingMilliseconds = $ResumeEasingMilliseconds
    return $hold
}

function New-Scenario {
    param(
        [int]$Seed,
        [string]$Name,
        [double]$DurationMilliseconds,
        [CursorMirror.MotionLab.MotionLabPoint[]]$Points,
        [CursorMirror.MotionLab.MotionLabSpeedPoint[]]$SpeedPoints = @(),
        [CursorMirror.MotionLab.MotionLabHoldSegment[]]$HoldSegments = @()
    )

    $script = [CursorMirror.MotionLab.MotionLabScript]::new()
    $script.Seed = $Seed
    $script.GenerationProfile = "calibrator-verification-v22"
    $script.Bounds = [CursorMirror.MotionLab.MotionLabBounds]::new()
    $script.Bounds.X = $bounds.X
    $script.Bounds.Y = $bounds.Y
    $script.Bounds.Width = $bounds.Width
    $script.Bounds.Height = $bounds.Height
    $script.DurationMilliseconds = $DurationMilliseconds
    $script.SampleRateHz = $SampleRateHz
    $script.ControlPoints = $Points
    $script.SpeedPoints = $SpeedPoints
    $script.HoldSegments = $HoldSegments
    return [ordered]@{
        Name = $Name
        Script = $script
    }
}

$scenarios = @(
    (New-Scenario 22001 "slow-short-hold-floor" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.16 0.50), (New-LabPoint 0.28 0.50), (New-LabPoint 0.34 0.52))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.20 0.08 0.18), (New-SpeedPoint 0.70 0.14 0.18))) `
        ([CursorMirror.MotionLab.MotionLabHoldSegment[]]@((New-HoldSegment 0.52 900 120)))),
    (New-Scenario 22002 "constant-medium-horizontal" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.12 0.42), (New-LabPoint 0.35 0.42), (New-LabPoint 0.63 0.42), (New-LabPoint 0.88 0.42))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.00 1.00 0.01 "linear"), (New-SpeedPoint 1.00 1.00 0.01 "linear")))),
    (New-Scenario 22003 "fast-horizontal-late-stop" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.12 0.56), (New-LabPoint 0.48 0.56), (New-LabPoint 0.78 0.56), (New-LabPoint 0.90 0.56))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.10 1.90 0.05 "sine"), (New-SpeedPoint 0.72 1.60 0.06 "smoothstep"), (New-SpeedPoint 0.92 0.04 0.03 "linear"))) `
        ([CursorMirror.MotionLab.MotionLabHoldSegment[]]@((New-HoldSegment 0.94 850 60)))),
    (New-Scenario 22004 "reverse-s-curve" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.18 0.72), (New-LabPoint 0.88 0.18), (New-LabPoint 0.10 0.28), (New-LabPoint 0.82 0.70))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.18 1.25 0.09 "smoothstep"), (New-SpeedPoint 0.45 0.38 0.12 "sine"), (New-SpeedPoint 0.76 1.55 0.08 "smoothstep")))),
    (New-Scenario 22005 "fast-diagonal" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.16 0.18), (New-LabPoint 0.42 0.32), (New-LabPoint 0.64 0.68), (New-LabPoint 0.88 0.82))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.12 1.80 0.06 "sine"), (New-SpeedPoint 0.62 1.35 0.08 "smoothstep")))),
    (New-Scenario 22006 "low-speed-curve" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.25 0.26), (New-LabPoint 0.32 0.34), (New-LabPoint 0.40 0.30), (New-LabPoint 0.50 0.40), (New-LabPoint 0.58 0.36), (New-LabPoint 0.66 0.46))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.15 0.16 0.20 "smoothstep"), (New-SpeedPoint 0.55 0.10 0.20 "sine"), (New-SpeedPoint 0.84 0.20 0.16 "smoothstep")))),
    (New-Scenario 22007 "repeated-stop-resume" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.82 0.24), (New-LabPoint 0.68 0.42), (New-LabPoint 0.54 0.22), (New-LabPoint 0.40 0.48), (New-LabPoint 0.24 0.36))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.20 0.90 0.08 "smoothstep"), (New-SpeedPoint 0.52 1.25 0.07 "sine"), (New-SpeedPoint 0.78 0.72 0.10 "smoothstep"))) `
        ([CursorMirror.MotionLab.MotionLabHoldSegment[]]@((New-HoldSegment 0.26 420 90), (New-HoldSegment 0.56 520 110), (New-HoldSegment 0.84 620 90)))),
    (New-Scenario 22008 "abrupt-stop-near-end" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.15 0.66), (New-LabPoint 0.38 0.64), (New-LabPoint 0.70 0.62), (New-LabPoint 0.92 0.60))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.08 2.10 0.04 "linear"), (New-SpeedPoint 0.70 1.75 0.05 "smoothstep"), (New-SpeedPoint 0.96 0.02 0.02 "linear"))) `
        ([CursorMirror.MotionLab.MotionLabHoldSegment[]]@((New-HoldSegment 0.975 1100 40)))),
    (New-Scenario 22009 "micro-adjustments" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.48 0.50), (New-LabPoint 0.50 0.52), (New-LabPoint 0.47 0.49), (New-LabPoint 0.52 0.51), (New-LabPoint 0.49 0.48), (New-LabPoint 0.51 0.50))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.18 0.24 0.10 "smoothstep"), (New-SpeedPoint 0.42 0.12 0.14 "sine"), (New-SpeedPoint 0.76 0.30 0.10 "smoothstep"))) `
        ([CursorMirror.MotionLab.MotionLabHoldSegment[]]@((New-HoldSegment 0.38 300 80), (New-HoldSegment 0.78 420 80)))),
    (New-Scenario 22010 "mixed-speed-wide-sweep" 5000 `
        ([CursorMirror.MotionLab.MotionLabPoint[]]@((New-LabPoint 0.12 0.78), (New-LabPoint 0.28 0.14), (New-LabPoint 0.48 0.86), (New-LabPoint 0.72 0.18), (New-LabPoint 0.90 0.72))) `
        ([CursorMirror.MotionLab.MotionLabSpeedPoint[]]@((New-SpeedPoint 0.12 0.42 0.12 "smoothstep"), (New-SpeedPoint 0.34 1.70 0.07 "sine"), (New-SpeedPoint 0.60 0.18 0.16 "smoothstep"), (New-SpeedPoint 0.86 1.95 0.06 "linear"))) `
        ([CursorMirror.MotionLab.MotionLabHoldSegment[]]@((New-HoldSegment 0.64 500 120))))
)

$scenarioSet = [CursorMirror.MotionLab.MotionLabScenarioSet]::new()
$scenarioSet.Seed = 22000
$scenarioSet.GenerationProfile = "calibrator-verification-v22"
$scenarioSet.SampleRateHz = $SampleRateHz
$scenarioSet.ScenarioDurationMilliseconds = 5000
$scenarioSet.Scenarios = [CursorMirror.MotionLab.MotionLabScript[]]@($scenarios | ForEach-Object { $_.Script })

$totalDuration = 0.0
foreach ($scenario in $scenarioSet.Scenarios) {
    $totalDuration += [Math]::Max(1.0, $scenario.DurationMilliseconds)
}

$scenarioSet.DurationMilliseconds = $totalDuration

$packagePath = Join-Path $resolvedOutDir ($Name + ".zip")
([CursorMirror.MotionLab.MotionLabPackageWriter]::new()).Write($packagePath, $scenarioSet)

$manifest = [ordered]@{
    schemaVersion = "cursor-mirror-calibrator-verification-lab-data/1"
    createdUtc = (Get-Date).ToUniversalTime().ToString("o")
    package = (Split-Path -Leaf $packagePath)
    sampleRateHz = $SampleRateHz
    totalDurationMilliseconds = $totalDuration
    bounds = [ordered]@{
        x = $bounds.X
        y = $bounds.Y
        width = $bounds.Width
        height = $bounds.Height
        sourceScreen = [ordered]@{
            x = $screen.X
            y = $screen.Y
            width = $screen.Width
            height = $screen.Height
        }
    }
    scenarios = @($scenarios | ForEach-Object -Begin { $index = 0 } -Process {
        $script = $_.Script
        [ordered]@{
            index = $index++
            name = $_.Name
            durationMilliseconds = $script.DurationMilliseconds
            controlPointCount = $script.ControlPoints.Count
            speedPointCount = $script.SpeedPoints.Count
            holdSegmentCount = $script.HoldSegments.Count
        }
    })
}

$manifestPath = Join-Path $resolvedOutDir ($Name + ".manifest.json")
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8

$summaryPath = Join-Path $resolvedOutDir ($Name + ".summary.md")
$summary = New-Object System.Collections.Generic.List[string]
$summary.Add("# Calibrator Verification Lab Data")
$summary.Add("")
$summary.Add("Package: ``$packagePath``")
$summary.Add("")
$summary.Add("This package is generated specifically for Calibrator closed-loop validation. It does not depend on existing trace, motion-recording, or calibration capture packages.")
$summary.Add("")
$summary.Add("- Sample rate: ``$SampleRateHz Hz``")
$summary.Add("- Total duration: ``$([Math]::Round($totalDuration / 1000.0, 3)) s``")
$summary.Add("- Screen bounds: ``$($screen.X),$($screen.Y) $($screen.Width)x$($screen.Height)``")
$summary.Add("- Motion bounds: ``$($bounds.X),$($bounds.Y) $($bounds.Width)x$($bounds.Height)``")
$summary.Add("")
$summary.Add("## Scenarios")
$summary.Add("")
$summary.Add("| index | name | duration ms | points | speed points | holds |")
$summary.Add("| ---: | --- | ---: | ---: | ---: | ---: |")
foreach ($entry in $manifest.scenarios) {
    $summary.Add("| $($entry.index) | $($entry.name) | $($entry.durationMilliseconds) | $($entry.controlPointCount) | $($entry.speedPointCount) | $($entry.holdSegmentCount) |")
}

$summary | Set-Content -Path $summaryPath -Encoding UTF8

Write-Host "Generated Calibrator verification lab data:"
Write-Host "  Package: $packagePath"
Write-Host "  Manifest: $manifestPath"
Write-Host "  Summary: $summaryPath"
