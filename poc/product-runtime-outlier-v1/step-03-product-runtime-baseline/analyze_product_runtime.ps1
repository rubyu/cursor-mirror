param(
    [string]$PackagePath = ".\product-runtime-outlier-debug.zip",
    [string]$MetricsPath = ".\metrics.json"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Parse-Double([string]$Value) {
    $result = 0.0
    if ([double]::TryParse($Value, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$result)) {
        return $result
    }

    return $null
}

function Stats([double[]]$Values) {
    if ($Values.Count -eq 0) {
        return [ordered]@{ count = 0; p50 = $null; p95 = $null; p99 = $null; max = $null; min = $null }
    }

    $sorted = @($Values | Sort-Object)
    return [ordered]@{
        count = $sorted.Count
        min = $sorted[0]
        p50 = $sorted[[int][Math]::Floor(($sorted.Count - 1) * 0.50)]
        p95 = $sorted[[int][Math]::Floor(($sorted.Count - 1) * 0.95)]
        p99 = $sorted[[int][Math]::Floor(($sorted.Count - 1) * 0.99)]
        max = $sorted[$sorted.Count - 1]
    }
}

function TicksToUs([double]$Ticks, [double]$Frequency) {
    return $Ticks * 1000000.0 / $Frequency
}

$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $PackagePath))
try {
    $metadataEntry = $archive.GetEntry("metadata.json")
    $metadataReader = [System.IO.StreamReader]::new($metadataEntry.Open())
    try {
        $metadata = $metadataReader.ReadToEnd() | ConvertFrom-Json
    } finally {
        $metadataReader.Dispose()
    }

    $frequency = [double]$metadata.stopwatchFrequency
    $eventsEntry = $archive.GetEntry("product-runtime-outlier-events.csv")
    $reader = [System.IO.StreamReader]::new($eventsEntry.Open())
    try {
        $header = $reader.ReadLine().Split([char]',')
        $index = @{}
        for ($i = 0; $i -lt $header.Length; $i++) {
            $index[$header[$i]] = $i
        }

        $schedulerWakeLate = New-Object System.Collections.Generic.List[double]
        $schedulerVBlankLead = New-Object System.Collections.Generic.List[double]
        $schedulerTick = New-Object System.Collections.Generic.List[double]
        $schedulerWait = New-Object System.Collections.Generic.List[double]
        $schedulerMessages = New-Object System.Collections.Generic.List[double]
        $controllerTick = New-Object System.Collections.Generic.List[double]
        $controllerPredict = New-Object System.Collections.Generic.List[double]
        $controllerMove = New-Object System.Collections.Generic.List[double]
        $controllerOpacity = New-Object System.Collections.Generic.List[double]
        $overlayUpdateLayer = New-Object System.Collections.Generic.List[double]
        $overlayGetHbitmap = New-Object System.Collections.Generic.List[double]
        $overlayUpdateLayeredWindow = New-Object System.Collections.Generic.List[double]
        $overlayMove = New-Object System.Collections.Generic.List[double]

        $counts = @{
            scheduler = 0
            controller = 0
            overlay = 0
            updateLayerFailures = 0
        }

        while (($line = $reader.ReadLine()) -ne $null) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

            $parts = $line.Split([char]',')
            $kind = [int](Parse-Double $parts[$index["eventKind"]])
            if ($kind -eq 1) {
                $counts.scheduler++
                $wakeLate = Parse-Double $parts[$index["wakeLateMicroseconds"]]
                $lead = Parse-Double $parts[$index["vBlankLeadMicroseconds"]]
                $tickTicks = Parse-Double $parts[$index["tickDurationTicks"]]
                $waitTicks = Parse-Double $parts[$index["waitDurationTicks"]]
                $messageCount = Parse-Double $parts[$index["processedMessageCountBeforeTick"]]
                if ($null -ne $wakeLate) { $schedulerWakeLate.Add($wakeLate) }
                if ($null -ne $lead) { $schedulerVBlankLead.Add($lead) }
                if ($null -ne $tickTicks) { $schedulerTick.Add((TicksToUs $tickTicks $frequency)) }
                if ($null -ne $waitTicks) { $schedulerWait.Add((TicksToUs $waitTicks $frequency)) }
                if ($null -ne $messageCount) { $schedulerMessages.Add($messageCount) }
            } elseif ($kind -eq 2) {
                $counts.controller++
                $tickTicks = Parse-Double $parts[$index["tickTotalDurationTicks"]]
                $predictTicks = Parse-Double $parts[$index["predictDurationTicks"]]
                $moveTicks = Parse-Double $parts[$index["moveOverlayDurationTicks"]]
                $opacityTicks = Parse-Double $parts[$index["applyOpacityDurationTicks"]]
                if ($null -ne $tickTicks) { $controllerTick.Add((TicksToUs $tickTicks $frequency)) }
                if ($null -ne $predictTicks) { $controllerPredict.Add((TicksToUs $predictTicks $frequency)) }
                if ($null -ne $moveTicks) { $controllerMove.Add((TicksToUs $moveTicks $frequency)) }
                if ($null -ne $opacityTicks) { $controllerOpacity.Add((TicksToUs $opacityTicks $frequency)) }
            } elseif ($kind -eq 3) {
                $counts.overlay++
                $operation = [int](Parse-Double $parts[$index["overlayOperation"]])
                $totalTicks = Parse-Double $parts[$index["totalTicks"]]
                if ($operation -eq 4) {
                    if ($null -ne $totalTicks) { $overlayUpdateLayer.Add((TicksToUs $totalTicks $frequency)) }
                    $getHbitmapTicks = Parse-Double $parts[$index["getHbitmapTicks"]]
                    $updateLayeredWindowTicks = Parse-Double $parts[$index["updateLayeredWindowTicks"]]
                    if ($null -ne $getHbitmapTicks) { $overlayGetHbitmap.Add((TicksToUs $getHbitmapTicks $frequency)) }
                    if ($null -ne $updateLayeredWindowTicks) { $overlayUpdateLayeredWindow.Add((TicksToUs $updateLayeredWindowTicks $frequency)) }
                    if ([int](Parse-Double $parts[$index["succeeded"]]) -eq 0) { $counts.updateLayerFailures++ }
                } elseif ($operation -eq 2) {
                    if ($null -ne $totalTicks) { $overlayMove.Add((TicksToUs $totalTicks $frequency)) }
                }
            }
        }

        $metrics = [ordered]@{
            package = (Split-Path -Leaf $PackagePath)
            metadata = $metadata
            counts = $counts
            scheduler = [ordered]@{
                wakeLateUs = Stats $schedulerWakeLate.ToArray()
                vBlankLeadUs = Stats $schedulerVBlankLead.ToArray()
                tickDurationUs = Stats $schedulerTick.ToArray()
                waitDurationUs = Stats $schedulerWait.ToArray()
                processedMessagesBeforeTick = Stats $schedulerMessages.ToArray()
            }
            controller = [ordered]@{
                tickTotalUs = Stats $controllerTick.ToArray()
                predictUs = Stats $controllerPredict.ToArray()
                moveOverlayUs = Stats $controllerMove.ToArray()
                applyOpacityUs = Stats $controllerOpacity.ToArray()
            }
            overlay = [ordered]@{
                moveUs = Stats $overlayMove.ToArray()
                updateLayerUs = Stats $overlayUpdateLayer.ToArray()
                getHbitmapUs = Stats $overlayGetHbitmap.ToArray()
                updateLayeredWindowUs = Stats $overlayUpdateLayeredWindow.ToArray()
            }
        }

        $metrics | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $MetricsPath -Encoding UTF8
        $metrics | ConvertTo-Json -Depth 8
    } finally {
        $reader.Dispose()
    }
} finally {
    $archive.Dispose()
}
