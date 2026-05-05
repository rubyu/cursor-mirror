param(
    [string]$Root = "artifacts/calibrator-v22",
    [string]$Pattern = "product-runtime.zip",
    [string]$OutDir = "poc/cursor-prediction-v22-calibrator-closed-loop/step-03-calibrator-results"
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
        return [ordered]@{ count = 0; avg = 0.0; p50 = 0.0; p95 = 0.0; p99 = 0.0; max = 0.0 }
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
        [string]$Name
    )

    $property = $Row.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return 0.0
    }

    $value = 0.0
    if ([double]::TryParse([string]$property.Value, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
        return $value
    }

    return 0.0
}

function TicksToMicroseconds {
    param([double]$Ticks)

    return ($Ticks * 1000000.0) / [System.Diagnostics.Stopwatch]::Frequency
}

function Select-Rows {
    param(
        [object[]]$Rows,
        [int]$EventKind,
        [int]$OverlayOperation = -1
    )

    return @($Rows | Where-Object {
        [int](RowNumber $_ "eventKind") -eq $EventKind -and
        ($OverlayOperation -lt 0 -or [int](RowNumber $_ "overlayOperation") -eq $OverlayOperation)
    })
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
}

$packages = @(Get-ChildItem -Path $Root -Filter $Pattern -File -Recurse | Sort-Object FullName)
$results = @()

foreach ($package in $packages) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($package.FullName)
    try {
        $text = Read-ZipText $archive "product-runtime-outlier-events.csv"
        if ($null -eq $text) {
            continue
        }

        $rows = @($text | ConvertFrom-Csv)
        $variantName = $package.Directory.Name
        $schedulerRows = Select-Rows $rows 1
        $controllerRows = Select-Rows $rows 2
        $moveRows = Select-Rows $rows 3 2
        $updateRows = Select-Rows $rows 3 4

        $results += [ordered]@{
            variantName = $variantName
            eventCount = $rows.Count
            schedulerCount = $schedulerRows.Count
            controllerCount = $controllerRows.Count
            overlayMoveCount = $moveRows.Count
            overlayUpdateLayerCount = $updateRows.Count
            wakeLateMicroseconds = Stats ([double[]]@($schedulerRows | ForEach-Object { RowNumber $_ "wakeLateMicroseconds" }))
            controllerTickTotalMicroseconds = Stats ([double[]]@($controllerRows | ForEach-Object { TicksToMicroseconds (RowNumber $_ "tickTotalDurationTicks") }))
            controllerPredictMicroseconds = Stats ([double[]]@($controllerRows | ForEach-Object { TicksToMicroseconds (RowNumber $_ "predictDurationTicks") }))
            controllerMoveOverlayMicroseconds = Stats ([double[]]@($controllerRows | ForEach-Object { TicksToMicroseconds (RowNumber $_ "moveOverlayDurationTicks") }))
            overlayUpdateLayerMicroseconds = Stats ([double[]]@($updateRows | ForEach-Object { TicksToMicroseconds (RowNumber $_ "updateLayeredWindowTicks") }))
            overlayTotalMicroseconds = Stats ([double[]]@($updateRows | ForEach-Object { TicksToMicroseconds (RowNumber $_ "totalTicks") }))
            latestMouseMoveAgeMicroseconds = Stats ([double[]]@($moveRows | ForEach-Object { RowNumber $_ "latestMouseMoveAgeMicroseconds" }))
            overlayMoveSkippedCount = @($moveRows | Where-Object { [int](RowNumber $_ "overlayMoveSkipped") -ne 0 }).Count
        }
    }
    finally {
        $archive.Dispose()
    }
}

$scores = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    packageCount = $results.Count
    packages = $results
}

$scoresPath = Join-Path $OutDir "product-runtime-scores.json"
$scores | ConvertTo-Json -Depth 12 | Set-Content -Path $scoresPath -Encoding UTF8

$report = New-Object System.Collections.Generic.List[string]
$report.Add("# Product Runtime Telemetry Summary")
$report.Add("")
$report.Add("Input packages: " + $results.Count + ".")
$report.Add("")
$report.Add("| variant | controller | updateLayer | tick p95 us | predict p95 us | move p95 us | ULW p95 us | ULW max us | wake-late p95 us | latest move age p95 us | skipped moves |")
$report.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($item in $results) {
    $report.Add("| $($item.variantName) | $($item.controllerCount) | $($item.overlayUpdateLayerCount) | $([Math]::Round($item.controllerTickTotalMicroseconds.p95, 3)) | $([Math]::Round($item.controllerPredictMicroseconds.p95, 3)) | $([Math]::Round($item.controllerMoveOverlayMicroseconds.p95, 3)) | $([Math]::Round($item.overlayUpdateLayerMicroseconds.p95, 3)) | $([Math]::Round($item.overlayUpdateLayerMicroseconds.max, 3)) | $([Math]::Round($item.wakeLateMicroseconds.p95, 3)) | $([Math]::Round($item.latestMouseMoveAgeMicroseconds.p95, 3)) | $($item.overlayMoveSkippedCount) |")
}

$reportPath = Join-Path $OutDir "product-runtime-report.md"
$report | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "Wrote:"
Write-Host "  $scoresPath"
Write-Host "  $reportPath"
