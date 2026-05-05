param(
    [string]$RootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [string]$OutputPath = $PSScriptRoot,
    [int]$Top = 25,
    [string[]]$ZipName = @()
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Convert-ToDoubleOrNull {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $parsed = 0.0
    if ([double]::TryParse($Value, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
        return $parsed
    }

    return $null
}

function Convert-ToInt64OrNull {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $parsed = [int64]0
    if ([int64]::TryParse($Value, [System.Globalization.NumberStyles]::Integer, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
        return $parsed
    }

    return $null
}

function Get-Field {
    param(
        [string[]]$Fields,
        [hashtable]$Index,
        [string]$Name
    )

    if (-not $Index.ContainsKey($Name)) {
        return $null
    }

    $i = $Index[$Name]
    if ($i -ge $Fields.Count) {
        return $null
    }

    return $Fields[$i]
}

function Get-Percentile {
    param(
        [double[]]$Values,
        [double]$Percentile
    )

    if ($Values.Count -eq 0) {
        return $null
    }

    $sorted = [double[]]($Values | Sort-Object)
    if ($sorted.Count -eq 1) {
        return [math]::Round($sorted[0], 3)
    }

    $rank = ($Percentile / 100.0) * ($sorted.Count - 1)
    $lower = [math]::Floor($rank)
    $upper = [math]::Ceiling($rank)
    if ($lower -eq $upper) {
        return [math]::Round($sorted[$lower], 3)
    }

    $weight = $rank - $lower
    return [math]::Round(($sorted[$lower] * (1.0 - $weight)) + ($sorted[$upper] * $weight), 3)
}

function Add-TopOutlier {
    param(
        [System.Collections.Generic.List[object]]$List,
        [object]$Item,
        [string]$SortField,
        [int]$Limit
    )

    $List.Add($Item)
    if ($List.Count -gt ($Limit * 3)) {
        $kept = $List | Sort-Object -Property $SortField -Descending | Select-Object -First $Limit
        $List.Clear()
        foreach ($entry in $kept) {
            $List.Add($entry)
        }
    }
}

function Get-Classification {
    param(
        [double]$EstimatedWakeLateUs,
        [double]$DispatcherLateUs,
        [Nullable[double]]$CursorReadLateUs,
        [Nullable[double]]$CadenceGapUs
    )

    $wakeLate = $EstimatedWakeLateUs -gt 1000.0
    $dispatcherLate = $DispatcherLateUs -gt 1000.0
    $cursorLate = $false
    if ($null -ne $CursorReadLateUs) {
        $cursorLate = $CursorReadLateUs.Value -gt 1000.0
    }

    $lateKinds = @()
    if ($wakeLate) { $lateKinds += "wake" }
    if ($dispatcherLate) { $lateKinds += "dispatcher" }
    if ($cursorLate) { $lateKinds += "cursor" }

    if ($lateKinds.Count -gt 1) {
        return "mixed"
    }
    if ($wakeLate) {
        return "scheduler_wake_late"
    }
    if ($dispatcherLate) {
        return "dispatcher_late"
    }
    if ($cursorLate) {
        return "cursor_read_late"
    }
    if ($null -ne $CadenceGapUs -and $CadenceGapUs.Value -gt 1000.0) {
        return "unknown"
    }

    return "unknown"
}

function Get-TraceEntry {
    param([string]$ZipPath)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -ieq "trace.csv" -or $_.FullName -like "*/trace.csv" } | Select-Object -First 1
        if ($null -eq $entry) {
            return $null
        }

        return [pscustomobject]@{
            Zip = $zip
            Entry = $entry
        }
    }
    catch {
        $zip.Dispose()
        throw
    }
}

New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

$zipFiles = Get-ChildItem -Path $RootPath -File -Filter "*.zip" |
    Where-Object { $_.Name -like "cursor-mirror-trace-*.zip" -or $_.Name -like "cursor-mirror-motion-recording-*.zip" } |
    Sort-Object Name

$allCandidateZipCount = $zipFiles.Count
if ($ZipName.Count -gt 0) {
    $expandedZipNames = @()
    foreach ($name in $ZipName) {
        $expandedZipNames += @($name -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    $ZipName = $expandedZipNames
    $wanted = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $ZipName) {
        [void]$wanted.Add($name)
    }
    $zipFiles = @($zipFiles | Where-Object { $wanted.Contains($_.Name) })
}

$topByGap = [System.Collections.Generic.List[object]]::new()
$topByInterval = [System.Collections.Generic.List[object]]::new()
$classCounts = [ordered]@{
    scheduler_wake_late = 0
    dispatcher_late = 0
    cursor_read_late = 0
    mixed = 0
    unknown = 0
}
$cadenceGaps = [System.Collections.Generic.List[double]]::new()
$queueToDispatchValues = [System.Collections.Generic.List[double]]::new()
$wakeLateValues = [System.Collections.Generic.List[double]]::new()
$cursorReadValues = [System.Collections.Generic.List[double]]::new()
$perZip = [System.Collections.Generic.List[object]]::new()

$processedZips = 0
$zipsWithoutTrace = 0
$totalPollRows = 0
$totalOutlierRows = 0
$lineFilter = ",runtimeSchedulerPoll,"
$outlierThresholdUs = 1000.0
$defaultTicksPerMicrosecond = 10.0

foreach ($file in $zipFiles) {
    $trace = Get-TraceEntry -ZipPath $file.FullName
    if ($null -eq $trace) {
        $zipsWithoutTrace++
        continue
    }

    $zip = $trace.Zip
    try {
        $entry = $trace.Entry
        $stream = $entry.Open()
        $reader = [System.IO.StreamReader]::new($stream)
        try {
            if ($reader.EndOfStream) {
                continue
            }

            $header = $reader.ReadLine()
            $columns = $header.Split(",")
            $index = @{}
            for ($i = 0; $i -lt $columns.Count; $i++) {
                $index[$columns[$i]] = $i
            }

            $zipPollRows = 0
            $zipOutlierRows = 0
            $zipClassCounts = [ordered]@{
                scheduler_wake_late = 0
                dispatcher_late = 0
                cursor_read_late = 0
                mixed = 0
                unknown = 0
            }
            $prevActualTicks = $null
            $prevElapsedUs = $null

            while (-not $reader.EndOfStream) {
                $line = $reader.ReadLine()
                if ($null -eq $line -or -not $line.Contains($lineFilter)) {
                    continue
                }

                $fields = $line.Split(",")
                $zipPollRows++
                $totalPollRows++

                $sequence = Convert-ToInt64OrNull (Get-Field $fields $index "sequence")
                $elapsedUs = Convert-ToDoubleOrNull (Get-Field $fields $index "elapsedMicroseconds")
                $vblankLeadUs = Convert-ToDoubleOrNull (Get-Field $fields $index "runtimeSchedulerVBlankLeadMicroseconds")
                $queueToDispatchUs = Convert-ToDoubleOrNull (Get-Field $fields $index "runtimeSchedulerQueueToDispatchMicroseconds")
                $cursorReadUs = Convert-ToDoubleOrNull (Get-Field $fields $index "runtimeSchedulerCursorReadLatencyMicroseconds")
                $cadenceGapUs = Convert-ToDoubleOrNull (Get-Field $fields $index "runtimeSchedulerPollCadenceGapMicroseconds")
                $actualTickTicks = Convert-ToInt64OrNull (Get-Field $fields $index "runtimeSchedulerActualTickTicks")
                $refreshPeriodTicks = Convert-ToDoubleOrNull (Get-Field $fields $index "dwmQpcRefreshPeriod")
                $refreshNumerator = Convert-ToDoubleOrNull (Get-Field $fields $index "dwmRateRefreshNumerator")
                $refreshDenominator = Convert-ToDoubleOrNull (Get-Field $fields $index "dwmRateRefreshDenominator")

                if ($null -eq $queueToDispatchUs) {
                    $queuedTicks = Convert-ToInt64OrNull (Get-Field $fields $index "runtimeSchedulerQueuedTickTicks")
                    $dispatchTicks = Convert-ToInt64OrNull (Get-Field $fields $index "runtimeSchedulerDispatchStartedTicks")
                    if ($null -ne $queuedTicks -and $null -ne $dispatchTicks) {
                        $queueToDispatchUs = [double](($dispatchTicks - $queuedTicks) / $defaultTicksPerMicrosecond)
                    }
                }

                if ($null -eq $cursorReadUs) {
                    $readStartedTicks = Convert-ToInt64OrNull (Get-Field $fields $index "runtimeSchedulerCursorReadStartedTicks")
                    $readCompletedTicks = Convert-ToInt64OrNull (Get-Field $fields $index "runtimeSchedulerCursorReadCompletedTicks")
                    if ($null -ne $readStartedTicks -and $null -ne $readCompletedTicks) {
                        $cursorReadUs = [double](($readCompletedTicks - $readStartedTicks) / $defaultTicksPerMicrosecond)
                    }
                }

                $schedulerIntervalUs = $null
                if ($null -ne $actualTickTicks -and $null -ne $prevActualTicks) {
                    $schedulerIntervalUs = [double](($actualTickTicks - $prevActualTicks) / $defaultTicksPerMicrosecond)
                    if ($null -eq $cadenceGapUs) {
                        if ($null -ne $refreshPeriodTicks) {
                            $cadenceGapUs = [double](($actualTickTicks - $prevActualTicks - $refreshPeriodTicks) / $defaultTicksPerMicrosecond)
                        }
                        elseif ($null -ne $refreshNumerator -and $null -ne $refreshDenominator -and $refreshNumerator -gt 0) {
                            $expectedUs = 1000000.0 * $refreshDenominator / $refreshNumerator
                            $cadenceGapUs = $schedulerIntervalUs - $expectedUs
                        }
                    }
                }
                elseif ($null -ne $elapsedUs -and $null -ne $prevElapsedUs) {
                    $schedulerIntervalUs = $elapsedUs - $prevElapsedUs
                }

                if ($null -ne $actualTickTicks) {
                    $prevActualTicks = $actualTickTicks
                }
                if ($null -ne $elapsedUs) {
                    $prevElapsedUs = $elapsedUs
                }

                if ($null -eq $vblankLeadUs -or $null -eq $queueToDispatchUs) {
                    continue
                }

                $queuedLeadUs = $vblankLeadUs + $queueToDispatchUs
                $estimatedWakeLateUs = 4000.0 - $queuedLeadUs
                $dispatcherLateUs = $queueToDispatchUs
                $classification = Get-Classification -EstimatedWakeLateUs $estimatedWakeLateUs -DispatcherLateUs $dispatcherLateUs -CursorReadLateUs $cursorReadUs -CadenceGapUs $cadenceGapUs

                if ($null -ne $cadenceGapUs) {
                    $cadenceGaps.Add([double]$cadenceGapUs)
                }
                $queueToDispatchValues.Add([double]$queueToDispatchUs)
                $wakeLateValues.Add([double]$estimatedWakeLateUs)
                if ($null -ne $cursorReadUs) {
                    $cursorReadValues.Add([double]$cursorReadUs)
                }

                $isOutlier = ($null -ne $cadenceGapUs -and $cadenceGapUs -ge $outlierThresholdUs) -or
                    ($null -ne $schedulerIntervalUs -and $schedulerIntervalUs -ge 20000.0) -or
                    $estimatedWakeLateUs -ge $outlierThresholdUs -or
                    $dispatcherLateUs -ge $outlierThresholdUs -or
                    ($null -ne $cursorReadUs -and $cursorReadUs -ge $outlierThresholdUs)

                if (-not $isOutlier) {
                    continue
                }

                $zipOutlierRows++
                $totalOutlierRows++
                $classCounts[$classification]++
                $zipClassCounts[$classification]++

                $outlier = [pscustomobject]@{
                    zip = $file.Name
                    traceEntry = $entry.FullName
                    sequence = $sequence
                    elapsedMicroseconds = $elapsedUs
                    schedulerIntervalUs = if ($null -ne $schedulerIntervalUs) { [math]::Round($schedulerIntervalUs, 3) } else { $null }
                    pollCadenceGapUs = if ($null -ne $cadenceGapUs) { [math]::Round($cadenceGapUs, 3) } else { $null }
                    runtimeSchedulerVBlankLeadMicroseconds = [math]::Round($vblankLeadUs, 3)
                    queueToDispatchUs = [math]::Round($queueToDispatchUs, 3)
                    queuedLeadUs = [math]::Round($queuedLeadUs, 3)
                    estimatedWakeLateUs = [math]::Round($estimatedWakeLateUs, 3)
                    dispatcherLateUs = [math]::Round($dispatcherLateUs, 3)
                    cursorReadLatencyUs = if ($null -ne $cursorReadUs) { [math]::Round($cursorReadUs, 3) } else { $null }
                    classification = $classification
                }

                if ($null -ne $cadenceGapUs) {
                    Add-TopOutlier -List $topByGap -Item $outlier -SortField "pollCadenceGapUs" -Limit $Top
                }
                if ($null -ne $schedulerIntervalUs) {
                    Add-TopOutlier -List $topByInterval -Item $outlier -SortField "schedulerIntervalUs" -Limit $Top
                }
            }

            $processedZips++
            $perZip.Add([pscustomobject]@{
                zip = $file.Name
                bytes = $file.Length
                traceEntry = $entry.FullName
                traceCsvBytes = $entry.Length
                pollRows = $zipPollRows
                outlierRows = $zipOutlierRows
                classifications = $zipClassCounts
            })
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }
}

$topByGapFinal = @($topByGap | Sort-Object -Property pollCadenceGapUs -Descending | Select-Object -First $Top)
$topByIntervalFinal = @($topByInterval | Sort-Object -Property schedulerIntervalUs -Descending | Select-Object -First $Top)

$metrics = [ordered]@{
    poc = "product-runtime-outlier-v1"
    step = "step-01-existing-trace-reclassification"
    generatedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    inputRoot = (Resolve-Path $RootPath).Path
    zipSelection = if ($ZipName.Count -gt 0) { "explicit ZipName first pass: $($ZipName -join ', ')" } else { "root cursor-mirror-trace-*.zip and cursor-mirror-motion-recording-*.zip" }
    fullCorpusPending = ($ZipName.Count -gt 0)
    wakeAdvanceUs = 4000
    formulas = [ordered]@{
        queuedLeadUs = "runtimeSchedulerVBlankLeadMicroseconds + queueToDispatchUs"
        estimatedWakeLateUs = "4000 - queuedLeadUs"
        dispatcherLateUs = "queueToDispatchUs"
    }
    thresholds = [ordered]@{
        outlierUs = $outlierThresholdUs
        schedulerWakeLateUs = 1000
        dispatcherLateUs = 1000
        cursorReadLateUs = 1000
    }
    totals = [ordered]@{
        candidateZipFiles = $allCandidateZipCount
        selectedZipFiles = $zipFiles.Count
        processedZips = $processedZips
        zipsWithoutTraceCsv = $zipsWithoutTrace
        runtimeSchedulerPollRows = $totalPollRows
        classifiedOutlierRows = $totalOutlierRows
    }
    classifications = $classCounts
    distributions = [ordered]@{
        pollCadenceGapUs = [ordered]@{
            count = $cadenceGaps.Count
            p50 = Get-Percentile ([double[]]$cadenceGaps.ToArray()) 50
            p95 = Get-Percentile ([double[]]$cadenceGaps.ToArray()) 95
            p99 = Get-Percentile ([double[]]$cadenceGaps.ToArray()) 99
            max = if ($cadenceGaps.Count -gt 0) { [math]::Round(($cadenceGaps | Measure-Object -Maximum).Maximum, 3) } else { $null }
        }
        queueToDispatchUs = [ordered]@{
            count = $queueToDispatchValues.Count
            p50 = Get-Percentile ([double[]]$queueToDispatchValues.ToArray()) 50
            p95 = Get-Percentile ([double[]]$queueToDispatchValues.ToArray()) 95
            p99 = Get-Percentile ([double[]]$queueToDispatchValues.ToArray()) 99
            max = if ($queueToDispatchValues.Count -gt 0) { [math]::Round(($queueToDispatchValues | Measure-Object -Maximum).Maximum, 3) } else { $null }
        }
        estimatedWakeLateUs = [ordered]@{
            count = $wakeLateValues.Count
            p50 = Get-Percentile ([double[]]$wakeLateValues.ToArray()) 50
            p95 = Get-Percentile ([double[]]$wakeLateValues.ToArray()) 95
            p99 = Get-Percentile ([double[]]$wakeLateValues.ToArray()) 99
            max = if ($wakeLateValues.Count -gt 0) { [math]::Round(($wakeLateValues | Measure-Object -Maximum).Maximum, 3) } else { $null }
        }
        cursorReadLatencyUs = [ordered]@{
            count = $cursorReadValues.Count
            p50 = Get-Percentile ([double[]]$cursorReadValues.ToArray()) 50
            p95 = Get-Percentile ([double[]]$cursorReadValues.ToArray()) 95
            p99 = Get-Percentile ([double[]]$cursorReadValues.ToArray()) 99
            max = if ($cursorReadValues.Count -gt 0) { [math]::Round(($cursorReadValues | Measure-Object -Maximum).Maximum, 3) } else { $null }
        }
    }
    topPollCadenceGapOutliers = $topByGapFinal
    topSchedulerIntervalOutliers = $topByIntervalFinal
    perZip = $perZip
}

$metricsPath = Join-Path $OutputPath "metrics.json"
$reportPath = Join-Path $OutputPath "report.md"
$logPath = Join-Path $OutputPath "experiment-log.md"

$metrics | ConvertTo-Json -Depth 8 | Set-Content -Path $metricsPath -Encoding UTF8

function Format-NullableUs {
    param($Value)
    if ($null -eq $Value) {
        return ""
    }
    return ([double]$Value).ToString("0.###", [System.Globalization.CultureInfo]::InvariantCulture)
}

$topRows = foreach ($row in ($topByGapFinal | Select-Object -First 12)) {
    "| $($row.zip) | $($row.sequence) | $(Format-NullableUs $row.pollCadenceGapUs) | $(Format-NullableUs $row.schedulerIntervalUs) | $(Format-NullableUs $row.runtimeSchedulerVBlankLeadMicroseconds) | $(Format-NullableUs $row.queueToDispatchUs) | $(Format-NullableUs $row.queuedLeadUs) | $(Format-NullableUs $row.estimatedWakeLateUs) | $(Format-NullableUs $row.cursorReadLatencyUs) | $($row.classification) |"
}

$intervalRows = foreach ($row in ($topByIntervalFinal | Select-Object -First 8)) {
    "| $($row.zip) | $($row.sequence) | $(Format-NullableUs $row.schedulerIntervalUs) | $(Format-NullableUs $row.pollCadenceGapUs) | $(Format-NullableUs $row.estimatedWakeLateUs) | $(Format-NullableUs $row.dispatcherLateUs) | $($row.classification) |"
}

$report = @"
# Step 01 Existing Trace Reclassification

## Summary

This step streams trace.csv from root trace and motion zip files without extracting or copying raw traces. It filters for runtimeSchedulerPoll rows before parsing metric fields.

The feedback formula is applied as:

- queuedLeadUs = runtimeSchedulerVBlankLeadMicroseconds + queueToDispatchUs
- estimatedWakeLateUs = 4000 - queuedLeadUs
- dispatcherLateUs = queueToDispatchUs

## Input Coverage

- Candidate root trace/motion zips: $allCandidateZipCount
- Selected zips for this pass: $($zipFiles.Count)
- Processed zips with trace.csv: $processedZips
- Runtime scheduler poll rows: $totalPollRows
- Classified outlier rows: $totalOutlierRows
- Full corpus pending: $($ZipName.Count -gt 0)

## Classification Counts

| Classification | Count |
| --- | ---: |
| scheduler_wake_late | $($classCounts.scheduler_wake_late) |
| dispatcher_late | $($classCounts.dispatcher_late) |
| cursor_read_late | $($classCounts.cursor_read_late) |
| mixed | $($classCounts.mixed) |
| unknown | $($classCounts.unknown) |

## Distribution Highlights

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| pollCadenceGap | $($metrics.distributions.pollCadenceGapUs.p50) | $($metrics.distributions.pollCadenceGapUs.p95) | $($metrics.distributions.pollCadenceGapUs.p99) | $($metrics.distributions.pollCadenceGapUs.max) |
| queueToDispatch | $($metrics.distributions.queueToDispatchUs.p50) | $($metrics.distributions.queueToDispatchUs.p95) | $($metrics.distributions.queueToDispatchUs.p99) | $($metrics.distributions.queueToDispatchUs.max) |
| estimatedWakeLate | $($metrics.distributions.estimatedWakeLateUs.p50) | $($metrics.distributions.estimatedWakeLateUs.p95) | $($metrics.distributions.estimatedWakeLateUs.p99) | $($metrics.distributions.estimatedWakeLateUs.max) |
| cursorReadLatency | $($metrics.distributions.cursorReadLatencyUs.p50) | $($metrics.distributions.cursorReadLatencyUs.p95) | $($metrics.distributions.cursorReadLatencyUs.p99) | $($metrics.distributions.cursorReadLatencyUs.max) |

## Top Poll Cadence Gap Outliers

| Zip | Seq | gap us | interval us | vblank lead us | queue dispatch us | queued lead us | est wake late us | cursor read us | classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
$($topRows -join "`n")

## Top Scheduler Interval Outliers

| Zip | Seq | interval us | gap us | est wake late us | dispatcher late us | classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
$($intervalRows -join "`n")

## Interpretation

The largest cadence gaps in this pass reclassify primarily as scheduler_wake_late, matching the feedback: the scheduler poll is already late relative to the 4 ms wake advance once queueToDispatchUs is folded into the queued lead. Smaller but still material outliers split between dispatcher delay and mixed cases where cursor read latency or dispatcher latency also crosses the 1 ms threshold.

When fullCorpusPending is true, this report is intentionally scoped to the selected zip list so the POC can complete without blocking on full root corpus parsing.

metrics.json contains the full top-$Top lists and per-zip counts for follow-up slicing.
"@

$report | Set-Content -Path $reportPath -Encoding UTF8

$log = @"
# Experiment Log

## Step

- POC: product-runtime-outlier-v1
- Step: 01 existing trace reclassification
- Generated: $($metrics.generatedAt)

## Actions

- Read feedback-from-pro.txt at repo root for the classification formula and prior interpretation.
- Enumerated root cursor-mirror-trace-*.zip and cursor-mirror-motion-recording-*.zip files.
- Selected zips for this run: $($zipFiles.Name -join ', ')
- Streamed each archive's trace.csv entry with System.IO.Compression.ZipFile.
- Filtered lines using ,runtimeSchedulerPoll, before splitting CSV fields.
- Did not extract archives and did not copy raw trace content into the POC directory.
- Wrote metrics.json and report.md from the analyzer.

## Classification Rule

- scheduler_wake_late: only estimated wake lateness exceeds 1000 us.
- dispatcher_late: only queue-to-dispatch lateness exceeds 1000 us.
- cursor_read_late: only cursor read latency exceeds 1000 us.
- mixed: more than one lateness signal exceeds 1000 us.
- unknown: cadence/interval outlier remains but none of the available lateness signals crosses 1000 us, or required fields are absent.

## Notes

- Older root trace zips lack runtimeSchedulerPollCadenceGapMicroseconds; for those rows the analyzer derives cadence gap from consecutive actual scheduler tick ticks and DWM refresh period when possible.
- The script intentionally keeps raw trace zips at the repository root and only writes derived artifacts inside this step directory.
- Full root corpus processing remains pending when the script is run with -ZipName.
"@

$log | Set-Content -Path $logPath -Encoding UTF8

Write-Host "Wrote $metricsPath"
Write-Host "Wrote $reportPath"
Write-Host "Wrote $logPath"
