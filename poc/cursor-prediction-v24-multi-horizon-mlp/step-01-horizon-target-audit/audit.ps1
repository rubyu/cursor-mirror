param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"

$stepRoot = $PSScriptRoot
$modelPath = Join-Path $RepoRoot "src\CursorMirror.Core\SmoothPredictorModel.g.cs"
$settingsPath = Join-Path $RepoRoot "src\CursorMirror.Core\CursorMirrorSettings.cs"
$predictorPath = Join-Path $RepoRoot "src\CursorMirror.Core\DwmAwareCursorPositionPredictor.cs"
$v21ScoresPath = Join-Path $RepoRoot "poc\cursor-prediction-v21\step-07-runtime-only-correction\scores.json"
$scoresOut = Join-Path $stepRoot "scores.json"
$reportOut = Join-Path $stepRoot "report.md"

function Read-Text([string]$Path) {
    return [System.IO.File]::ReadAllText($Path)
}

function Parse-ConstInt([string]$Text, [string]$Name) {
    $match = [regex]::Match($Text, "public const int $Name\s*=\s*(?<value>-?\d+)")
    if (-not $match.Success) {
        throw "Constant '$Name' was not found."
    }

    return [int]$match.Groups["value"].Value
}

function Parse-FloatArray([string]$Text, [string]$Name) {
    $match = [regex]::Match($Text, "$Name\s*=\s*new float\[\]\s*\{(?<body>.*?)\};", [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $match.Success) {
        throw "Array '$Name' was not found."
    }

    $values = @()
    foreach ($m in [regex]::Matches($match.Groups["body"].Value, "[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:E[-+]?\d+)?f?", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $literal = $m.Value.TrimEnd("f", "F")
        $values += [double]::Parse($literal, [System.Globalization.CultureInfo]::InvariantCulture)
    }

    return $values
}

function Percent([double]$Value) {
    return [Math]::Round($Value * 100.0, 3)
}

$modelText = Read-Text $modelPath
$settingsText = Read-Text $settingsPath
$predictorText = Read-Text $predictorPath
$featureMean = Parse-FloatArray $modelText "FeatureMean"
$featureStd = Parse-FloatArray $modelText "FeatureStd"

$featureCount = Parse-ConstInt $modelText "FeatureCount"
$hidden = Parse-ConstInt $modelText "Hidden"
$estimatedMacs = Parse-ConstInt $modelText "EstimatedMacs"
$parameterCount = Parse-ConstInt $modelText "ParameterCount"

$displayOriginMs = Parse-ConstInt $settingsText "DwmPredictionTargetOffsetDisplayOriginMilliseconds"
$displayMinMs = Parse-ConstInt $settingsText "MinimumDwmPredictionTargetOffsetDisplayMilliseconds"
$displayMaxMs = Parse-ConstInt $settingsText "MaximumDwmPredictionTargetOffsetDisplayMilliseconds"
$defaultDisplayMs = Parse-ConstInt $settingsText "DefaultDwmPredictionTargetOffsetDisplayMilliseconds"
$defaultInternalMs = $displayOriginMs + $defaultDisplayMs
$internalMinMs = $displayOriginMs + $displayMinMs
$internalMaxMs = $displayOriginMs + $displayMaxMs

$horizonFeatureMean = $featureMean[0]
$horizonFeatureStd = $featureStd[0]
$refreshMs = 16.6667
$horizonMeanMs = $horizonFeatureMean * $refreshMs
$horizonStdMs = $horizonFeatureStd * $refreshMs

$sweep = @(-32, -24, -16, -8, 0, 8, 16, 24, 32)
$sweepRows = @()
foreach ($display in $sweep) {
    $internal = $displayOriginMs + $display
    $relativeToDefaultMs = $display - $defaultDisplayMs
    $zShift = if ($horizonStdMs -gt 0) { $relativeToDefaultMs / $horizonStdMs } else { 0 }
    $sweepRows += [pscustomobject]@{
        displayOffsetMilliseconds = $display
        internalOffsetMilliseconds = $internal
        relativeToDefaultMilliseconds = $relativeToDefaultMs
        approximateTrainingStdShift = [Math]::Round($zShift, 3)
    }
}

$scores = Get-Content -LiteralPath $v21ScoresPath -Raw | ConvertFrom-Json
$seedSummary = $scores.seedSummary.mlp_h32_event_safe_runtime_latch_cap0p35
$productMetrics = $scores.conclusionHints.productMetrics

$smoothSummary = [ordered]@{
    seedCount = $seedSummary.seedCount
    objectiveMean = [Math]::Round([double]$seedSummary.objective.mean, 6)
    objectiveWorst = [Math]::Round([double]$seedSummary.objective.worst, 6)
    normalVisualP95Mean = [Math]::Round([double]$seedSummary.metrics.'test.normal.visual.p95'.mean, 6)
    normalVisualP99Mean = [Math]::Round([double]$seedSummary.metrics.'test.normal.visual.p99'.mean, 6)
    peakLeadMaxWorst = [Math]::Round([double]$seedSummary.metrics.'robustness.peakLead.max'.worst, 6)
    returnMotionMaxWorst = [Math]::Round([double]$seedSummary.metrics.'robustness.returnMotion.max'.worst, 6)
    futureLeadP99Worst = [Math]::Round([double]$seedSummary.metrics.'overall.futureLead.p99'.worst, 6)
    futureLagP95Worst = [Math]::Round([double]$seedSummary.metrics.'overall.futureLag.p95'.worst, 6)
}

$usesHorizonFeature = $predictorText.Contains("_smoothPredictorInput[0] = (float)(horizonMilliseconds / 16.67)")
$usesRuntimeTargetDisplacement = $predictorText.Contains("runtimeTargetDisplacement = velocity2.Speed * Math.Max(0.0, horizonMilliseconds) / 1000.0")
$rejectsOver125Refresh = $predictorText.Contains("(double)horizonTicks > effectiveRefreshPeriodTicks * 1.25")
$appliesCapAfterReject = $predictorText.IndexOf("horizonTicks = ApplyHorizonCap(horizonTicks", [System.StringComparison]::Ordinal) -gt $predictorText.IndexOf("HorizonOver125xRefreshPeriod", [System.StringComparison]::Ordinal)

$result = [ordered]@{
    schemaVersion = "cursor-prediction-v24-step-01-horizon-target-audit/1"
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceFiles = [ordered]@{
        model = "src/CursorMirror.Core/SmoothPredictorModel.g.cs"
        settings = "src/CursorMirror.Core/CursorMirrorSettings.cs"
        predictor = "src/CursorMirror.Core/DwmAwareCursorPositionPredictor.cs"
        v21Scores = "poc/cursor-prediction-v21/step-07-runtime-only-correction/scores.json"
    }
    currentModel = [ordered]@{
        name = "SmoothPredictor"
        featureCount = $featureCount
        hidden = $hidden
        estimatedMacs = $estimatedMacs
        parameterCount = $parameterCount
        horizonFeature = [ordered]@{
            rawMean = [Math]::Round($horizonFeatureMean, 9)
            rawStd = [Math]::Round($horizonFeatureStd, 9)
            approximateMeanMilliseconds = [Math]::Round($horizonMeanMs, 6)
            approximateStdMilliseconds = [Math]::Round($horizonStdMs, 6)
            note = "The model normalizes horizonMs / 16.67. This estimates the training horizon distribution from generated model normalization constants."
        }
    }
    targetCorrection = [ordered]@{
        displayOriginMilliseconds = $displayOriginMs
        defaultDisplayMilliseconds = $defaultDisplayMs
        defaultInternalMilliseconds = $defaultInternalMs
        displayMinimumMilliseconds = $displayMinMs
        displayMaximumMilliseconds = $displayMaxMs
        internalMinimumMilliseconds = $internalMinMs
        internalMaximumMilliseconds = $internalMaxMs
        sweep = $sweepRows
    }
    productRuntimeStructure = [ordered]@{
        horizonIsInputFeature = $usesHorizonFeature
        runtimeTargetDisplacementUsesHorizon = $usesRuntimeTargetDisplacement
        rejectsHorizonOver125PercentRefreshBeforeCap = $rejectsOver125Refresh
        horizonCapAppliedAfter125PercentReject = $appliesCapAfterReject
    }
    v21SmoothPredictorSummary = $smoothSummary
    v21ProductReference = [ordered]@{
        normalVisualP95 = [Math]::Round([double]$productMetrics.'test.normal.visual.p95', 6)
        normalVisualP99 = [Math]::Round([double]$productMetrics.'test.normal.visual.p99', 6)
        peakLeadMax = [Math]::Round([double]$productMetrics.'robustness.peakLead.max', 6)
        returnMotionMax = [Math]::Round([double]$productMetrics.'robustness.returnMotion.max', 6)
        futureLeadP99 = [Math]::Round([double]$productMetrics.'overall.futureLead.p99', 6)
    }
    findings = @(
        "The model is horizon-aware structurally, but v21 scores do not prove robustness across the full target-correction range.",
        "The generated normalizer suggests the trained horizon distribution is narrow; display target correction shifts of +/-32 ms are many standard deviations away from the model's apparent training center.",
        "Because horizon over 1.25 refresh periods is rejected before the horizon cap is applied, large positive target correction can increase hold fallback risk rather than merely selecting a capped prediction.",
        "The next step should build multi-horizon labels and evaluate by horizon bucket, not only by aggregate deployment gates."
    )
}

$json = $result | ConvertTo-Json -Depth 12
Set-Content -LiteralPath $scoresOut -Value $json -Encoding ASCII

$report = @()
$report += "# Step 01 Report - Horizon and Target-Correction Audit"
$report += ""
$report += "## Summary"
$report += ""
$report += "This step performed a lightweight structural audit. It did not run Calibrator and did not retrain a model."
$report += ""
$report += "The current SmoothPredictor is structurally horizon-aware because horizonMilliseconds / 16.67 is feature 0 and runtimeTargetDisplacement is derived from the same horizon. However, the generated normalizer suggests the horizon distribution used for the current model is narrow: mean approximately $([Math]::Round($horizonMeanMs, 3)) ms and std approximately $([Math]::Round($horizonStdMs, 3)) ms."
$report += ""
$report += "The UI target correction range is $displayMinMs ms to +$displayMaxMs ms around the display default. That range is far wider than the apparent horizon training spread. This does not prove the model fails at the edges, but it means aggregate v21 scores are not enough evidence for target-correction robustness."
$report += ""
$report += "## Model Shape"
$report += ""
$report += "| item | value |"
$report += "| --- | ---: |"
$report += "| input features | $featureCount |"
$report += "| hidden units | $hidden |"
$report += "| estimated MACs | $estimatedMacs |"
$report += "| parameters | $parameterCount |"
$report += "| horizon feature mean | $([Math]::Round($horizonFeatureMean, 6)) |"
$report += "| horizon feature std | $([Math]::Round($horizonFeatureStd, 6)) |"
$report += "| approx horizon mean (ms) | $([Math]::Round($horizonMeanMs, 3)) |"
$report += "| approx horizon std (ms) | $([Math]::Round($horizonStdMs, 3)) |"
$report += ""
$report += "## Target Correction Sweep"
$report += ""
$report += "| display offset (ms) | internal offset (ms) | shift from default (ms) | approx std shift |"
$report += "| ---: | ---: | ---: | ---: |"
foreach ($row in $sweepRows) {
    $report += "| $($row.displayOffsetMilliseconds) | $($row.internalOffsetMilliseconds) | $($row.relativeToDefaultMilliseconds) | $($row.approximateTrainingStdShift) |"
}
$report += ""
$report += "The std-shift column is relative to the default display setting and uses the generated model's horizon-feature std. It is an OOD-risk indicator, not a direct accuracy metric."
$report += ""
$report += "## Runtime Structure Findings"
$report += ""
$report += "- Horizon is an explicit model input: $usesHorizonFeature."
$report += "- Runtime target displacement also depends on horizon: $usesRuntimeTargetDisplacement."
$report += "- Horizons above 1.25x refresh are rejected before prediction: $rejectsOver125Refresh."
$report += "- The horizon cap is applied after that rejection check: $appliesCapAfterReject."
$report += ""
$report += "This ordering matters. A large positive target correction may cause a hold fallback before the cap has a chance to constrain the horizon."
$report += ""
$report += "## v21 Aggregate Reference"
$report += ""
$report += "| metric | current SmoothPredictor summary | product reference |"
$report += "| --- | ---: | ---: |"
$report += "| normal visual p95 mean | $($smoothSummary.normalVisualP95Mean) | $([Math]::Round([double]$productMetrics.'test.normal.visual.p95', 6)) |"
$report += "| normal visual p99 mean | $($smoothSummary.normalVisualP99Mean) | $([Math]::Round([double]$productMetrics.'test.normal.visual.p99', 6)) |"
$report += "| peakLead max worst | $($smoothSummary.peakLeadMaxWorst) | $([Math]::Round([double]$productMetrics.'robustness.peakLead.max', 6)) |"
$report += "| returnMotion max worst | $($smoothSummary.returnMotionMaxWorst) | $([Math]::Round([double]$productMetrics.'robustness.returnMotion.max', 6)) |"
$report += "| futureLead p99 worst | $($smoothSummary.futureLeadP99Worst) | $([Math]::Round([double]$productMetrics.'overall.futureLead.p99', 6)) |"
$report += ""
$report += "These aggregate numbers are strong, but they are not bucketed by target correction or requested future horizon."
$report += ""
$report += "## Decision"
$report += ""
$report += "Proceed to Step 02. The dataset must expose labels over a horizon grid and all later scores must be reported by horizon bucket. Training a larger MLP without this audit dimension would risk improving the default case while leaving target correction behavior unproven."
$report += ""
$report += "## Command"
$report += ""
$report += '```powershell'
$report += 'powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-01-horizon-target-audit\audit.ps1'
$report += '```'

Set-Content -LiteralPath $reportOut -Value $report -Encoding ASCII
Write-Host "Wrote $scoresOut"
Write-Host "Wrote $reportOut"
