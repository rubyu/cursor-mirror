param(
    [string]$ZipPath,
    [string]$OutputPath,
    [double]$IdleGapMs = 100.0
)

$ErrorActionPreference = "Stop"

$HorizonsMs = @(0, 4, 8, 12, 16, 24, 32, 48)
$CapsPx = @($null, 16.0, 32.0, 64.0)
$RegressionWindows = @(3, 5, 8)
$EmaAlphas = @(0.2, 0.35, 0.5, 0.75)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $ZipPath = Join-Path $RepoRoot "cursor-mirror-trace-20260501-000443.zip"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ScriptDir "scores.json"
}

function Get-Percentile {
    param(
        [double[]]$SortedValues,
        [double]$P
    )

    if ($SortedValues.Length -eq 0) { return $null }
    if ($SortedValues.Length -eq 1) { return $SortedValues[0] }
    $rank = ($SortedValues.Length - 1) * $P
    $lo = [int][Math]::Floor($rank)
    $hi = [int][Math]::Ceiling($rank)
    if ($lo -eq $hi) { return $SortedValues[$lo] }
    $weight = $rank - $lo
    return $SortedValues[$lo] * (1.0 - $weight) + $SortedValues[$hi] * $weight
}

function Get-BasicStats {
    param($Values)

    if ($Values.Count -eq 0) {
        return [ordered]@{
            count = 0
            min   = $null
            mean  = $null
            p50   = $null
            p90   = $null
            p95   = $null
            p99   = $null
            max   = $null
        }
    }

    $arr = [double[]]$Values.ToArray()
    [Array]::Sort($arr)
    $sum = 0.0
    foreach ($value in $arr) { $sum += $value }
    return [ordered]@{
        count = $arr.Length
        min   = $arr[0]
        mean  = $sum / $arr.Length
        p50   = Get-Percentile $arr 0.50
        p90   = Get-Percentile $arr 0.90
        p95   = Get-Percentile $arr 0.95
        p99   = Get-Percentile $arr 0.99
        max   = $arr[$arr.Length - 1]
    }
}

function Get-ErrorStats {
    param($Errors)

    $stats = Get-BasicStats $Errors
    if ($Errors.Count -eq 0) {
        $rmse = $null
    }
    else {
        $sumSquares = 0.0
        foreach ($err in $Errors) { $sumSquares += $err * $err }
        $rmse = [Math]::Sqrt($sumSquares / $Errors.Count)
    }

    return [ordered]@{
        n       = $stats.count
        mean_px = $stats.mean
        rmse_px = $rmse
        p50_px  = $stats.p50
        p90_px  = $stats.p90
        p95_px  = $stats.p95
        p99_px  = $stats.p99
        max_px  = $stats.max
    }
}

