param(
    [string]$ZipPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")) "cursor-mirror-trace-20260501-091537.zip"),
    [string]$OutputDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function New-List {
    $list = [System.Collections.Generic.List[double]]::new()
    Write-Output -NoEnumerate $list
}

function Add-Number {
    param([System.Collections.Generic.List[double]]$List, [double]$Value)
    [void]$List.Add($Value)
}

function Get-Percentile {
    param([double[]]$Sorted, [double]$P)
    if ($Sorted.Count -eq 0) { return $null }
    if ($Sorted.Count -eq 1) { return $Sorted[0] }
    $rank = ($Sorted.Count - 1) * $P
    $lo = [int][Math]::Floor($rank)
    $hi = [int][Math]::Ceiling($rank)
    if ($lo -eq $hi) { return $Sorted[$lo] }
    $w = $rank - $lo
    return $Sorted[$lo] * (1.0 - $w) + $Sorted[$hi] * $w
}

function Get-Stats {
    param([System.Collections.Generic.List[double]]$Values, [double]$Scale = 1.0)
    $count = $Values.Count
    if ($count -eq 0) {
        return [ordered]@{
            count = 0; min = $null; max = $null; mean = $null; stdev = $null
            p50 = $null; p90 = $null; p95 = $null; p99 = $null
        }
    }

    $sum = 0.0
    $sumSq = 0.0
    $min = [double]::PositiveInfinity
    $max = [double]::NegativeInfinity
    foreach ($raw in $Values) {
        $v = $raw * $Scale
        $sum += $v
        $sumSq += $v * $v
        if ($v -lt $min) { $min = $v }
        if ($v -gt $max) { $max = $v }
    }
    $mean = $sum / $count
    $variance = [Math]::Max(0.0, ($sumSq / $count) - ($mean * $mean))
    $sorted = @($Values.ToArray() | ForEach-Object { $_ * $Scale } | Sort-Object)

    return [ordered]@{
        count = $count
        min = $min
        max = $max
        mean = $mean
        stdev = [Math]::Sqrt($variance)
        p50 = Get-Percentile -Sorted $sorted -P 0.50
        p90 = Get-Percentile -Sorted $sorted -P 0.90
        p95 = Get-Percentile -Sorted $sorted -P 0.95
        p99 = Get-Percentile -Sorted $sorted -P 0.99
    }
}

function Increment-Map {
    param([hashtable]$Map, [string]$Key, [int64]$By = 1)
    if (-not $Map.ContainsKey($Key)) { $Map[$Key] = [int64]0 }
    $Map[$Key] = [int64]$Map[$Key] + $By
}

function Convert-Map {
    param([hashtable]$Map)
    $ordered = [ordered]@{}
    foreach ($key in @($Map.Keys | Sort-Object)) {
        $ordered[$key] = $Map[$key]
    }
    return $ordered
}

function Lower-Bound {
    param([System.Collections.Generic.List[double]]$Values, [double]$Needle)
    $lo = 0
    $hi = $Values.Count
    while ($lo -lt $hi) {
        $mid = [int][Math]::Floor(($lo + $hi) / 2)
        if ($Values[$mid] -lt $Needle) { $lo = $mid + 1 } else { $hi = $mid }
    }
    return $lo
}

function Poll-At-Or-After {
    param([System.Collections.Generic.List[double]]$Times, [double]$Needle)
    $idx = Lower-Bound -Values $Times -Needle $Needle
    if ($idx -ge $Times.Count) { return $Times[$Times.Count - 1] }
    return $Times[$idx]
}

function Poll-At-Or-Before {
    param([System.Collections.Generic.List[double]]$Times, [double]$Needle)
    $idx = (Lower-Bound -Values $Times -Needle $Needle) - 1
    if ($idx -lt 0) { return $Times[0] }
    return $Times[$idx]
}

function Count-In-Range {
    param([System.Collections.Generic.List[double]]$Times, [double]$StartInclusive, [double]$EndInclusive)
    $n = 0
    foreach ($t in $Times) {
        if ($t -ge $StartInclusive -and $t -le $EndInclusive) { $n++ }
    }
    return $n
}

function Format-Ms {
    param($Value)
    if ($null -eq $Value) { return "n/a" }
    return ("{0:N3}" -f $Value)
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
    throw "Input zip not found: $ZipPath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZipPath))
try {
    $metadataEntry = $zip.GetEntry("metadata.json")
    $traceEntry = $zip.GetEntry("trace.csv")
    if ($null -eq $metadataEntry -or $null -eq $traceEntry) {
        throw "Expected metadata.json and trace.csv in $ZipPath"
    }

    $metadataReader = [System.IO.StreamReader]::new($metadataEntry.Open())
    try {
        $metadataJson = $metadataReader.ReadToEnd()
    } finally {
        $metadataReader.Dispose()
    }
    $metadata = $metadataJson | ConvertFrom-Json
    $stopwatchFrequency = [double]$metadata.StopwatchFrequency

    $eventCounts = @{}
    $dwmAvailableCounts = @{}
    $dwmRateCounts = @{}
    $dwmPeriodCounts = @{}

    $allElapsedUs = New-List
    $allIntervalUs = New-List
    $pollElapsedUs = New-List
    $pollTicks = New-List
    $pollX = New-List
    $pollY = New-List
    $pollIntervalUs = New-List
    $hookElapsedUs = New-List
    $hookX = New-List
    $hookY = New-List
    $hookIntervalUs = New-List
    $elapsedStopwatchErrorUs = New-List
    $elapsedStopwatchAbsErrorUs = New-List
    $dwmRefreshPeriodMs = New-List
    $dwmChangedVblankDeltaMs = New-List
    $dwmRefreshCountDeltas = New-List
    $dwmVblankContinuityErrorMs = New-List
    $dwmPollToVblankMs = New-List
    $hookNearestPollAbsDtMs = New-List
    $hookNearestPollSignedDtMs = New-List
    $hookNearestPollDistancePx = New-List
    $hookNearestPollDistanceWithin4MsPx = New-List
    $hookNearestPollDistanceWithin8MsPx = New-List
    $hookNearestPollDistanceWithin16MsPx = New-List
    $idleDurationsMs = New-List

    $rowCount = 0
    $sequenceNonMonotonic = 0
    $sequenceGapCount = 0
    $timestampNonMonotonic = 0
    $elapsedNonMonotonic = 0
    $duplicateConsecutivePositionsAll = 0
    $duplicateConsecutivePositionsPoll = 0
    $duplicateConsecutivePositionsHook = 0
    $movementSamplesAll = 0
    $movementSamplesPoll = 0
    $movementSamplesHook = 0
    $dwmVblankRepeatedSamples = 0
    $dwmVblankNonMonotonic = 0
    $dwmRefreshCountNonMonotonic = 0
    $dwmRefreshCountJumps = 0
    $dwmVblankContinuityAnomalies = 0
    $idlePeriodCountAtLeast100Ms = 0
    $idlePeriodCountAtLeast500Ms = 0
    $idlePeriodCountAtLeast1000Ms = 0

    $firstSequence = $null
    $lastSequence = $null
    $firstTicks = $null
    $lastTicks = $null
    $firstElapsed = $null
    $lastElapsed = $null
    $previousSequence = $null
    $previousTicks = $null
    $previousElapsed = $null
    $previousX = $null
    $previousY = $null
    $previousPollElapsed = $null
    $previousPollX = $null
    $previousPollY = $null
    $previousHookElapsed = $null
    $previousHookX = $null
    $previousHookY = $null
    $previousDwmVblank = $null
    $previousDwmRefreshCount = $null
    $previousDwmPeriod = $null
    $idleRunStartElapsed = $null
    $idleRunLastElapsed = $null
    $idleRunSamples = 0

    $reader = [System.IO.StreamReader]::new($traceEntry.Open())
    try {
        $header = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($header)) { throw "trace.csv is empty" }
        $columns = $header.Split(",")
        $idx = @{}
        for ($i = 0; $i -lt $columns.Count; $i++) { $idx[$columns[$i]] = $i }

        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line.Split(",")
            $sequence = [int64]$parts[$idx["sequence"]]
            $ticks = [int64]$parts[$idx["stopwatchTicks"]]
            $elapsed = [double]$parts[$idx["elapsedMicroseconds"]]
            $x = [int]$parts[$idx["x"]]
            $y = [int]$parts[$idx["y"]]
            $event = $parts[$idx["event"]]
            $rowCount++

            if ($null -eq $firstSequence) {
                $firstSequence = $sequence
                $firstTicks = $ticks
                $firstElapsed = $elapsed
            }
            $lastSequence = $sequence
            $lastTicks = $ticks
            $lastElapsed = $elapsed

            Increment-Map -Map $eventCounts -Key $event
            Add-Number -List $allElapsedUs -Value $elapsed

            if ($null -ne $previousSequence) {
                $sequenceDelta = $sequence - $previousSequence
                if ($sequenceDelta -le 0) { $sequenceNonMonotonic++ }
                if ($sequenceDelta -ne 1) { $sequenceGapCount++ }

                $tickDelta = $ticks - $previousTicks
                if ($tickDelta -le 0) { $timestampNonMonotonic++ }

                $elapsedDelta = $elapsed - $previousElapsed
                if ($elapsedDelta -lt 0) { $elapsedNonMonotonic++ }
                Add-Number -List $allIntervalUs -Value $elapsedDelta

                if ($x -eq $previousX -and $y -eq $previousY) {
                    $duplicateConsecutivePositionsAll++
                } else {
                    $movementSamplesAll++
                }
            }

            $expectedElapsed = [double]$firstElapsed + (([double]($ticks - $firstTicks)) * 1000000.0 / $stopwatchFrequency)
            $elapsedError = $elapsed - $expectedElapsed
            Add-Number -List $elapsedStopwatchErrorUs -Value $elapsedError
            Add-Number -List $elapsedStopwatchAbsErrorUs -Value ([Math]::Abs($elapsedError))

            if ($event -eq "poll") {
                Add-Number -List $pollElapsedUs -Value $elapsed
                Add-Number -List $pollTicks -Value $ticks
                Add-Number -List $pollX -Value $x
                Add-Number -List $pollY -Value $y

                if ($null -ne $previousPollElapsed) {
                    Add-Number -List $pollIntervalUs -Value ($elapsed - $previousPollElapsed)
                    if ($x -eq $previousPollX -and $y -eq $previousPollY) {
                        $duplicateConsecutivePositionsPoll++
                    } else {
                        $movementSamplesPoll++
                        $idleDuration = $previousPollElapsed - $idleRunStartElapsed
                        Add-Number -List $idleDurationsMs -Value ($idleDuration / 1000.0)
                        if ($idleDuration -ge 100000.0) { $idlePeriodCountAtLeast100Ms++ }
                        if ($idleDuration -ge 500000.0) { $idlePeriodCountAtLeast500Ms++ }
                        if ($idleDuration -ge 1000000.0) { $idlePeriodCountAtLeast1000Ms++ }
                        $idleRunStartElapsed = $elapsed
                        $idleRunSamples = 1
                    }
                    $idleRunLastElapsed = $elapsed
                    $idleRunSamples++
                } else {
                    $idleRunStartElapsed = $elapsed
                    $idleRunLastElapsed = $elapsed
                    $idleRunSamples = 1
                }
                $previousPollElapsed = $elapsed
                $previousPollX = $x
                $previousPollY = $y

                $dwmAvailableText = $parts[$idx["dwmTimingAvailable"]]
                Increment-Map -Map $dwmAvailableCounts -Key $dwmAvailableText
                if ($dwmAvailableText -eq "true") {
                    $rateKey = "{0}/{1}" -f $parts[$idx["dwmRateRefreshNumerator"]], $parts[$idx["dwmRateRefreshDenominator"]]
                    $periodTicks = [int64]$parts[$idx["dwmQpcRefreshPeriod"]]
                    $vblank = [int64]$parts[$idx["dwmQpcVBlank"]]
                    $refreshCount = [int64]$parts[$idx["dwmRefreshCount"]]
                    Increment-Map -Map $dwmRateCounts -Key $rateKey
                    Increment-Map -Map $dwmPeriodCounts -Key ([string]$periodTicks)
                    Add-Number -List $dwmRefreshPeriodMs -Value ($periodTicks * 1000.0 / $stopwatchFrequency)
                    Add-Number -List $dwmPollToVblankMs -Value (([double]($vblank - $ticks)) * 1000.0 / $stopwatchFrequency)

                    if ($null -ne $previousDwmVblank) {
                        if ($vblank -lt $previousDwmVblank) {
                            $dwmVblankNonMonotonic++
                        } elseif ($vblank -eq $previousDwmVblank) {
                            $dwmVblankRepeatedSamples++
                        } else {
                            $deltaTicks = $vblank - $previousDwmVblank
                            Add-Number -List $dwmChangedVblankDeltaMs -Value ($deltaTicks * 1000.0 / $stopwatchFrequency)
                            if ($periodTicks -gt 0) {
                                $multiple = [Math]::Max(1.0, [Math]::Round($deltaTicks / [double]$periodTicks))
                                $continuityErrorTicks = $deltaTicks - ($multiple * $periodTicks)
                                $continuityErrorMs = $continuityErrorTicks * 1000.0 / $stopwatchFrequency
                                Add-Number -List $dwmVblankContinuityErrorMs -Value ([Math]::Abs($continuityErrorMs))
                                if ([Math]::Abs($continuityErrorTicks) -gt 1000.0) {
                                    $dwmVblankContinuityAnomalies++
                                }
                            }
                        }
                    }
                    if ($null -ne $previousDwmRefreshCount) {
                        $refreshDelta = $refreshCount - $previousDwmRefreshCount
                        Add-Number -List $dwmRefreshCountDeltas -Value $refreshDelta
                        if ($refreshDelta -lt 0) { $dwmRefreshCountNonMonotonic++ }
                        if ($refreshDelta -gt 1) { $dwmRefreshCountJumps++ }
                    }
                    $previousDwmVblank = $vblank
                    $previousDwmRefreshCount = $refreshCount
                    $previousDwmPeriod = $periodTicks
                }
            } elseif ($event -eq "hook" -or $event -eq "move") {
                Add-Number -List $hookElapsedUs -Value $elapsed
                Add-Number -List $hookX -Value $x
                Add-Number -List $hookY -Value $y
                if ($null -ne $previousHookElapsed) {
                    Add-Number -List $hookIntervalUs -Value ($elapsed - $previousHookElapsed)
                    if ($x -eq $previousHookX -and $y -eq $previousHookY) {
                        $duplicateConsecutivePositionsHook++
                    } else {
                        $movementSamplesHook++
                    }
                }
                $previousHookElapsed = $elapsed
                $previousHookX = $x
                $previousHookY = $y
            }

            $previousSequence = $sequence
            $previousTicks = $ticks
            $previousElapsed = $elapsed
            $previousX = $x
            $previousY = $y
        }
    } finally {
        $reader.Dispose()
    }

    if ($null -ne $idleRunStartElapsed -and $null -ne $idleRunLastElapsed) {
        $idleDuration = $idleRunLastElapsed - $idleRunStartElapsed
        Add-Number -List $idleDurationsMs -Value ($idleDuration / 1000.0)
        if ($idleDuration -ge 100000.0) { $idlePeriodCountAtLeast100Ms++ }
        if ($idleDuration -ge 500000.0) { $idlePeriodCountAtLeast500Ms++ }
        if ($idleDuration -ge 1000000.0) { $idlePeriodCountAtLeast1000Ms++ }
    }

    for ($i = 0; $i -lt $hookElapsedUs.Count; $i++) {
        $t = $hookElapsedUs[$i]
        $insert = Lower-Bound -Values $pollElapsedUs -Needle $t
        $candidates = @()
        if ($insert -lt $pollElapsedUs.Count) { $candidates += $insert }
        if ($insert -gt 0) { $candidates += ($insert - 1) }
        $bestIndex = $null
        $bestAbs = [double]::PositiveInfinity
        foreach ($candidate in $candidates) {
            $abs = [Math]::Abs($t - $pollElapsedUs[$candidate])
            if ($abs -lt $bestAbs) {
                $bestAbs = $abs
                $bestIndex = $candidate
            }
        }
        if ($null -ne $bestIndex) {
            $signedDtMs = ($t - $pollElapsedUs[$bestIndex]) / 1000.0
            $distance = [Math]::Sqrt([Math]::Pow($hookX[$i] - $pollX[$bestIndex], 2.0) + [Math]::Pow($hookY[$i] - $pollY[$bestIndex], 2.0))
            Add-Number -List $hookNearestPollAbsDtMs -Value ([Math]::Abs($signedDtMs))
            Add-Number -List $hookNearestPollSignedDtMs -Value $signedDtMs
            Add-Number -List $hookNearestPollDistancePx -Value $distance
            if ([Math]::Abs($signedDtMs) -le 4.0) { Add-Number -List $hookNearestPollDistanceWithin4MsPx -Value $distance }
            if ([Math]::Abs($signedDtMs) -le 8.0) { Add-Number -List $hookNearestPollDistanceWithin8MsPx -Value $distance }
            if ([Math]::Abs($signedDtMs) -le 16.0) { Add-Number -List $hookNearestPollDistanceWithin16MsPx -Value $distance }
        }
    }

    $pollStartUs = $pollElapsedUs[0]
    $pollEndUs = $pollElapsedUs[$pollElapsedUs.Count - 1]
    $pollDurationUs = $pollEndUs - $pollStartUs
    $splitGapUs = 1000000.0
    $rawTrainEnd = $pollStartUs + ($pollDurationUs * 0.70)
    $rawValEnd = $pollStartUs + ($pollDurationUs * 0.85)
    $trainEndUs = Poll-At-Or-Before -Times $pollElapsedUs -Needle $rawTrainEnd
    $valStartUs = Poll-At-Or-After -Times $pollElapsedUs -Needle ($trainEndUs + $splitGapUs)
    $valEndUs = Poll-At-Or-Before -Times $pollElapsedUs -Needle $rawValEnd
    $testStartUs = Poll-At-Or-After -Times $pollElapsedUs -Needle ($valEndUs + $splitGapUs)

    $split = [ordered]@{
        clock = "elapsedMicroseconds aligned to poll samples"
        recommended_gap_us = [int64]$splitGapUs
        rationale = "Chronological 70/15/15 poll-time split with 1s gaps; this is much larger than the 24ms initial target horizon and leaves room for Phase 2 history windows without adjacent-window leakage."
        train = [ordered]@{
            start_elapsed_us = [int64]$pollStartUs
            end_elapsed_us = [int64]$trainEndUs
            duration_s = ($trainEndUs - $pollStartUs) / 1000000.0
            row_count = Count-In-Range -Times $allElapsedUs -StartInclusive $pollStartUs -EndInclusive $trainEndUs
            poll_count = Count-In-Range -Times $pollElapsedUs -StartInclusive $pollStartUs -EndInclusive $trainEndUs
            hook_count = Count-In-Range -Times $hookElapsedUs -StartInclusive $pollStartUs -EndInclusive $trainEndUs
        }
        train_validation_gap = [ordered]@{
            start_elapsed_us = [int64]($trainEndUs + 1)
            end_elapsed_us = [int64]($valStartUs - 1)
            duration_s = ($valStartUs - $trainEndUs) / 1000000.0
        }
        validation = [ordered]@{
            start_elapsed_us = [int64]$valStartUs
            end_elapsed_us = [int64]$valEndUs
            duration_s = ($valEndUs - $valStartUs) / 1000000.0
            row_count = Count-In-Range -Times $allElapsedUs -StartInclusive $valStartUs -EndInclusive $valEndUs
            poll_count = Count-In-Range -Times $pollElapsedUs -StartInclusive $valStartUs -EndInclusive $valEndUs
            hook_count = Count-In-Range -Times $hookElapsedUs -StartInclusive $valStartUs -EndInclusive $valEndUs
        }
        validation_test_gap = [ordered]@{
            start_elapsed_us = [int64]($valEndUs + 1)
            end_elapsed_us = [int64]($testStartUs - 1)
            duration_s = ($testStartUs - $valEndUs) / 1000000.0
        }
        test = [ordered]@{
            start_elapsed_us = [int64]$testStartUs
            end_elapsed_us = [int64]$pollEndUs
            duration_s = ($pollEndUs - $testStartUs) / 1000000.0
            row_count = Count-In-Range -Times $allElapsedUs -StartInclusive $testStartUs -EndInclusive $pollEndUs
            poll_count = Count-In-Range -Times $pollElapsedUs -StartInclusive $testStartUs -EndInclusive $pollEndUs
            hook_count = Count-In-Range -Times $hookElapsedUs -StartInclusive $testStartUs -EndInclusive $pollEndUs
        }
    }

    $scores = [ordered]@{
        phase = "phase-1 data-audit-timebase"
        generated_utc = (Get-Date).ToUniversalTime().ToString("o")
        input = [ordered]@{
            zip_path = (Resolve-Path -LiteralPath $ZipPath).Path
            zip_size_bytes = (Get-Item -LiteralPath $ZipPath).Length
            metadata = $metadata
        }
        row_counts = [ordered]@{
            trace_csv_rows = $rowCount
            metadata_sample_count = [int64]$metadata.SampleCount
            count_matches_metadata = ($rowCount -eq [int64]$metadata.SampleCount)
            event_type_counts = Convert-Map -Map $eventCounts
        }
        monotonicity = [ordered]@{
            first_sequence = [int64]$firstSequence
            last_sequence = [int64]$lastSequence
            sequence_non_monotonic_count = $sequenceNonMonotonic
            sequence_gap_count = $sequenceGapCount
            stopwatch_non_increasing_count = $timestampNonMonotonic
            elapsed_decreasing_count = $elapsedNonMonotonic
            all_event_interval_ms = Get-Stats -Values $allIntervalUs -Scale 0.001
        }
        elapsed_vs_stopwatch = [ordered]@{
            first_stopwatch_ticks = [int64]$firstTicks
            last_stopwatch_ticks = [int64]$lastTicks
            first_elapsed_us = [int64]$firstElapsed
            last_elapsed_us = [int64]$lastElapsed
            metadata_duration_us = [int64]$metadata.DurationMicroseconds
            observed_elapsed_span_us = [int64]($lastElapsed - $firstElapsed)
            metadata_minus_observed_span_us = [int64]([int64]$metadata.DurationMicroseconds - [int64]($lastElapsed - $firstElapsed))
            elapsed_minus_stopwatch_expected_us = Get-Stats -Values $elapsedStopwatchErrorUs
            elapsed_minus_stopwatch_expected_abs_us = Get-Stats -Values $elapsedStopwatchAbsErrorUs
        }
        positions = [ordered]@{
            duplicate_consecutive_positions_all = $duplicateConsecutivePositionsAll
            movement_samples_all = $movementSamplesAll
            duplicate_consecutive_positions_poll = $duplicateConsecutivePositionsPoll
            movement_samples_poll = $movementSamplesPoll
            duplicate_consecutive_positions_hook = $duplicateConsecutivePositionsHook
            movement_samples_hook = $movementSamplesHook
            poll_idle_periods = [ordered]@{
                durations_ms = Get-Stats -Values $idleDurationsMs
                count_at_least_100ms = $idlePeriodCountAtLeast100Ms
                count_at_least_500ms = $idlePeriodCountAtLeast500Ms
                count_at_least_1000ms = $idlePeriodCountAtLeast1000Ms
            }
        }
        sampling = [ordered]@{
            poll_interval_ms = Get-Stats -Values $pollIntervalUs -Scale 0.001
            hook_interval_ms = Get-Stats -Values $hookIntervalUs -Scale 0.001
        }
        dwm = [ordered]@{
            timing_available_counts = Convert-Map -Map $dwmAvailableCounts
            refresh_rate_counts = Convert-Map -Map $dwmRateCounts
            qpc_refresh_period_tick_counts = Convert-Map -Map $dwmPeriodCounts
            qpc_refresh_period_ms = Get-Stats -Values $dwmRefreshPeriodMs
            qpc_vblank_changed_delta_ms = Get-Stats -Values $dwmChangedVblankDeltaMs
            qpc_vblank_repeated_sample_count = $dwmVblankRepeatedSamples
            qpc_vblank_non_monotonic_count = $dwmVblankNonMonotonic
            refresh_count_delta = Get-Stats -Values $dwmRefreshCountDeltas
            refresh_count_non_monotonic_count = $dwmRefreshCountNonMonotonic
            refresh_count_jump_count = $dwmRefreshCountJumps
            qpc_vblank_continuity_abs_error_ms = Get-Stats -Values $dwmVblankContinuityErrorMs
            qpc_vblank_continuity_anomaly_count = $dwmVblankContinuityAnomalies
            poll_timestamp_to_dwm_vblank_ms = Get-Stats -Values $dwmPollToVblankMs
        }
        hook_vs_nearest_poll = [ordered]@{
            matched_hook_count = $hookNearestPollDistancePx.Count
            signed_time_delta_ms = Get-Stats -Values $hookNearestPollSignedDtMs
            absolute_time_delta_ms = Get-Stats -Values $hookNearestPollAbsDtMs
            distance_px_all_matches = Get-Stats -Values $hookNearestPollDistancePx
            distance_px_within_4ms = Get-Stats -Values $hookNearestPollDistanceWithin4MsPx
            distance_px_within_8ms = Get-Stats -Values $hookNearestPollDistanceWithin8MsPx
            distance_px_within_16ms = Get-Stats -Values $hookNearestPollDistanceWithin16MsPx
        }
        recommended_split = $split
        recommendations = [ordered]@{
            ground_truth_clock = "Use poll elapsedMicroseconds as the Phase 2 label clock and interpolate between poll positions when fixed horizons fall between samples."
            dwm_usage = "DWM timing is complete and cadence-stable enough to evaluate display-relative horizons, but use it for target horizon/phase selection rather than as a direct position source."
            split = "Use the recommended chronological split in recommended_split with 1s exclusion gaps."
            caution = "Poll jitter has a wide tail, so labels should be timestamp-based, not sample-index-based."
        }
    }

    $scoresPath = Join-Path $OutputDir "scores.json"
    $scores | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $scoresPath -Encoding UTF8

    $pollStats = $scores.sampling.poll_interval_ms
    $hookStats = $scores.sampling.hook_interval_ms
    $dwmStats = $scores.dwm.qpc_vblank_changed_delta_ms
    $dwmPeriodStats = $scores.dwm.qpc_refresh_period_ms
    $hookPollStats = $scores.hook_vs_nearest_poll
    $idleStats = $scores.positions.poll_idle_periods.durations_ms
    $hookLikeEventCount = [int64]0
    foreach ($hookEventKey in @("hook", "move")) {
        if ($eventCounts.ContainsKey($hookEventKey)) {
            $hookLikeEventCount += [int64]$eventCounts[$hookEventKey]
        }
    }

    $report = @"
# Phase 1 Data Audit and Timebase Reconstruction

## Input
- Trace zip: ``$((Resolve-Path -LiteralPath $ZipPath).Path)``
- Trace format: ``$($metadata.TraceFormatVersion)``
- Metadata sample count: ``$($metadata.SampleCount)``
- Observed CSV rows: ``$rowCount``
- Duration from metadata: ``$([Math]::Round([double]$metadata.DurationMicroseconds / 1000000.0, 3))s``

## Data Quality
- Row count matches metadata: ``$($rowCount -eq [int64]$metadata.SampleCount)``
- Event counts: hook/move ``$hookLikeEventCount``, poll ``$($eventCounts["poll"])``
- Sequence gaps/non-monotonic: ``$sequenceGapCount`` / ``$sequenceNonMonotonic``
- Stopwatch non-increasing rows: ``$timestampNonMonotonic``
- Elapsed timestamp decreases: ``$elapsedNonMonotonic``
- Elapsed-vs-stopwatch max absolute drift: ``$(Format-Ms $scores.elapsed_vs_stopwatch.elapsed_minus_stopwatch_expected_abs_us.max)``us

## Sampling and Idle Behavior
- Poll interval mean/p50/p95/p99: ``$(Format-Ms $pollStats.mean)`` / ``$(Format-Ms $pollStats.p50)`` / ``$(Format-Ms $pollStats.p95)`` / ``$(Format-Ms $pollStats.p99)`` ms
- Hook interval mean/p50/p95/p99: ``$(Format-Ms $hookStats.mean)`` / ``$(Format-Ms $hookStats.p50)`` / ``$(Format-Ms $hookStats.p95)`` / ``$(Format-Ms $hookStats.p99)`` ms
- Consecutive duplicate poll positions: ``$duplicateConsecutivePositionsPoll``
- Poll idle periods >=100ms / >=500ms / >=1000ms: ``$idlePeriodCountAtLeast100Ms`` / ``$idlePeriodCountAtLeast500Ms`` / ``$idlePeriodCountAtLeast1000Ms``
- Longest poll idle period: ``$(Format-Ms $idleStats.max)`` ms

## DWM Timing
- DWM timing availability: ``$((Convert-Map -Map $dwmAvailableCounts | ConvertTo-Json -Compress))``
- DWM refresh rate keys: ``$((Convert-Map -Map $dwmRateCounts | ConvertTo-Json -Compress))``
- DWM refresh-period field mean/p50/p95/p99: ``$(Format-Ms $dwmPeriodStats.mean)`` / ``$(Format-Ms $dwmPeriodStats.p50)`` / ``$(Format-Ms $dwmPeriodStats.p95)`` / ``$(Format-Ms $dwmPeriodStats.p99)`` ms
- Changed-vblank cadence observed at poll samples mean/p50/p95/p99: ``$(Format-Ms $dwmStats.mean)`` / ``$(Format-Ms $dwmStats.p50)`` / ``$(Format-Ms $dwmStats.p95)`` / ``$(Format-Ms $dwmStats.p99)`` ms
- QPC vblank non-monotonic count: ``$dwmVblankNonMonotonic``
- QPC vblank continuity anomalies: ``$dwmVblankContinuityAnomalies``
- Poll timestamp to DWM vblank p50/p95: ``$(Format-Ms $scores.dwm.poll_timestamp_to_dwm_vblank_ms.p50)`` / ``$(Format-Ms $scores.dwm.poll_timestamp_to_dwm_vblank_ms.p95)`` ms

## Hook vs Nearest Poll
- Matched hook samples: ``$($hookPollStats.matched_hook_count)``
- Absolute nearest-poll timing p50/p95/p99: ``$(Format-Ms $hookPollStats.absolute_time_delta_ms.p50)`` / ``$(Format-Ms $hookPollStats.absolute_time_delta_ms.p95)`` / ``$(Format-Ms $hookPollStats.absolute_time_delta_ms.p99)`` ms
- Position delta p50/p95/p99 for all nearest matches: ``$(Format-Ms $hookPollStats.distance_px_all_matches.p50)`` / ``$(Format-Ms $hookPollStats.distance_px_all_matches.p95)`` / ``$(Format-Ms $hookPollStats.distance_px_all_matches.p99)`` px
- Position delta p95 within 8ms: ``$(Format-Ms $hookPollStats.distance_px_within_8ms.p95)`` px across ``$($hookPollStats.distance_px_within_8ms.count)`` hooks

## Recommended Time Split
- Clock: poll ``elapsedMicroseconds``
- Train: ``$($split.train.start_elapsed_us)`` to ``$($split.train.end_elapsed_us)`` us (``$([Math]::Round($split.train.duration_s, 3))``s)
- Validation: ``$($split.validation.start_elapsed_us)`` to ``$($split.validation.end_elapsed_us)`` us (``$([Math]::Round($split.validation.duration_s, 3))``s)
- Test: ``$($split.test.start_elapsed_us)`` to ``$($split.test.end_elapsed_us)`` us (``$([Math]::Round($split.test.duration_s, 3))``s)
- Gaps: 1s between train/validation and validation/test

## Phase 2 Implications
Use poll samples as the visible-position ground truth and build labels by timestamp interpolation instead of fixed sample offsets. DWM timing is present for every poll and has a stable approximately 16.668ms refresh-period field, so Phase 2 should include ``dwm-next-vblank`` and latency-offset targets. The trace also has enough hook/poll divergence during motion to keep hook-derived features separate from poll-derived labels.
"@
    Set-Content -LiteralPath (Join-Path $OutputDir "report.md") -Value $report -Encoding UTF8

    $readme = @"
# Phase 1: Data Audit and Timebase Reconstruction

This directory contains the Phase 1 audit for ``cursor-mirror-trace-20260501-091537.zip``. The zip is read in place from the repository root; it is not copied here.

## Reproduce

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-1 data-audit-timebase/run-phase1-audit.ps1"
~~~

The script uses PowerShell plus .NET built-ins only. Python was not available in this workspace at execution time.

## Outputs

- ``scores.json``: machine-readable audit metrics.
- ``report.md``: concise findings and split recommendation.
- ``experiment-log.md``: execution log.
- ``run-phase1-audit.ps1``: reproducible audit script.
"@
    Set-Content -LiteralPath (Join-Path $OutputDir "README.md") -Value $readme -Encoding UTF8

    $log = @"
# Phase 1 Experiment Log

## $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
- Created Phase 1 directory.
- Read ``metadata.json`` and ``trace.csv`` directly from repository-root zip: ``$((Resolve-Path -LiteralPath $ZipPath).Path)``.
- Python was not available via ``python``, ``python3``, or ``py``; used dependency-free PowerShell/.NET instead.
- Computed row/event counts, sequence and time monotonicity, elapsed-vs-stopwatch consistency, duplicate positions, idle gaps, poll/hook interval distributions, DWM timing availability/cadence/continuity, hook-vs-nearest-poll deltas, and chronological split boundaries.
- Wrote ``scores.json`` and ``report.md``.
"@
    Set-Content -LiteralPath (Join-Path $OutputDir "experiment-log.md") -Value $log -Encoding UTF8
} finally {
    $zip.Dispose()
}
