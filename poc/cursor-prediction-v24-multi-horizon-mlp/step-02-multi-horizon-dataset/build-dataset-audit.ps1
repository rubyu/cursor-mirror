param(
    [string]$RepoRoot = "",
    [string]$OutDir = "",
    [string]$ManifestPath = "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json",
    [string]$V21AuditPath = "poc/cursor-prediction-v21/step-01-data-audit/audit.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Resolve-RepoRoot {
    param([string]$Start)
    $dir = Get-Item -LiteralPath $Start
    while ($null -ne $dir) {
        if (Test-Path -LiteralPath (Join-Path $dir.FullName ".git")) {
            return $dir.FullName
        }
        $dir = $dir.Parent
    }
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}

function Read-JsonFile {
    param([string]$Path)
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 100
}

function Get-Prop {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value) { return $Default }
    return $prop.Value
}

function Get-Number {
    param($Object, [string]$Name, [double]$Default = 0)
    $value = Get-Prop $Object $Name $null
    if ($null -eq $value) { return $Default }
    return [double]$value
}

function Get-NestedNumber {
    param($Object, [string]$Parent, [string]$Name, [double]$Default = 0)
    $child = Get-Prop $Object $Parent $null
    if ($null -eq $child) { return $Default }
    return Get-Number $child $Name $Default
}

