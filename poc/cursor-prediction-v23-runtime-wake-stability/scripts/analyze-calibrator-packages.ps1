param(
    [string]$Root = "artifacts/calibrator-v23",
    [string]$Pattern = "calibration.zip",
    [string]$OutDir = "poc/cursor-prediction-v23-runtime-wake-stability/step-01-calibrator-grid",
    [bool]$Recurse = $true,
    [string]$ReportTitle = "Step 01 - Runtime Wake Stability Calibrator Results"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$Name
    )

    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry) {
        return $null
    }

    $stream = $entry.Open()
    try {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Percentile {
    param(
        [double[]]$Values,
        [double]$P
    )

    if ($null -eq $Values -or $Values.Count -eq 0) {
        return 0.0
    }

    $sorted = @($Values | Sort-Object)
    $index = [int][Math]::Ceiling($sorted.Count * [Math]::Max(0.0, [Math]::Min(1.0, $P))) - 1
    $index = [Math]::Max(0, [Math]::Min($sorted.Count - 1, $index))
    return [double]$sorted[$index]
}

function Stats {
    param([double[]]$Values)

    if ($null -eq $Values -or $Values.Count -eq 0) {
        return [ordered]@{
            count = 0
            avg = 0.0
            p50 = 0.0
            p95 = 0.0
            p99 = 0.0
            max = 0.0
        }
    }

    $sum = 0.0
    $max = [double]::MinValue
    foreach ($value in $Values) {
        $sum += $value
        if ($value -gt $max) {
            $max = $value
        }
    }

    return [ordered]@{
        count = $Values.Count
        avg = $sum / $Values.Count
        p50 = Percentile $Values 0.50
        p95 = Percentile $Values 0.95
        p99 = Percentile $Values 0.99
        max = $max
    }
}

function RowNumber {
    param(
        [object]$Row,
        [string]$Name,
        [double]$Default = 0.0
    )

    if ($null -eq $Row) {
        return $Default
    }

    $property = $Row.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $Default
    }

    $text = [string]$property.Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $Default
    }

    $value = 0.0
    if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
        return $value
    }

    return $Default
}

function RowText {
    param(
        [object]$Row,
        [string]$Name
    )

    $property = $Row.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return ""
    }

    return [string]$property.Value
}

function Group-Separations {
    param(
        [object[]]$Rows,
        [string]$Field
    )

    $groups = [ordered]@{}
    foreach ($row in $Rows) {
        $key = RowText $row $Field
        if ([string]::IsNullOrWhiteSpace($key)) {
            $key = "(missing)"
        }

        if (-not $groups.Contains($key)) {
            $groups[$key] = New-Object System.Collections.Generic.List[double]
        }

        $groups[$key].Add((RowNumber $row "estimatedSeparationPixels"))
    }

    $result = @()
    foreach ($key in $groups.Keys) {
        $values = [double[]]$groups[$key].ToArray()
        $stats = Stats $values
        $result += [ordered]@{
            name = $key
            count = $stats.count
            avg = $stats.avg
            p50 = $stats.p50
            p95 = $stats.p95
            p99 = $stats.p99
            max = $stats.max
            zeroRate = if ($stats.count -eq 0) { 0.0 } else { (@($values | Where-Object { $_ -eq 0 }).Count / [double]$stats.count) }
        }
    }

    return @($result | Sort-Object -Property @{Expression = "p95"; Descending = $true}, @{Expression = "max"; Descending = $true}, "name")
}

function Is-HoldRow {
    param([object]$Row)

    $pattern = (RowText $Row "patternName").ToLowerInvariant()
    $phase = (RowText $Row "phaseName").ToLowerInvariant()
    return $pattern.Contains("hold") -or $phase.Contains("hold") -or $phase.Contains("stationary")
}

function Package-VariantName {
    param([System.IO.FileInfo]$Package)

    if ($Package.BaseName -ieq "calibration" -and $null -ne $Package.Directory) {
        return $Package.Directory.Name
    }

    return $Package.BaseName
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
}

if ($Recurse) {
    $packages = @(Get-ChildItem -Path $Root -Filter $Pattern -File -Recurse | Sort-Object FullName)
}
else {
    $packages = @(Get-ChildItem -Path $Root -Filter $Pattern -File | Sort-Object LastWriteTime)
}
$packageResults = @()
$allRows = @()

