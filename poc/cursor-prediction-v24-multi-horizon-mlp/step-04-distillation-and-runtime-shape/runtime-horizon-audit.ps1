param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$stepRoot = $PSScriptRoot
$manifestPath = Join-Path $RepoRoot "poc\cursor-prediction-v21\step-02-balanced-evaluation\split-manifest.json"
$modelPath = Join-Path $RepoRoot "src\CursorMirror.Core\SmoothPredictorModel.g.cs"
$settingsPath = Join-Path $RepoRoot "src\CursorMirror.Core\CursorMirrorSettings.cs"
$scoresOut = Join-Path $stepRoot "runtime-horizon-scores.json"
$reportOut = Join-Path $stepRoot "runtime-horizon-report.md"

function Resolve-RepoPath([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ($Path -replace "/", "\")))
}

function Header-Index([string]$HeaderLine) {
    $headers = $HeaderLine.Split(",")
    $index = @{}
    for ($i = 0; $i -lt $headers.Length; $i++) {
        $index[$headers[$i]] = $i
    }

    return $index
}

function Get-Field([string[]]$Fields, [hashtable]$Index, [string]$Name) {
    if (-not $Index.ContainsKey($Name)) {
        return ""
    }

    $i = [int]$Index[$Name]
    if ($i -ge $Fields.Length) {
        return ""
    }

    return $Fields[$i]
}

function Get-DoubleField([string[]]$Fields, [hashtable]$Index, [string]$Name, [double]$Fallback = [double]::NaN) {
    $text = Get-Field $Fields $Index $Name
    $value = 0.0
    if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
        return $value
    }

    return $Fallback
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

function Percentile([double[]]$Values, [double]$Percent) {
    if ($Values.Count -eq 0) {
        return 0.0
    }

    [Array]::Sort($Values)
    $index = [Math]::Ceiling($Values.Count * $Percent / 100.0) - 1
    $index = [Math]::Max(0, [Math]::Min($Values.Count - 1, [int]$index))
    return $Values[$index]
}

function Summarize-Values([double[]]$Values) {
    if ($Values.Count -eq 0) {
        return [ordered]@{ count = 0; mean = 0; p50 = 0; p95 = 0; p99 = 0; min = 0; max = 0 }
    }

    $sum = 0.0
    $min = [double]::PositiveInfinity
    $max = [double]::NegativeInfinity
    foreach ($value in $Values) {
        $sum += $value
        $min = [Math]::Min($min, $value)
        $max = [Math]::Max($max, $value)
    }

    return [ordered]@{
        count = $Values.Count
        mean = [Math]::Round($sum / $Values.Count, 6)
        p50 = [Math]::Round((Percentile $Values 50), 6)
        p95 = [Math]::Round((Percentile $Values 95), 6)
        p99 = [Math]::Round((Percentile $Values 99), 6)
        min = [Math]::Round($min, 6)
        max = [Math]::Round($max, 6)
    }
}

function Scan-Package([object]$Package) {
    $zipPath = Resolve-RepoPath $Package.path
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $rows = New-Object System.Collections.Generic.List[double]
    $refreshes = New-Object System.Collections.Generic.List[double]
    try {
        $entry = $archive.GetEntry("trace.csv")
        if ($null -eq $entry) {
            throw "trace.csv not found in $zipPath"
        }

        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            $header = $reader.ReadLine()
            $index = Header-Index $header
            while (($line = $reader.ReadLine()) -ne $null) {
                $fields = $line.Split(",")
                if ((Get-Field $fields $index "event") -ne "runtimeSchedulerPoll") {
                    continue
                }

                if ((Get-Field $fields $index "warmupSample").Equals("true", [System.StringComparison]::OrdinalIgnoreCase)) {
                    continue
                }

                $sampleToTargetUs = Get-DoubleField $fields $index "runtimeSchedulerSampleToTargetMicroseconds"
                if ([double]::IsNaN($sampleToTargetUs)) {
                    $sampleToTargetUs = Get-DoubleField $fields $index "sampleRecordedToPredictionTargetMicroseconds"
                }

                $refreshTicks = Get-DoubleField $fields $index "dwmQpcRefreshPeriod"
                $frequency = Get-DoubleField $fields $index "stopwatchFrequency" 10000000.0
                if ([double]::IsNaN($sampleToTargetUs) -or [double]::IsNaN($refreshTicks) -or $frequency -le 0 -or $refreshTicks -le 0) {
                    continue
                }

                $rows.Add($sampleToTargetUs / 1000.0)
                $refreshes.Add($refreshTicks * 1000.0 / $frequency)
            }
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }

    return [ordered]@{
        packageId = $Package.packageId
        split = $Package.split
        qualityBucket = $Package.qualityBucket
        durationBucket = $Package.durationBucket
        sampleToTargetMilliseconds = $rows.ToArray()
        refreshMilliseconds = $refreshes.ToArray()
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$settingsText = [System.IO.File]::ReadAllText($settingsPath)
$modelText = [System.IO.File]::ReadAllText($modelPath)
$featureMean = Parse-FloatArray $modelText "FeatureMean"
$featureStd = Parse-FloatArray $modelText "FeatureStd"

$origin = Parse-ConstInt $settingsText "DwmPredictionTargetOffsetDisplayOriginMilliseconds"
$displayOffsets = @(-32, -24, -16, -8, 0, 8, 16, 24, 32)
$internalOffsets = $displayOffsets | ForEach-Object { $origin + $_ }
$trainingOffset = -4.0
$horizonCapMs = Parse-ConstInt $settingsText "DefaultDwmPredictionHorizonCapMilliseconds"
$trainingMeanMs = [Math]::Round($featureMean[0] * 16.67, 6)
$trainingStdMs = [Math]::Round($featureStd[0] * 16.67, 6)

$packageScans = @()
$allSampleToTarget = New-Object System.Collections.Generic.List[double]
$allRefresh = New-Object System.Collections.Generic.List[double]
foreach ($package in $manifest.packages) {
    $scan = Scan-Package $package
    $packageScans += [ordered]@{
        packageId = $scan.packageId
        split = $scan.split
        qualityBucket = $scan.qualityBucket
        durationBucket = $scan.durationBucket
        rows = $scan.sampleToTargetMilliseconds.Count
        sampleToTarget = Summarize-Values $scan.sampleToTargetMilliseconds
        refresh = Summarize-Values $scan.refreshMilliseconds
    }
    foreach ($value in $scan.sampleToTargetMilliseconds) {
        $allSampleToTarget.Add($value)
    }

    foreach ($value in $scan.refreshMilliseconds) {
        $allRefresh.Add($value)
    }
}

$sampleArray = $allSampleToTarget.ToArray()
$refreshArray = $allRefresh.ToArray()
$offsetSummaries = @()
for ($i = 0; $i -lt $internalOffsets.Count; $i++) {
    $display = $displayOffsets[$i]
    $internal = [double]$internalOffsets[$i]
    $horizons = New-Object System.Collections.Generic.List[double]
    $usedAfterCap = New-Object System.Collections.Generic.List[double]
    $expired = 0
    $excessive = 0
    for ($j = 0; $j -lt $sampleArray.Count; $j++) {
        $horizon = $sampleArray[$j] + $internal
        $limit = $refreshArray[$j] * 1.25
        $horizons.Add($horizon)
        if ($horizon -le 0) {
            $expired++
            continue
        }

        if ($horizon -gt $limit) {
            $excessive++
            continue
        }

        $usedAfterCap.Add([Math]::Min($horizon, $horizonCapMs))
    }

    $count = [Math]::Max(1, $sampleArray.Count)
    $offsetSummaries += [ordered]@{
        displayOffsetMilliseconds = $display
        internalOffsetMilliseconds = $internal
        selectedOffset = if ($display -eq 0) { "current-default-display" } else { "" }
        horizonBeforeReject = Summarize-Values $horizons.ToArray()
        usedHorizonAfterCap = Summarize-Values $usedAfterCap.ToArray()
        expiredRate = [Math]::Round($expired / $count, 6)
        excessiveRate = [Math]::Round($excessive / $count, 6)
        acceptedRate = [Math]::Round(($count - $expired - $excessive) / $count, 6)
    }
}

$trainingHorizons = New-Object System.Collections.Generic.List[double]
foreach ($value in $sampleArray) {
    $trainingHorizons.Add($value + $trainingOffset)
}

$result = [ordered]@{
    schemaVersion = "cursor-prediction-v24-step-04-runtime-horizon-audit/1"
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceManifest = "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json"
    rows = $sampleArray.Count
    trainingOffsetMilliseconds = $trainingOffset
    currentDisplayOriginMilliseconds = $origin
    currentDefaultInternalOffsetMilliseconds = $origin
    defaultHorizonCapMilliseconds = $horizonCapMs
    generatedModelTrainingNormalizer = [ordered]@{
        horizonFeatureMean = [Math]::Round($featureMean[0], 9)
        horizonFeatureStd = [Math]::Round($featureStd[0], 9)
        approximateMeanMilliseconds = $trainingMeanMs
        approximateStdMilliseconds = $trainingStdMs
    }
    observedSampleToTargetMilliseconds = Summarize-Values $sampleArray
    observedRefreshMilliseconds = Summarize-Values $refreshArray
    v21TrainingLabelHorizonEstimate = Summarize-Values $trainingHorizons.ToArray()
    targetOffsetSweep = $offsetSummaries
    packageSummaries = $packageScans
    findings = @(
        "v21 SmoothPredictor training used approximately sample-to-target minus 4ms labels, which centers near the generated normalizer's horizon mean.",
        "Current display offset 0 maps to internal +8ms, so the model is commonly asked for roughly sample-to-target plus 8ms at runtime.",
        "This means SmoothPredictor's learned horizon and current default runtime horizon are likely separated by roughly 12ms.",
        "Large positive target offsets can exceed the 1.25x refresh rejection guard before horizon cap is applied."
    )
}

Set-Content -LiteralPath $scoresOut -Value ($result | ConvertTo-Json -Depth 12) -Encoding ASCII

$defaultSummary = $offsetSummaries | Where-Object { $_.displayOffsetMilliseconds -eq 0 } | Select-Object -First 1
$plus32Summary = $offsetSummaries | Where-Object { $_.displayOffsetMilliseconds -eq 32 } | Select-Object -First 1
$minus32Summary = $offsetSummaries | Where-Object { $_.displayOffsetMilliseconds -eq -32 } | Select-Object -First 1

$report = @()
$report += "# Step 04 Report - Runtime Horizon Semantics Audit"
$report += ""
$report += "## Summary"
$report += ""
$report += "This audit checks whether the future time used to train the v21 SmoothPredictor matches the future time requested by the current product settings."
$report += ""
$report += "The answer is: probably not. The v21 harness used a training label offset of -4ms relative to the scheduler target. The current user-facing target offset display value 0 maps to an internal +8ms offset. On the scanned runtime scheduler rows, this separates the learned/default runtime horizon by roughly 12ms."
$report += ""
$report += "## Observed Runtime Timing"
$report += ""
$report += "| metric | value |"
$report += "| --- | ---: |"
$report += "| rows | $($sampleArray.Count) |"
$report += "| sample-to-target p50 (ms) | $($result.observedSampleToTargetMilliseconds.p50) |"
$report += "| sample-to-target p95 (ms) | $($result.observedSampleToTargetMilliseconds.p95) |"
$report += "| refresh p50 (ms) | $($result.observedRefreshMilliseconds.p50) |"
$report += "| v21 training horizon p50 estimate (ms) | $($result.v21TrainingLabelHorizonEstimate.p50) |"
$report += "| current default runtime horizon p50 estimate (ms) | $($defaultSummary.horizonBeforeReject.p50) |"
$report += "| generated model horizon normalizer mean (ms) | $trainingMeanMs |"
$report += "| generated model horizon normalizer std (ms) | $trainingStdMs |"
$report += ""
$report += "## Target Offset Sweep"
$report += ""
$report += "| display offset (ms) | internal offset (ms) | horizon p50 before reject | accepted rate | expired rate | excessive rate | used p50 after cap |"
$report += "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
foreach ($summary in $offsetSummaries) {
    $report += "| $($summary.displayOffsetMilliseconds) | $($summary.internalOffsetMilliseconds) | $($summary.horizonBeforeReject.p50) | $($summary.acceptedRate) | $($summary.expiredRate) | $($summary.excessiveRate) | $($summary.usedHorizonAfterCap.p50) |"
}
$report += ""
$report += "## Interpretation"
$report += ""
$report += "- The current SmoothPredictor model is trained from v21 assets whose horizon distribution is centered near the -4ms training-label convention."
$report += "- The current UI default does not mean internal 0ms; it means internal +8ms."
$report += "- Because the runtime predictor rejects horizons above 1.25x refresh before applying the horizon cap, large positive target correction is not merely capped. It can become a hold fallback."
$report += "- The next ML run should train/evaluate against product-shaped horizons: sample-to-target plus internal offset, with expired/excessive horizons treated the same way product runtime treats them."
$report += ""
$report += "## Decision"
$report += ""
$report += "Do not promote a larger MLP from Step 03. First repair the training/evaluation target semantics. The next run should use product-shaped horizons and compare CV/static-guard, current SmoothPredictor-style MLP, and residual models under those semantics."
$report += ""
$report += "## Command"
$report += ""
$report += '```powershell'
$report += 'powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-04-distillation-and-runtime-shape\runtime-horizon-audit.ps1'
$report += '```'

Set-Content -LiteralPath $reportOut -Value $report -Encoding ASCII
Write-Host "Wrote $scoresOut"
Write-Host "Wrote $reportOut"