function Get-ZipHeader {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$EntryName
    )
    $entry = $Archive.GetEntry($EntryName)
    if ($null -eq $entry) { return @() }
    $stream = $entry.Open()
    try {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true, 65536)
        try {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { return @() }
            return @($line.TrimStart([char]0xFEFF).Split(","))
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Test-Columns {
    param([string[]]$Header, [string[]]$Required)
    $lower = @{}
    foreach ($name in $Header) {
        $lower[$name.ToLowerInvariant()] = $true
    }
    $missing = @()
    foreach ($name in $Required) {
        if (-not $lower.ContainsKey($name.ToLowerInvariant())) {
            $missing += $name
        }
    }
    return $missing
}

function Round6 {
    param([double]$Value)
    return [Math]::Round($Value, 6)
}

function New-HorizonGrid {
    $baseRefreshMs = 16.6667
    $grid = New-Object System.Collections.Generic.List[object]
    foreach ($display in @(-32, -24, -16, -8, 0, 8, 16, 24, 32)) {
        $horizon = $baseRefreshMs + [double]$display
        $safeDisplay = if ($display -lt 0) { "minus$([Math]::Abs($display))" } else { "plus$display" }
        $grid.Add([ordered]@{
            id = "targetCorrectionDisplay_$safeDisplay"
            source = "baseRefreshPlusDisplayTargetCorrection"
            displayTargetCorrectionMilliseconds = $display
            horizonMilliseconds = [Math]::Round($horizon, 4)
            positiveFutureTrainingEligible = ($horizon -gt 0)
        })
    }
    foreach ($probe in @(0, 4, 8, 12, 16, 24, 32)) {
        $grid.Add([ordered]@{
            id = "extraProbe_$probe"
            source = "extraFutureProbe"
            displayTargetCorrectionMilliseconds = $null
            horizonMilliseconds = [double]$probe
            positiveFutureTrainingEligible = ([double]$probe -gt 0)
        })
    }
    return @($grid)
}

function Add-ToSplit {
    param($Table, [string]$Split, [string]$Name, [double]$Value)
    if (-not $Table.ContainsKey($Split)) { $Table[$Split] = [ordered]@{} }
    if (-not $Table[$Split].Contains($Name)) { $Table[$Split][$Name] = 0.0 }
    $Table[$Split][$Name] = [double]$Table[$Split][$Name] + $Value
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-RepoRoot $PSScriptRoot
}
else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = $PSScriptRoot
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

$manifestFullPath = Join-Path $RepoRoot $ManifestPath
$auditFullPath = Join-Path $RepoRoot $V21AuditPath
$manifest = Read-JsonFile $manifestFullPath
$v21Audit = Read-JsonFile $auditFullPath
$generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")

$auditByFile = @{}
foreach ($pkg in @($v21Audit.packages)) {
    $auditByFile[$pkg.file] = $pkg
}

$requiredEntries = @($manifest.requiredZipEntries)
$motionRequired = @($manifest.loaderRequiredColumns.'motion-samples.csv')
$alignmentRequired = @($manifest.loaderRequiredColumns.'motion-trace-alignment.csv')
$traceRequired = @(
    "sequence",
    "stopwatchTicks",
    "elapsedMicroseconds",
    "x",
    "y",
    "event",
    "dwmQpcRefreshPeriod",
    "runtimeSchedulerSampleRecordedTicks",
    "predictionTargetTicks",
    "presentReferenceTicks"
)

$horizonGrid = New-HorizonGrid
$packageSummaries = New-Object System.Collections.Generic.List[object]
$columnFindings = New-Object System.Collections.Generic.List[object]
$missingProblems = New-Object System.Collections.Generic.List[string]
$splitRows = @{}
$splitRegimes = @{}
$horizonBySplit = @{}

foreach ($package in @($manifest.packages)) {
    $zipPath = Join-Path $RepoRoot $package.path
    $auditPackage = $auditByFile[$package.file]
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
        $missingEntries = @($requiredEntries | Where-Object { $entryNames -notcontains $_ })
        $traceHeader = Get-ZipHeader $archive "trace.csv"
        $motionHeader = Get-ZipHeader $archive "motion-samples.csv"
        $alignmentHeader = Get-ZipHeader $archive "motion-trace-alignment.csv"

        $missingTrace = Test-Columns $traceHeader $traceRequired
        $missingMotion = Test-Columns $motionHeader $motionRequired
        $missingAlignment = Test-Columns $alignmentHeader $alignmentRequired
        if ($missingEntries.Count -gt 0) {
            $missingProblems.Add("$($package.file) missing entries: $($missingEntries -join ', ')")
        }
        if ($missingTrace.Count -gt 0) {
            $missingProblems.Add("$($package.file) trace.csv missing columns: $($missingTrace -join ', ')")
        }
        if ($missingMotion.Count -gt 0) {
            $missingProblems.Add("$($package.file) motion-samples.csv missing columns: $($missingMotion -join ', ')")
        }
        if ($missingAlignment.Count -gt 0) {
            $missingProblems.Add("$($package.file) motion-trace-alignment.csv missing columns: $($missingAlignment -join ', ')")
        }

        $columnFindings.Add([ordered]@{
            packageId = $package.packageId
            file = $package.file
            requiredEntriesPresent = ($missingEntries.Count -eq 0)
            missingEntries = $missingEntries
            motionSamplesHeaderColumns = $motionHeader.Count
            motionSamplesMissingRequiredColumns = $missingMotion
            alignmentHeaderColumns = $alignmentHeader.Count
            alignmentMissingRequiredColumns = $missingAlignment
            traceHeaderColumns = $traceHeader.Count
            traceMissingRequiredColumns = $missingTrace
            stopwatchFrequencySource = "metadata.json StopwatchFrequency"
        })
    }
    finally {
        $archive.Dispose()
    }

    $metadata = Get-Prop $auditPackage "metadata" $null
    $motionMetadata = Get-Prop $auditPackage "motionMetadata" $null
    $motionSamples = Get-Prop $auditPackage "motionSamples" $null
    $runtimeRows = [long](Get-Number $metadata "RuntimeSchedulerPollSampleCount" 0)
    if ($runtimeRows -le 0) {
        $traceEventCounts = Get-Prop (Get-Prop $auditPackage "alignment" $null) "traceEventCounts" $null
        $runtimeRows = [long](Get-Number $traceEventCounts "runtimeSchedulerPoll" 0)
    }
    $durationMs = [double]$package.scenarioDurationMilliseconds
    $split = [string]$package.split
    Add-ToSplit $splitRows $split "packageCount" 1
    Add-ToSplit $splitRows $split "runtimeSchedulerRows" $runtimeRows
    Add-ToSplit $splitRows $split "alignmentRows" ([double]$package.alignmentRows)
    Add-ToSplit $splitRows $split "motionRows" ([double]$package.motionRows)
    Add-ToSplit $splitRows $split "scenarioCount" ([double]$package.scenarioCount)

    $phaseCounts = Get-Prop $motionSamples "phaseCounts" $null
    $speedBuckets = Get-Prop $motionSamples "speedBuckets" $null
    $motionRows = [double](Get-Number $motionSamples "rowCount" ([double]$package.motionRows))
    if ($motionRows -le 0) { $motionRows = [double]$package.motionRows }
    $scale = if ($motionRows -gt 0) { [double]$runtimeRows / $motionRows } else { 0.0 }

    $holdSegmentCount = [double](Get-Number $motionMetadata "HoldSegmentCount" 0)
    $staticRows = [Math]::Round((Get-Number $phaseCounts "hold" 0) * $scale)
    $resumeRows = [Math]::Round((Get-Number $phaseCounts "resume" 0) * $scale)
    $slowRows = [Math]::Round((Get-Number $speedBuckets "slow_1_100" 0) * $scale)
    $mediumRows = [Math]::Round((Get-Number $speedBuckets "medium_100_500" 0) * $scale)
    $fastRows = [Math]::Round(((Get-Number $speedBuckets "fast_500_1000" 0) + (Get-Number $speedBuckets "very_fast_gte_1000" 0)) * $scale)
    $abruptStopRows = [Math]::Min($runtimeRows, [Math]::Round($holdSegmentCount * 3.0))
    $highSchedulerDelayRows = if ($package.qualityBucket -eq "poll-delayed") { $runtimeRows } else { 0 }
    $normal60Rows = if ($package.qualityBucket -eq "normal") { $runtimeRows } else { 0 }

    Add-ToSplit $splitRegimes $split "staticEstimatedRows" $staticRows
    Add-ToSplit $splitRegimes $split "slowEstimatedRows" $slowRows
    Add-ToSplit $splitRegimes $split "mediumEstimatedRows" $mediumRows
    Add-ToSplit $splitRegimes $split "fastEstimatedRows" $fastRows
    Add-ToSplit $splitRegimes $split "abruptStopWindowEstimatedRows" $abruptStopRows
    Add-ToSplit $splitRegimes $split "resumeEstimatedRows" $resumeRows
    Add-ToSplit $splitRegimes $split "highSchedulerDelayRows" $highSchedulerDelayRows
    Add-ToSplit $splitRegimes $split "normal60HzRows" $normal60Rows

    $packageHorizonRows = New-Object System.Collections.Generic.List[object]
    foreach ($horizon in $horizonGrid) {
        $horizonMs = [double]$horizon.horizonMilliseconds
        $futureRate = if ($horizonMs -gt 0) { [Math]::Max(0.0, ($durationMs - $horizonMs) / $durationMs) } else { 0.0 }
        $eligible = [long][Math]::Round([double]$runtimeRows * $futureRate)
        $expired = if ($horizonMs -le 0) { $runtimeRows } else { 0 }
        $invalid = [long]([Math]::Max(0, $runtimeRows - $eligible))
        $packageHorizonRows.Add([ordered]@{
            horizonId = $horizon.id
            horizonMilliseconds = $horizonMs
            diagnosticRows = $runtimeRows
            positiveFutureTrainingRows = $eligible
            expiredOrNonFutureRows = $expired
            estimatedInvalidFutureRows = $invalid
            estimatedInvalidFutureRate = Round6 ($invalid / [Math]::Max(1.0, [double]$runtimeRows))
        })
        if (-not $horizonBySplit.ContainsKey($horizon.id)) {
            $horizonBySplit[$horizon.id] = [ordered]@{
                horizonMilliseconds = $horizonMs
                source = $horizon.source
                positiveFutureTrainingEligible = $horizon.positiveFutureTrainingEligible
            }
        }
        if (-not $horizonBySplit[$horizon.id].Contains("splits")) {
            $horizonBySplit[$horizon.id]["splits"] = [ordered]@{}
        }
        if (-not $horizonBySplit[$horizon.id]["splits"].Contains($split)) {
            $horizonBySplit[$horizon.id]["splits"][$split] = [ordered]@{
                diagnosticRows = 0L
                positiveFutureTrainingRows = 0L
                expiredOrNonFutureRows = 0L
                estimatedInvalidFutureRows = 0L
            }
        }
        $horizonBySplit[$horizon.id]["splits"][$split]["diagnosticRows"] += $runtimeRows
        $horizonBySplit[$horizon.id]["splits"][$split]["positiveFutureTrainingRows"] += $eligible
        $horizonBySplit[$horizon.id]["splits"][$split]["expiredOrNonFutureRows"] += $expired
        $horizonBySplit[$horizon.id]["splits"][$split]["estimatedInvalidFutureRows"] += $invalid
    }

    $packageSummaries.Add([ordered]@{
        packageId = $package.packageId
        file = $package.file
        split = $split
        qualityBucket = $package.qualityBucket
        durationBucket = $package.durationBucket
        scenarioDurationMilliseconds = $package.scenarioDurationMilliseconds
        scenarioCount = $package.scenarioCount
        runtimeSchedulerRows = $runtimeRows
        manifestMotionRows = $package.motionRows
        manifestAlignmentRows = $package.alignmentRows
        schedulerPollP50Milliseconds = Round6 (Get-NestedNumber $metadata "RuntimeSchedulerPollIntervalStats" "P50Milliseconds" 0)
        schedulerPollP95Milliseconds = Round6 (Get-NestedNumber $metadata "RuntimeSchedulerPollIntervalStats" "P95Milliseconds" 0)
        estimatedRegimeRows = [ordered]@{
            static = [long]$staticRows
            slow = [long]$slowRows
            medium = [long]$mediumRows
            fast = [long]$fastRows
            abruptStopWindow = [long]$abruptStopRows
            resume = [long]$resumeRows
            highSchedulerDelay = [long]$highSchedulerDelayRows
            normal60Hz = [long]$normal60Rows
        }
        horizonRows = @($packageHorizonRows)
    })
}