function Read-TraceFromZip {
    param([string]$Path)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $zip = [IO.Compression.ZipFile]::OpenRead($resolved)
    try {
        $entry = $zip.GetEntry("trace.csv")
        if ($null -eq $entry) { throw "trace.csv was not found in $resolved" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try {
            $header = $reader.ReadLine()
            $expected = "sequence,stopwatchTicks,elapsedMicroseconds,x,y,event"
            if ($header -ne $expected) {
                throw "Unexpected trace.csv header: $header"
            }

            $sequence = [System.Collections.Generic.List[int]]::new()
            $ticks = [System.Collections.Generic.List[long]]::new()
            $elapsedUs = [System.Collections.Generic.List[long]]::new()
            $timesMs = [System.Collections.Generic.List[double]]::new()
            $xs = [System.Collections.Generic.List[double]]::new()
            $ys = [System.Collections.Generic.List[double]]::new()
            $events = [System.Collections.Generic.List[string]]::new()

            while ($true) {
                $line = $reader.ReadLine()
                if ($null -eq $line) { break }
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $parts = $line.Split(",")
                if ($parts.Length -ne 6) { throw "Unexpected CSV row: $line" }
                $elapsed = [long]$parts[2]
                $sequence.Add([int]$parts[0])
                $ticks.Add([long]$parts[1])
                $elapsedUs.Add($elapsed)
                $timesMs.Add($elapsed / 1000.0)
                $xs.Add([double]$parts[3])
                $ys.Add([double]$parts[4])
                $events.Add($parts[5])
            }

            if ($sequence.Count -lt 2) { throw "trace.csv needs at least two samples" }
            return [ordered]@{
                sequence  = [int[]]$sequence.ToArray()
                ticks     = [long[]]$ticks.ToArray()
                elapsedUs = [long[]]$elapsedUs.ToArray()
                timesMs   = [double[]]$timesMs.ToArray()
                x         = [double[]]$xs.ToArray()
                y         = [double[]]$ys.ToArray()
                event     = [string[]]$events.ToArray()
                zipPath   = $resolved
            }
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Get-Segments {
    param(
        [double[]]$TimesMs,
        [double]$GapThresholdMs
    )

    $n = $TimesMs.Length
    $segmentIds = [int[]]::new($n)
    $segmentStart = [int[]]::new($n)
    $currentSegment = 0
    $currentStart = 0
    for ($i = 1; $i -lt $n; $i++) {
        $gap = $TimesMs[$i] - $TimesMs[$i - 1]
        if (($gap -gt $GapThresholdMs) -or ($gap -le 0.0)) {
            $currentSegment++
            $currentStart = $i
        }
        $segmentIds[$i] = $currentSegment
        $segmentStart[$i] = $currentStart
    }
    return [ordered]@{
        segmentIds   = $segmentIds
        segmentStart = $segmentStart
    }
}

function Get-Audit {
    param(
        $Data,
        [double]$GapThresholdMs
    )

    $n = $Data.timesMs.Length
    $intervals = [System.Collections.Generic.List[double]]::new()
    $movement = [System.Collections.Generic.List[double]]::new()
    $idleGaps = [System.Collections.Generic.List[object]]::new()
    $eventCounts = [ordered]@{}
    $minX = [double]::PositiveInfinity
    $maxX = [double]::NegativeInfinity
    $minY = [double]::PositiveInfinity
    $maxY = [double]::NegativeInfinity

    for ($i = 0; $i -lt $n; $i++) {
        if (-not $eventCounts.Contains($Data.event[$i])) { $eventCounts[$Data.event[$i]] = 0 }
        $eventCounts[$Data.event[$i]]++
        $minX = [Math]::Min($minX, $Data.x[$i])
        $maxX = [Math]::Max($maxX, $Data.x[$i])
        $minY = [Math]::Min($minY, $Data.y[$i])
        $maxY = [Math]::Max($maxY, $Data.y[$i])

        if ($i -gt 0) {
            $gap = $Data.timesMs[$i] - $Data.timesMs[$i - 1]
            $intervals.Add($gap)
            $dx = $Data.x[$i] - $Data.x[$i - 1]
            $dy = $Data.y[$i] - $Data.y[$i - 1]
            $movement.Add([Math]::Sqrt($dx * $dx + $dy * $dy))
            if ($gap -gt $GapThresholdMs) {
                $idleGaps.Add([pscustomobject][ordered]@{
                    after_sequence  = $Data.sequence[$i - 1]
                    before_sequence = $Data.sequence[$i]
                    gap_ms          = $gap
                })
            }
        }
    }

    $segments = Get-Segments $Data.timesMs $GapThresholdMs
    $segmentLengths = [System.Collections.Generic.List[double]]::new()
    $currentSegment = $segments.segmentIds[0]
    $length = 0
    for ($i = 0; $i -lt $n; $i++) {
        if ($segments.segmentIds[$i] -ne $currentSegment) {
            $segmentLengths.Add([double]$length)
            $currentSegment = $segments.segmentIds[$i]
            $length = 0
        }
        $length++
    }
    $segmentLengths.Add([double]$length)

    $topGaps = @($idleGaps | Sort-Object -Property gap_ms -Descending | Select-Object -First 10)
    $eventObject = [ordered]@{}
    foreach ($key in @($eventCounts.Keys | Sort-Object)) { $eventObject[$key] = $eventCounts[$key] }

    $durationMs = $Data.timesMs[$n - 1] - $Data.timesMs[0]
    return [ordered]@{
        samples                       = $n
        first_sequence                = $Data.sequence[0]
        last_sequence                 = $Data.sequence[$n - 1]
        first_elapsed_ms              = $Data.timesMs[0]
        last_elapsed_ms               = $Data.timesMs[$n - 1]
        duration_ms                   = $durationMs
        duration_sec                  = $durationMs / 1000.0
        events                        = $eventObject
        x_range                       = [ordered]@{ min = $minX; max = $maxX; span = $maxX - $minX }
        y_range                       = [ordered]@{ min = $minY; max = $maxY; span = $maxY - $minY }
        interval_ms                   = Get-BasicStats $intervals
        movement_per_sample_px        = Get-BasicStats $movement
        idle_gap_threshold_ms         = $GapThresholdMs
        idle_gap_count                = $idleGaps.Count
        idle_gap_top10                = $topGaps
        segment_count_after_gap_split = $segmentLengths.Count
        segment_length_samples        = Get-BasicStats $segmentLengths
    }
}

function New-TargetsByHorizon {
    param(
        $Data,
        [int[]]$SegmentIds,
        [double]$GapThresholdMs,
        [object[]]$Horizons
    )

    $n = $Data.timesMs.Length
    $targets = @{}
    $lastTime = $Data.timesMs[$n - 1]

    foreach ($h in $Horizons) {
        $valid = [bool[]]::new($n)
        $tx = [double[]]::new($n)
        $ty = [double[]]::new($n)

        if ($h -eq 0) {
            for ($i = 0; $i -lt $n; $i++) {
                $valid[$i] = $true
                $tx[$i] = $Data.x[$i]
                $ty[$i] = $Data.y[$i]
            }
        }
        else {
            $j = 0
            for ($i = 0; $i -lt $n; $i++) {
                $targetTime = $Data.timesMs[$i] + [double]$h
                if ($targetTime -gt $lastTime) { continue }
                if ($j -lt $i) { $j = $i }
                while (($j + 1 -lt $n) -and ($Data.timesMs[$j + 1] -le $targetTime)) {
                    $j++
                }

                if ($j -eq ($n - 1)) {
                    if (($targetTime -eq $Data.timesMs[$n - 1]) -and ($SegmentIds[$j] -eq $SegmentIds[$i])) {
                        $valid[$i] = $true
                        $tx[$i] = $Data.x[$j]
                        $ty[$i] = $Data.y[$j]
                    }
                    continue
                }

                if (($SegmentIds[$j] -ne $SegmentIds[$i]) -or ($SegmentIds[$j + 1] -ne $SegmentIds[$i])) {
                    continue
                }
                $gap = $Data.timesMs[$j + 1] - $Data.timesMs[$j]
                if (($gap -gt $GapThresholdMs) -or ($gap -le 0.0)) { continue }
                $ratio = ($targetTime - $Data.timesMs[$j]) / $gap
                $valid[$i] = $true
                $tx[$i] = $Data.x[$j] + ($Data.x[$j + 1] - $Data.x[$j]) * $ratio
                $ty[$i] = $Data.y[$j] + ($Data.y[$j + 1] - $Data.y[$j]) * $ratio
            }
        }

        $targets[[string]$h] = [ordered]@{
            valid = $valid
            x     = $tx
            y     = $ty
        }
    }

    return $targets
}

function New-VelocityModel {
    param(
        [string]$Name,
        [string]$Family,
        $Parameter,
        [string]$Cost,
        [double[]]$Vx,
        [double[]]$Vy,
        [bool[]]$Valid
    )

    return [pscustomobject][ordered]@{
        name      = $Name
        family    = $Family
        parameter = $Parameter
        cost      = $Cost
        vx        = $Vx
        vy        = $Vy
        valid     = $Valid
    }
}

function New-VelocityModels {
    param(
        $Data,
        [int[]]$SegmentStart,
        [double]$GapThresholdMs,
        [object[]]$Windows,
        [object[]]$Alphas
    )

    $n = $Data.timesMs.Length
    $models = [System.Collections.Generic.List[object]]::new()

    $zeroVx = [double[]]::new($n)
    $zeroVy = [double[]]::new($n)
    $validAll = [bool[]]::new($n)
    for ($i = 0; $i -lt $n; $i++) { $validAll[$i] = $true }
    $models.Add((New-VelocityModel "hold-current" "hold" $null "O(1): current position only" $zeroVx $zeroVy $validAll))

    $last2Vx = [double[]]::new($n)
    $last2Vy = [double[]]::new($n)
    $last2Valid = [bool[]]::new($n)
    for ($i = 1; $i -lt $n; $i++) {
        if (($i - 1) -ge $SegmentStart[$i]) {
            $dt = $Data.timesMs[$i] - $Data.timesMs[$i - 1]
            if ($dt -gt 0.0) {
                $last2Vx[$i] = ($Data.x[$i] - $Data.x[$i - 1]) / $dt
                $last2Vy[$i] = ($Data.y[$i] - $Data.y[$i - 1]) / $dt
                $last2Valid[$i] = $true
            }
        }
    }
    $models.Add((New-VelocityModel "constant-velocity-last2" "last2" $null "O(1): one interval velocity" $last2Vx $last2Vy $last2Valid))

    foreach ($window in $Windows) {
        $w = [int]$window
        $vx = [double[]]::new($n)
        $vy = [double[]]::new($n)
        $valid = [bool[]]::new($n)
        for ($i = 0; $i -lt $n; $i++) {
            $start = $i - $w + 1
            if ($start -lt $SegmentStart[$i]) { continue }
            $sumT = 0.0
            $sumX = 0.0
            $sumY = 0.0
            for ($k = $start; $k -le $i; $k++) {
                $relativeT = $Data.timesMs[$k] - $Data.timesMs[$i]
                $sumT += $relativeT
                $sumX += $Data.x[$k]
                $sumY += $Data.y[$k]
            }
            $meanT = $sumT / $w
            $meanX = $sumX / $w
            $meanY = $sumY / $w
            $denom = 0.0
            $numX = 0.0
            $numY = 0.0
            for ($k = $start; $k -le $i; $k++) {
                $relativeT = $Data.timesMs[$k] - $Data.timesMs[$i]
                $centeredT = $relativeT - $meanT
                $denom += $centeredT * $centeredT
                $numX += $centeredT * ($Data.x[$k] - $meanX)
                $numY += $centeredT * ($Data.y[$k] - $meanY)
            }
            if ($denom -gt 0.0) {
                $vx[$i] = $numX / $denom
                $vy[$i] = $numY / $denom
                $valid[$i] = $true
            }
        }
        $models.Add((New-VelocityModel "linear-regression-velocity-N$w" "regression" $w "O($w): least-squares slope over last $w samples" $vx $vy $valid))
    }

    foreach ($alphaValue in $Alphas) {
        $alpha = [double]$alphaValue
        $vx = [double[]]::new($n)
        $vy = [double[]]::new($n)
        $valid = [bool[]]::new($n)
        $hasCurrent = $false
        $currentVx = 0.0
        $currentVy = 0.0
        for ($i = 1; $i -lt $n; $i++) {
            $dt = $Data.timesMs[$i] - $Data.timesMs[$i - 1]
            if (($dt -gt $GapThresholdMs) -or ($dt -le 0.0)) {
                $hasCurrent = $false
                continue
            }
            $instantVx = ($Data.x[$i] - $Data.x[$i - 1]) / $dt
            $instantVy = ($Data.y[$i] - $Data.y[$i - 1]) / $dt
            if (-not $hasCurrent) {
                $currentVx = $instantVx
                $currentVy = $instantVy
                $hasCurrent = $true
            }
            else {
                $currentVx = $alpha * $instantVx + (1.0 - $alpha) * $currentVx
                $currentVy = $alpha * $instantVy + (1.0 - $alpha) * $currentVy
            }
            $vx[$i] = $currentVx
            $vy[$i] = $currentVy
            $valid[$i] = $true
        }
        $alphaLabel = "{0:g}" -f $alpha
        $models.Add((New-VelocityModel "ema-velocity-alpha-$alphaLabel" "ema" $alpha "O(1): precomputed recursive EMA velocity" $vx $vy $valid))
    }

    return $models
}

function Add-ScoreRow {
    param(
        $Rows,
        $Model,
        [string]$CapLabel,
        [int]$HorizonMs,
        [string]$Split,
        $Errors
    )

    $stats = Get-ErrorStats $Errors
    $Rows.Add([pscustomobject][ordered]@{
        model               = $Model.name
        family              = $Model.family
        parameter           = $Model.parameter
        model_cost_estimate = $Model.cost
        cap_px              = $CapLabel
        horizon_ms          = $HorizonMs
        split               = $Split
        n                   = $stats.n
        mean_px             = $stats.mean_px
        rmse_px             = $stats.rmse_px
        p50_px              = $stats.p50_px
        p90_px              = $stats.p90_px
        p95_px              = $stats.p95_px
        p99_px              = $stats.p99_px
        max_px              = $stats.max_px
    }) | Out-Null
}

function Get-TopModels {
    param(
        $Rows,
        [string]$Split,
        [string]$CapPx = "",
        [int]$HorizonMs = -1,
        [int]$Limit = 20
    )

    $filtered = @(
        $Rows | Where-Object {
            $_.split -eq $Split -and
            $_.n -gt 0 -and
            (($CapPx -eq "") -or ($_.cap_px -eq $CapPx)) -and
            (($HorizonMs -lt 0) -or ($_.horizon_ms -eq $HorizonMs))
        } | Sort-Object -Property @{ Expression = "mean_px"; Ascending = $true }, @{ Expression = "p95_px"; Ascending = $true }, @{ Expression = "model"; Ascending = $true } |
            Select-Object -First $Limit
    )
    return $filtered
}

function Get-BestByHorizon {
    param(
        $Rows,
        [string]$Split,
        [string]$CapPx = ""
    )

    $best = [System.Collections.Generic.List[object]]::new()
    foreach ($h in $HorizonsMs) {
        $top = @(Get-TopModels $Rows $Split $CapPx ([int]$h) 1)
        if ($top.Count -gt 0) { $best.Add($top[0]) }
    }
    return $best
}

function Invoke-Evaluation {
    param(
        $Data,
        [double]$GapThresholdMs
    )

    $segments = Get-Segments $Data.timesMs $GapThresholdMs
    $targets = New-TargetsByHorizon $Data $segments.segmentIds $GapThresholdMs $HorizonsMs
    $models = New-VelocityModels $Data $segments.segmentStart $GapThresholdMs $RegressionWindows $EmaAlphas
    $n = $Data.timesMs.Length
    $testStartIndex = [int][Math]::Floor($n * 0.70)
    $rows = [System.Collections.Generic.List[object]]::new()
    $watch = [Diagnostics.Stopwatch]::StartNew()
    [long]$predictionCount = 0
    [long]$candidateCount = 0
    [long]$skippedNoTarget = 0
    [long]$skippedNoHistory = 0

    foreach ($model in $models) {
        foreach ($cap in $CapsPx) {
            if ($null -eq $cap) { $capLabel = "none" } else { $capLabel = ([int]$cap).ToString() }
            foreach ($hValue in $HorizonsMs) {
                $h = [int]$hValue
                $target = $targets[[string]$h]
                $errorsAll = [System.Collections.Generic.List[double]]::new()
                $errorsTrain = [System.Collections.Generic.List[double]]::new()
                $errorsTest = [System.Collections.Generic.List[double]]::new()

                for ($i = 0; $i -lt $n; $i++) {
                    $candidateCount++
                    if (-not $target.valid[$i]) {
                        $skippedNoTarget++
                        continue
                    }

                    if ($model.valid[$i]) {
                        $vx = $model.vx[$i]
                        $vy = $model.vy[$i]
                    }
                    elseif ($h -eq 0) {
                        $vx = 0.0
                        $vy = 0.0
                    }
                    else {
                        $skippedNoHistory++
                        continue
                    }

                    $predX = $Data.x[$i] + $vx * $h
                    $predY = $Data.y[$i] + $vy * $h
                    if ($null -ne $cap) {
                        $dxCap = $predX - $Data.x[$i]
                        $dyCap = $predY - $Data.y[$i]
                        $distance = [Math]::Sqrt($dxCap * $dxCap + $dyCap * $dyCap)
                        if (($distance -gt $cap) -and ($distance -gt 0.0)) {
                            $scale = $cap / $distance
                            $predX = $Data.x[$i] + $dxCap * $scale
                            $predY = $Data.y[$i] + $dyCap * $scale
                        }
                    }

                    $errX = $predX - $target.x[$i]
                    $errY = $predY - $target.y[$i]
                    $err = [Math]::Sqrt($errX * $errX + $errY * $errY)
                    $errorsAll.Add($err)
                    if ($i -ge $testStartIndex) {
                        $errorsTest.Add($err)
                    }
                    else {
                        $errorsTrain.Add($err)
                    }
                    $predictionCount++
                }

                Add-ScoreRow $rows $model $capLabel $h "all" $errorsAll
                Add-ScoreRow $rows $model $capLabel $h "train_first_70pct" $errorsTrain
                Add-ScoreRow $rows $model $capLabel $h "test_latter_30pct" $errorsTest
            }
        }
    }

    $watch.Stop()
    return [ordered]@{
        scores      = $rows
        performance = [ordered]@{
            evaluation_elapsed_sec          = $watch.Elapsed.TotalSeconds
            prediction_count                = $predictionCount
            predictions_per_sec             = if ($watch.Elapsed.TotalSeconds -gt 0.0) { $predictionCount / $watch.Elapsed.TotalSeconds } else { $null }
            candidate_count                 = $candidateCount
            skipped_no_target_or_crossed_gap = $skippedNoTarget
            skipped_no_history              = $skippedNoHistory
            test_start_index                = $testStartIndex
            test_start_sequence             = $Data.sequence[$testStartIndex]
            test_start_elapsed_ms           = $Data.timesMs[$testStartIndex]
        }
    }
}

$totalWatch = [Diagnostics.Stopwatch]::StartNew()
$data = Read-TraceFromZip $ZipPath
$audit = Get-Audit $data $IdleGapMs
$evaluation = Invoke-Evaluation $data $IdleGapMs
$totalWatch.Stop()

$scores = $evaluation.scores
$payload = [ordered]@{
    experiment = [ordered]@{
        name            = "step-1 data-audit-baselines"
        source_zip      = (Resolve-Path -LiteralPath $ZipPath).Path
        trace_entry     = "trace.csv"
        generated_by    = "run_baselines.ps1"
        idle_gap_policy = [ordered]@{
            threshold_ms = $IdleGapMs
            rule         = "Do not evaluate anchors whose t+horizon target requires interpolation across a sample gap above the threshold. Velocity histories reset at the same threshold."
        }
        horizons_ms  = $HorizonsMs
        caps_px      = @("none", 16, 32, 64)
        split_policy = [ordered]@{
            all                = "all valid anchors"
            train_first_70pct  = "first 70% of sample indices, metrics only; no fitted training needed for these online baselines"
            test_latter_30pct  = "last 30% of sample indices"
        }
    }
    data_audit = $audit
    scores     = $scores
    top_models = [ordered]@{
        all_overall_top20            = @(Get-TopModels $scores "all" "" -1 20)
        test_overall_top20           = @(Get-TopModels $scores "test_latter_30pct" "" -1 20)
        test_best_by_horizon_cap_none = @(Get-BestByHorizon $scores "test_latter_30pct" "none")
        test_best_by_horizon_any_cap  = @(Get-BestByHorizon $scores "test_latter_30pct" "")
    }
    performance = [ordered]@{
        evaluation_elapsed_sec          = $evaluation.performance.evaluation_elapsed_sec
        prediction_count                = $evaluation.performance.prediction_count
        predictions_per_sec             = $evaluation.performance.predictions_per_sec
        candidate_count                 = $evaluation.performance.candidate_count
        skipped_no_target_or_crossed_gap = $evaluation.performance.skipped_no_target_or_crossed_gap
        skipped_no_history              = $evaluation.performance.skipped_no_history
        test_start_index                = $evaluation.performance.test_start_index
        test_start_sequence             = $evaluation.performance.test_start_sequence
        test_start_elapsed_ms           = $evaluation.performance.test_start_elapsed_ms
        total_script_elapsed_sec        = $totalWatch.Elapsed.TotalSeconds
        note                            = "Timing is a single local run and includes PowerShell loop overhead, JSON preparation, and standard-library zip reading. Use as relative guidance only."
    }
    notes = @(
        "No external network or dependencies were used.",
        "trace.csv was streamed from the zip and was not extracted into poc.",
        "Models are online baselines; the train/test split reports holdout metrics rather than learned parameter fitting.",
        "Caps limit prediction displacement from the current cursor position, not the final error."
    )
}

$json = $payload | ConvertTo-Json -Depth 32
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $outputFullPath)) | Out-Null
$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($outputFullPath, $json + [Environment]::NewLine, $utf8NoBom)

$best = @($payload.top_models.test_overall_top20)[0]
Write-Host "wrote $outputFullPath"
Write-Host ("samples={0} duration_sec={1:n3}" -f $audit.samples, $audit.duration_sec)
Write-Host ("best_test={0} horizon={1}ms cap={2} mean={3:n4}px p95={4:n4}px n={5}" -f $best.model, $best.horizon_ms, $best.cap_px, $best.mean_px, $best.p95_px, $best.n)
Write-Host ("predictions={0} elapsed_sec={1:n3} predictions_per_sec={2:n0}" -f $evaluation.performance.prediction_count, $evaluation.performance.evaluation_elapsed_sec, $evaluation.performance.predictions_per_sec)