foreach ($package in $packages) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($package.FullName)
    try {
        $metricsText = Read-ZipText $archive "metrics.json"
        $framesText = Read-ZipText $archive "frames.csv"
        if ($null -eq $metricsText -or $null -eq $framesText) {
            continue
        }

        $metrics = $metricsText | ConvertFrom-Json
        $frames = @($framesText | ConvertFrom-Csv)
        $variantName = Package-VariantName $package
        foreach ($frame in $frames) {
            Add-Member -InputObject $frame -NotePropertyName packageName -NotePropertyValue $package.Name -Force
            Add-Member -InputObject $frame -NotePropertyName packageKey -NotePropertyValue $package.FullName -Force
            Add-Member -InputObject $frame -NotePropertyName variantName -NotePropertyValue $variantName -Force
        }

        $allRows += $frames
        $separations = [double[]]@($frames | ForEach-Object { RowNumber $_ "estimatedSeparationPixels" })
        $elapsed = [double[]]@($frames | ForEach-Object { RowNumber $_ "elapsedMilliseconds" })
        $intervals = @()
        for ($i = 1; $i -lt $elapsed.Count; $i++) {
            $delta = $elapsed[$i] - $elapsed[$i - 1]
            if ($delta -gt 0) {
                $intervals += $delta
            }
        }

        $holdRows = @($frames | Where-Object { Is-HoldRow $_ })
        $holdSeparations = [double[]]@($holdRows | ForEach-Object { RowNumber $_ "estimatedSeparationPixels" })
        $over12 = @($frames | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -gt 12 })
        $motionContextRows = @($frames | Where-Object { -not [string]::IsNullOrWhiteSpace((RowText $_ "patternName")) })
        $usableForClosedLoop = $motionContextRows.Count -gt 0 -and $intervals.Count -gt 0
        $relativePath = Join-Path $variantName $package.Name

        $packageResults += [ordered]@{
            variantName = $variantName
            name = $package.Name
            relativePath = $relativePath
            lengthBytes = $package.Length
            lastWriteTime = $package.LastWriteTime.ToString("o")
            frameCount = $frames.Count
            darkFrameCount = [int]$metrics.DarkFrameCount
            averageEstimatedSeparationPixels = [double]$metrics.AverageEstimatedSeparationPixels
            p95EstimatedSeparationPixels = [double]$metrics.P95EstimatedSeparationPixels
            maximumEstimatedSeparationPixels = [double]$metrics.MaximumEstimatedSeparationPixels
            runtimeMode = [string]$metrics.RuntimeMode
            predictionModel = [int]$metrics.DwmPredictionModel
            targetOffsetMilliseconds = [int]$metrics.DwmPredictionTargetOffsetMilliseconds
            motionSourceName = [string]$metrics.MotionSourceName
            motionGenerationProfile = [string]$metrics.MotionGenerationProfile
            motionScenarioCount = [int]$metrics.MotionScenarioCount
            motionDurationMilliseconds = [double]$metrics.MotionDurationMilliseconds
            usableForClosedLoop = $usableForClosedLoop
            motionContextFrameCount = $motionContextRows.Count
            separation = Stats $separations
            captureIntervalMilliseconds = Stats ([double[]]$intervals)
            holdMeasurementFloor = Stats $holdSeparations
            over12FrameCount = $over12.Count
            zeroFrameCount = @($frames | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -eq 0 }).Count
            patternSummaries = Group-Separations $frames "patternName"
            phaseSummaries = Group-Separations $frames "phaseName"
            worstFrames = @($frames |
                Sort-Object -Property @{Expression = { RowNumber $_ "estimatedSeparationPixels" }; Descending = $true} |
                Select-Object -First 12 |
                ForEach-Object {
                    [ordered]@{
                        frameIndex = [int](RowNumber $_ "frameIndex")
                        elapsedMilliseconds = RowNumber $_ "elapsedMilliseconds"
                        separationPixels = RowNumber $_ "estimatedSeparationPixels"
                        patternName = RowText $_ "patternName"
                        phaseName = RowText $_ "phaseName"
                        scenarioIndex = [int](RowNumber $_ "scenarioIndex" -1)
                        expectedX = [int](RowNumber $_ "expectedX")
                        expectedY = [int](RowNumber $_ "expectedY")
                        expectedVelocityPixelsPerSecond = RowNumber $_ "expectedVelocityPixelsPerSecond"
                    }
                })
        }
    }
    finally {
        $archive.Dispose()
    }
}