$splitSummary = New-Object System.Collections.Generic.List[object]
foreach ($split in @("train", "validation", "test", "robustness")) {
    if (-not $splitRows.ContainsKey($split)) { continue }
    $runtimeRows = [long][Math]::Round([double]$splitRows[$split]["runtimeSchedulerRows"])
    $splitSummary.Add([ordered]@{
        split = $split
        packageCount = [long][Math]::Round([double]$splitRows[$split]["packageCount"])
        scenarioCount = [long][Math]::Round([double]$splitRows[$split]["scenarioCount"])
        runtimeSchedulerRows = $runtimeRows
        diagnosticLabelCells = [long]($runtimeRows * $horizonGrid.Count)
        motionRows = [long][Math]::Round([double]$splitRows[$split]["motionRows"])
        alignmentRows = [long][Math]::Round([double]$splitRows[$split]["alignmentRows"])
    })
}

$regimeSummary = New-Object System.Collections.Generic.List[object]
foreach ($split in @("train", "validation", "test", "robustness")) {
    if (-not $splitRegimes.ContainsKey($split)) { continue }
    $r = $splitRegimes[$split]
    $regimeSummary.Add([ordered]@{
        split = $split
        staticEstimatedRows = [long][Math]::Round([double]$r["staticEstimatedRows"])
        slowEstimatedRows = [long][Math]::Round([double]$r["slowEstimatedRows"])
        mediumEstimatedRows = [long][Math]::Round([double]$r["mediumEstimatedRows"])
        fastEstimatedRows = [long][Math]::Round([double]$r["fastEstimatedRows"])
        abruptStopWindowEstimatedRows = [long][Math]::Round([double]$r["abruptStopWindowEstimatedRows"])
        resumeEstimatedRows = [long][Math]::Round([double]$r["resumeEstimatedRows"])
        highSchedulerDelayRows = [long][Math]::Round([double]$r["highSchedulerDelayRows"])
        normal60HzRows = [long][Math]::Round([double]$r["normal60HzRows"])
    })
}