$allSeparations = [double[]]@($allRows | ForEach-Object { RowNumber $_ "estimatedSeparationPixels" })
$primaryRows = @($allRows | Where-Object { -not [string]::IsNullOrWhiteSpace((RowText $_ "patternName")) })
$primarySeparations = [double[]]@($primaryRows | ForEach-Object { RowNumber $_ "estimatedSeparationPixels" })
$allHoldRows = @($allRows | Where-Object { Is-HoldRow $_ })
$primaryHoldRows = @($primaryRows | Where-Object { Is-HoldRow $_ })
$allHoldSeparations = [double[]]@($allHoldRows | ForEach-Object { RowNumber $_ "estimatedSeparationPixels" })
$primaryHoldSeparations = [double[]]@($primaryHoldRows | ForEach-Object { RowNumber $_ "estimatedSeparationPixels" })
$allIntervals = @()
$rowsByPackage = @($allRows | Group-Object packageKey)
foreach ($group in $rowsByPackage) {
    $rows = @($group.Group | Sort-Object { RowNumber $_ "elapsedMilliseconds" })
    for ($i = 1; $i -lt $rows.Count; $i++) {
        $delta = (RowNumber $rows[$i] "elapsedMilliseconds") - (RowNumber $rows[$i - 1] "elapsedMilliseconds")
        if ($delta -gt 0) {
            $allIntervals += $delta
        }
    }
}

$scores = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    packageCount = $packageResults.Count
    closedLoopUsablePackageCount = @($packageResults | Where-Object { $_.usableForClosedLoop }).Count
    totalFrameCount = $allRows.Count
    overallSeparation = Stats $allSeparations
    primaryFrameCount = $primaryRows.Count
    primarySeparation = Stats $primarySeparations
    overallCaptureIntervalMilliseconds = Stats ([double[]]$allIntervals)
    holdMeasurementFloor = Stats $allHoldSeparations
    primaryHoldMeasurementFloor = Stats $primaryHoldSeparations
    zeroFrameCount = @($allRows | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -eq 0 }).Count
    over12FrameCount = @($allRows | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -gt 12 }).Count
    over20FrameCount = @($allRows | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -gt 20 }).Count
    primaryOver12FrameCount = @($primaryRows | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -gt 12 }).Count
    primaryOver20FrameCount = @($primaryRows | Where-Object { (RowNumber $_ "estimatedSeparationPixels") -gt 20 }).Count
    patternSummaries = Group-Separations $primaryRows "patternName"
    phaseSummaries = Group-Separations $primaryRows "phaseName"
    variantSummaries = Group-Separations $primaryRows "variantName"
    packages = $packageResults
}

$scoresPath = Join-Path $OutDir "scores.json"
$scores | ConvertTo-Json -Depth 20 | Set-Content -Path $scoresPath -Encoding UTF8