$horizonSummary = New-Object System.Collections.Generic.List[object]
foreach ($horizon in $horizonGrid) {
    $entry = $horizonBySplit[$horizon.id]
    $splitObj = [ordered]@{}
    foreach ($split in @("train", "validation", "test", "robustness")) {
        if ($entry.splits.Contains($split)) {
            $s = $entry.splits[$split]
            $splitObj[$split] = [ordered]@{
                diagnosticRows = [long]$s.diagnosticRows
                positiveFutureTrainingRows = [long]$s.positiveFutureTrainingRows
                expiredOrNonFutureRows = [long]$s.expiredOrNonFutureRows
                estimatedInvalidFutureRows = [long]$s.estimatedInvalidFutureRows
            }
        }
    }
    $horizonSummary.Add([ordered]@{
        horizonId = $horizon.id
        source = $horizon.source
        horizonMilliseconds = [double]$horizon.horizonMilliseconds
        positiveFutureTrainingEligible = [bool]$horizon.positiveFutureTrainingEligible
        splits = $splitObj
    })
}

$totalRuntimeRows = [long](@($splitSummary | ForEach-Object { $_.runtimeSchedulerRows } | Measure-Object -Sum).Sum)
$positiveLabelCells = [long]0
foreach ($h in $horizonSummary) {
    foreach ($split in @($h.splits.PSObject.Properties.Name)) {
        $positiveLabelCells += [long]$h.splits.$split.positiveFutureTrainingRows
    }
}

$scores = [ordered]@{
    schemaVersion = "cursor-prediction-v24-step-02-multi-horizon-dataset/1"
    generatedAtUtc = $generatedAtUtc
    constraints = [ordered]@{
        rawRowsWritten = $false
        zipCsvExtractedToDisk = $false
        calibratorRun = $false
        gpuUsed = $false
        dependenciesDownloaded = $false
    }
    inputs = [ordered]@{
        v24Readme = "poc/cursor-prediction-v24-multi-horizon-mlp/README.md"
        step01Report = "poc/cursor-prediction-v24-multi-horizon-mlp/step-01-horizon-target-audit/report.md"
        step01Scores = "poc/cursor-prediction-v24-multi-horizon-mlp/step-01-horizon-target-audit/scores.json"
        step02Design = "poc/cursor-prediction-v24-multi-horizon-mlp/step-02-multi-horizon-dataset/design.md"
        splitManifest = $ManifestPath
        v21Audit = $V21AuditPath
        zipInspection = "required entries and headers only; no large CSV row dump"
    }
    horizonGrid = @($horizonGrid)
    totals = [ordered]@{
        packageCount = @($manifest.packages).Count
        horizonCount = $horizonGrid.Count
        runtimeSchedulerRows = $totalRuntimeRows
        diagnosticLabelCells = [long]($totalRuntimeRows * $horizonGrid.Count)
        positiveFutureTrainingLabelCells = $positiveLabelCells
    }
    columnAudit = [ordered]@{
        requiredEntries = $requiredEntries
        motionSamplesRequiredColumns = $motionRequired
        alignmentRequiredColumns = $alignmentRequired
        traceRequiredColumns = $traceRequired
        allRequiredEntriesAndHeadersPresent = ($missingProblems.Count -eq 0)
        problems = @($missingProblems)
        packages = @($columnFindings)
    }
    featurePrototype = [ordered]@{
        runtimeSafeInputs = @(
            "package id, split, quality bucket, duration bucket, scenario id from split manifest",
            "sample timestamp, target timestamp, refresh period, and cursor position from trace.csv",
            "stopwatch frequency from metadata.json",
            "history-derived velocity windows for 2, 3, 5, 8, and 12 samples from prior runtimeSchedulerPoll trace rows",
            "recent segment maximum speed, latest delta, path net/path/efficiency, direction vector, runtime target displacement estimate",
            "history availability counts/masks for early rows"
        )
        labelInputs = @(
            "future target dx/dy from motion-samples.csv interpolation by scenarioElapsedMilliseconds + horizonMilliseconds",
            "future lead/lag direction from current-to-future target direction",
            "validity flag when requested future time is within scenario interpolation coverage"
        )
        noFutureDataAsRuntimeFeature = $true
    }
    splitSummary = @($splitSummary)
    horizonFeasibilityBySplit = @($horizonSummary)
    regimeEstimatesBySplit = @($regimeSummary)
    packages = @($packageSummaries)
    limitations = @(
        "This prototype does not materialize feature rows or label arrays; counts are feasibility estimates.",
        "ZIP inspection confirms required entries and headers, but the script uses v21 audit metadata for compact runtime row and regime counts.",
        "Positive future label counts assume runtimeSchedulerPoll rows are approximately uniform over each scenario duration.",
        "Regime counts are projected from 240 Hz generated motion-samples.csv proportions onto runtimeSchedulerPoll rows.",
        "Abrupt-stop rows are a compact window estimate of three scheduler rows per generated hold segment; a later builder should detect exact stop transitions.",
        "Negative and zero horizons are kept as diagnostic label cells but excluded from positive-future training counts."
    )
    findings = @(
        "The v21 split manifest is sufficient as the package source of truth for Step 02.",
        "The available ZIPs expose the required motion-samples.csv and motion-trace-alignment.csv columns needed for generated-motion interpolation.",
        "trace.csv contains runtime timing and cursor columns needed for current/past feature construction; StopwatchFrequency is supplied by metadata.json.",
        "The v24 horizon grid creates two non-future target-correction horizons and one zero extra probe, which should stay diagnostic unless explicitly modeled as hold/current labels."
    )
}