$report = New-Object System.Collections.Generic.List[string]
$report.Add("# " + $ReportTitle)
$report.Add("")
$report.Add("Input packages: " + $packageResults.Count + ". Closed-loop usable packages: " + $scores.closedLoopUsablePackageCount + ".")
$report.Add("")
$report.Add("## Overall")
$report.Add("")
$report.Add("- Frames with motion context: " + $scores.primaryFrameCount + " / " + $scores.totalFrameCount)
$report.Add("- Primary separation avg/p95/p99/max: " + [Math]::Round($scores.primarySeparation.avg, 3) + " / " + $scores.primarySeparation.p95 + " / " + $scores.primarySeparation.p99 + " / " + $scores.primarySeparation.max + " px")
$report.Add("- All-package separation avg/p95/p99/max: " + [Math]::Round($scores.overallSeparation.avg, 3) + " / " + $scores.overallSeparation.p95 + " / " + $scores.overallSeparation.p99 + " / " + $scores.overallSeparation.max + " px")
$report.Add("- Capture interval avg/p50/p95/max: " + [Math]::Round($scores.overallCaptureIntervalMilliseconds.avg, 3) + " / " + $scores.overallCaptureIntervalMilliseconds.p50 + " / " + $scores.overallCaptureIntervalMilliseconds.p95 + " / " + $scores.overallCaptureIntervalMilliseconds.max + " ms")
$report.Add("- Primary hold/stationary measurement floor p50/p95/max: " + $scores.primaryHoldMeasurementFloor.p50 + " / " + $scores.primaryHoldMeasurementFloor.p95 + " / " + $scores.primaryHoldMeasurementFloor.max + " px")
$report.Add("- Zero frames: " + $scores.zeroFrameCount)
$report.Add("- Primary frames >12px: " + $scores.primaryOver12FrameCount)
$report.Add("- Primary frames >20px: " + $scores.primaryOver20FrameCount)
$report.Add("")
$report.Add("## Interpretation")
$report.Add("")
if ($scores.primaryHoldMeasurementFloor.p50 -gt 0 -or $scores.primaryHoldMeasurementFloor.p95 -gt 0) {
    $report.Add("- Stationary/hold rows have a nonzero measured separation floor. Treat small nonzero values as visual-estimator artifacts until the Calibrator detector is improved.")
}
if ($scores.overallCaptureIntervalMilliseconds.p50 -gt 20) {
    $report.Add("- The capture cadence is below 60 Hz for these packages. Use this audit for gross tail detection, not for proving small 1-4 ms improvements.")
}
if ($scores.primaryOver20FrameCount -gt 0) {
    $report.Add("- There are >20px tail frames. These are the first closed-loop targets because they are above the likely measurement floor.")
}
$legacyPackages = @($scores.packages | Where-Object { -not $_.usableForClosedLoop })
if ($legacyPackages.Count -gt 0) {
    $report.Add("- Some legacy packages lack motion context or cadence data. They remain in the archive inventory but are excluded from primary closed-loop scoring.")
}
$report.Add("")
$report.Add("## Worst Pattern Groups")
$report.Add("")
$report.Add("| pattern | count | avg | p95 | p99 | max | zeroRate |")
$report.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($group in @($scores.patternSummaries | Select-Object -First 12)) {
    $report.Add("| $($group.name) | $($group.count) | $([Math]::Round($group.avg, 3)) | $($group.p95) | $($group.p99) | $($group.max) | $([Math]::Round($group.zeroRate, 3)) |")
}
$report.Add("")
$report.Add("## Variant Groups")
$report.Add("")
$report.Add("| variant | count | avg | p50 | p95 | p99 | max | zeroRate |")
$report.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($group in @($scores.variantSummaries | Select-Object -First 30)) {
    $report.Add("| $($group.name) | $($group.count) | $([Math]::Round($group.avg, 3)) | $($group.p50) | $($group.p95) | $($group.p99) | $($group.max) | $([Math]::Round($group.zeroRate, 3)) |")
}
$report.Add("")
$report.Add("## Packages")
$report.Add("")
$report.Add("| variant | package | usable | frames | motion frames | avg | p95 | max | interval p50 | interval p95 | hold p95 | >12px |")
$report.Add("| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($pkg in $scores.packages) {
    $report.Add("| $($pkg.variantName) | $($pkg.relativePath) | $($pkg.usableForClosedLoop) | $($pkg.frameCount) | $($pkg.motionContextFrameCount) | $([Math]::Round($pkg.separation.avg, 3)) | $($pkg.separation.p95) | $($pkg.separation.max) | $($pkg.captureIntervalMilliseconds.p50) | $($pkg.captureIntervalMilliseconds.p95) | $($pkg.holdMeasurementFloor.p95) | $($pkg.over12FrameCount) |")
}
$report.Add("")
$report.Add("## Next Loop")
$report.Add("")
$report.Add("Run MotionLab-backed Calibrator captures for each candidate model/offset pair, always saving product runtime telemetry alongside visual metrics. Do not compare variants on packages whose capture cadence is too coarse unless the effect size is larger than the stationary measurement floor.")

$reportPath = Join-Path $OutDir "report.md"
$report | Set-Content -Path $reportPath -Encoding UTF8

$notes = @(
    "# Notes",
    "",
    "- This audit consumes Calibrator packages generated from the v22 MotionLab-backed verification package.",
    "- The visual metric is a regression guard because capture cadence and the stationary dark-pixel floor hide small timing differences.",
    "- Product runtime telemetry is the primary scheduler signal for this POC."
)
$notes | Set-Content -Path (Join-Path $OutDir "notes.md") -Encoding UTF8

Write-Host "Wrote:"
Write-Host "  $scoresPath"
Write-Host "  $reportPath"