$scoresPath = Join-Path $OutDir "scores.json"
$reportPath = Join-Path $OutDir "report.md"
$scores | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $scoresPath -Encoding UTF8

$report = New-Object System.Collections.Generic.List[string]
$report.Add("# Step 02 Report - Multi-Horizon Dataset Audit/Builder Prototype")
$report.Add("")
$report.Add("## Summary")
$report.Add("")
$report.Add("This step implemented a compact structural dataset audit. It did not run Calibrator, did not use GPU, did not download dependencies, did not extract ZIP CSVs to disk, and did not write large row dumps.")
$report.Add("")
$report.Add("The prototype uses the v21 split manifest as the package source of truth, opens each ZIP to confirm required entries and CSV headers, and uses v21 audit metadata to estimate runtime row counts, regime buckets, and feasible future-label cells by split and horizon.")
$report.Add("")
$report.Add("## Column Audit")
$report.Add("")
$report.Add("| item | value |")
$report.Add("| --- | ---: |")
$report.Add("| packages checked | $(@($manifest.packages).Count) |")
$report.Add("| all required entries and headers present | $($missingProblems.Count -eq 0) |")
$report.Add("| motion-samples required columns | $($motionRequired.Count) |")
$report.Add("| alignment required columns | $($alignmentRequired.Count) |")
$report.Add("| trace runtime columns checked | $($traceRequired.Count) |")
$report.Add("")
if ($missingProblems.Count -gt 0) {
    $report.Add("Problems:")
    foreach ($problem in $missingProblems) { $report.Add("- $problem") }
    $report.Add("")
}
$report.Add("`trace.csv` does not carry `StopwatchFrequency` as a row column in these packages; the builder records it from `metadata.json` instead.")
$report.Add("")
$report.Add("## Horizon Grid")
$report.Add("")
$report.Add("| horizon id | source | horizon ms | positive future training |")
$report.Add("| --- | --- | ---: | ---: |")
foreach ($h in $horizonGrid) {
    $report.Add("| $($h.id) | $($h.source) | $($h.horizonMilliseconds) | $($h.positiveFutureTrainingEligible) |")
}
$report.Add("")
$report.Add("## Split Counts")
$report.Add("")
$report.Add("| split | packages | scenarios | runtime rows | diagnostic label cells | motion rows | alignment rows |")
$report.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($s in $splitSummary) {
    $report.Add("| $($s.split) | $($s.packageCount) | $($s.scenarioCount) | $($s.runtimeSchedulerRows) | $($s.diagnosticLabelCells) | $($s.motionRows) | $($s.alignmentRows) |")
}
$report.Add("")
$report.Add("## Feasible Positive-Future Labels")
$report.Add("")
$report.Add("| horizon id | horizon ms | train | validation | test | robustness |")
$report.Add("| --- | ---: | ---: | ---: | ---: | ---: |")
foreach ($h in $horizonSummary) {
    $train = if ($h.splits.Contains("train")) { $h.splits.train.positiveFutureTrainingRows } else { 0 }
    $validation = if ($h.splits.Contains("validation")) { $h.splits.validation.positiveFutureTrainingRows } else { 0 }
    $test = if ($h.splits.Contains("test")) { $h.splits.test.positiveFutureTrainingRows } else { 0 }
    $robustness = if ($h.splits.Contains("robustness")) { $h.splits.robustness.positiveFutureTrainingRows } else { 0 }
    $report.Add("| $($h.horizonId) | $($h.horizonMilliseconds) | $train | $validation | $test | $robustness |")
}
$report.Add("")
$report.Add("## Regime Estimates")
$report.Add("")
$report.Add("| split | static | slow | medium | fast | abrupt stop window | resume | high scheduler delay | normal 60 Hz |")
$report.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($r in $regimeSummary) {
    $report.Add("| $($r.split) | $($r.staticEstimatedRows) | $($r.slowEstimatedRows) | $($r.mediumEstimatedRows) | $($r.fastEstimatedRows) | $($r.abruptStopWindowEstimatedRows) | $($r.resumeEstimatedRows) | $($r.highSchedulerDelayRows) | $($r.normal60HzRows) |")
}
$report.Add("")
$report.Add("## Builder Shape")
$report.Add("")
$report.Add("- Runtime features can be computed from `trace.csv` runtime scheduler rows using only current and prior cursor samples.")
$report.Add("- Future `dx/dy` labels should be interpolated from `motion-samples.csv` by `scenarioIndex` and `scenarioElapsedMilliseconds + horizonMilliseconds`.")
$report.Add("- Missing history should be represented as availability counts or masks for the 2, 3, 5, 8, and 12 sample windows.")
$report.Add("- Negative and zero horizons remain diagnostic rows; normal training counts exclude them.")
$report.Add("")
$report.Add("## Limitations")
$report.Add("")
foreach ($limitation in $scores.limitations) {
    $report.Add("- $limitation")
}
$report.Add("")
$report.Add("## Command")
$report.Add("")
$report.Add("```powershell")
$report.Add("powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-02-multi-horizon-dataset\build-dataset-audit.ps1")
$report.Add("```")

$report | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "Wrote $scoresPath"
Write-Host "Wrote $reportPath"
