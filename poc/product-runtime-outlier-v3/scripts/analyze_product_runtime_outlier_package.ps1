param(
    [Parameter(Mandatory = $true)]
    [string[]]$PackagePath,

    [string]$MetricsPath = ".\metrics.json",
    [string]$ReportPath = ".\report.md"
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

function New-DoubleList {
    return New-Object "System.Collections.Generic.List[double]"
}

function Add-Value($List, $Value) {
    if ($null -ne $Value) {
        $List.Add([double]$Value)
    }
}

function Stats([double[]]$Values) {
    if ($Values.Count -eq 0) {
        return [ordered]@{ count = 0; min = $null; p50 = $null; p95 = $null; p99 = $null; max = $null }
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

function Ticks-To-Us([double]$Ticks, [double]$Frequency) {
    if ($Frequency -le 0) {
        return $null
    }

    return $Ticks * 1000000.0 / $Frequency
}

function Has-Column($Index, [string]$Name) {
    return $Index.ContainsKey($Name)
}

function Get-Raw($Parts, $Index, [string]$Name) {
    if (-not (Has-Column $Index $Name)) {
        return $null
    }

    $column = $Index[$Name]
    if ($column -ge $Parts.Length) {
        return $null
    }

    return $Parts[$column]
}

function Get-Number($Parts, $Index, [string]$Name) {
    $raw = Get-Raw $Parts $Index $Name
    if ($null -eq $raw -or [string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    return Parse-Double $raw
}

function Get-Ticks-Us($Parts, $Index, [string]$Name, [double]$Frequency) {
    $ticks = Get-Number $Parts $Index $Name
    if ($null -eq $ticks) {
        return $null
    }

    return Ticks-To-Us $ticks $Frequency
}

function Increment-Count($Table, [string]$Name) {
    if (-not $Table.Contains($Name)) {
        $Table[$Name] = 0
    }

    $Table[$Name] = [int]$Table[$Name] + 1
}

function Format-Stat($Metric, [string]$Field) {
    if ($null -eq $Metric -or $null -eq $Metric[$Field]) {
        return ""
    }

    return ([double]$Metric[$Field]).ToString("0.0", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Analyze-Package([string]$Path) {
    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)
    try {
        $metadata = $null
        $metadataEntry = $archive.GetEntry("metadata.json")
        if ($null -ne $metadataEntry) {
            $metadataReader = [System.IO.StreamReader]::new($metadataEntry.Open())
            try {
                $metadata = $metadataReader.ReadToEnd() | ConvertFrom-Json
            } finally {
                $metadataReader.Dispose()
            }
        }

        $eventsEntry = $archive.GetEntry("product-runtime-outlier-events.csv")
        if ($null -eq $eventsEntry) {
            throw "Package '$Path' does not contain product-runtime-outlier-events.csv."
        }

        $frequency = if ($null -ne $metadata -and $null -ne $metadata.stopwatchFrequency) { [double]$metadata.stopwatchFrequency } else { [double][System.Diagnostics.Stopwatch]::Frequency }

        $lists = @{
            schedulerWakeLateUs = (New-DoubleList)
            schedulerVBlankLeadUs = (New-DoubleList)
            schedulerDwmReadUs = (New-DoubleList)
            schedulerDecisionUs = (New-DoubleList)
            schedulerWaitUs = (New-DoubleList)
            schedulerTickUs = (New-DoubleList)
            schedulerLoopTotalUs = (New-DoubleList)
            schedulerProcessedMessages = (New-DoubleList)
            schedulerProcessedMessageDurationUs = (New-DoubleList)
            schedulerMaxMessageDispatchUs = (New-DoubleList)
            schedulerMessageWakeCount = (New-DoubleList)
            schedulerFineSleepZeroCount = (New-DoubleList)
            schedulerFineSpinCount = (New-DoubleList)
            controllerPollUs = (New-DoubleList)
            controllerSelectTargetUs = (New-DoubleList)
            controllerPredictUs = (New-DoubleList)
            controllerMoveOverlayUs = (New-DoubleList)
            controllerApplyOpacityUs = (New-DoubleList)
            controllerTickTotalUs = (New-DoubleList)
            controllerVBlankLeadUs = (New-DoubleList)
            controllerPollSampleAvailable = (New-DoubleList)
            controllerStalePollSample = (New-DoubleList)
            controllerPredictionEnabled = (New-DoubleList)
            controllerGen0Delta = (New-DoubleList)
            controllerGen1Delta = (New-DoubleList)
            controllerGen2Delta = (New-DoubleList)
            overlayMoveUs = (New-DoubleList)
            overlaySetOpacityUs = (New-DoubleList)
            overlayShowCursorUs = (New-DoubleList)
            overlayUpdateLayerUs = (New-DoubleList)
            overlayGetDcUs = (New-DoubleList)
            overlayCreateCompatibleDcUs = (New-DoubleList)
            overlayGetHbitmapUs = (New-DoubleList)
            overlaySelectObjectUs = (New-DoubleList)
            overlayUpdateLayeredWindowUs = (New-DoubleList)
            overlayCleanupUs = (New-DoubleList)
            overlayAlpha = (New-DoubleList)
        }

        $coalescingLists = @{}
        $counts = [ordered]@{
            scheduler = 0
            controller = 0
            overlay = 0
            unknown = 0
            updateLayerFailures = 0
        }
        $overlayOperations = [ordered]@{}
        $waitReturnReasons = [ordered]@{}
        $coalescingColumns = @()

        $reader = [System.IO.StreamReader]::new($eventsEntry.Open())
        try {
            $headerLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($headerLine)) {
                throw "Package '$Path' has an empty product-runtime-outlier-events.csv header."
            }

            $header = $headerLine.Split([char]',')
            $index = @{}
            for ($i = 0; $i -lt $header.Length; $i++) {
                $index[$header[$i]] = $i
                if ($header[$i] -match "(?i)(coalesc|mouseMove|overlayMoveSkipped)") {
                    $coalescingColumns += $header[$i]
                    $coalescingLists[$header[$i]] = (New-DoubleList)
                }
            }

            while (($line = $reader.ReadLine()) -ne $null) {
                if ([string]::IsNullOrWhiteSpace($line)) {
                    continue
                }

                $parts = $line.Split([char]',')
                foreach ($column in $coalescingColumns) {
                    Add-Value $coalescingLists[$column] (Get-Number $parts $index $column)
                }

                $kind = Get-Number $parts $index "eventKind"
                if ($null -eq $kind) {
                    $counts["unknown"] = [int]$counts["unknown"] + 1
                    continue
                }

                if ([int]$kind -eq 1) {
                    $counts["scheduler"] = [int]$counts["scheduler"] + 1
                    Add-Value $lists['schedulerWakeLateUs'] (Get-Number $parts $index "wakeLateMicroseconds")
                    Add-Value $lists['schedulerVBlankLeadUs'] (Get-Number $parts $index "vBlankLeadMicroseconds")
                    Add-Value $lists['schedulerDwmReadUs'] (Get-Ticks-Us $parts $index "dwmReadDurationTicks" $frequency)
                    Add-Value $lists['schedulerDecisionUs'] (Get-Ticks-Us $parts $index "decisionDurationTicks" $frequency)
                    Add-Value $lists['schedulerWaitUs'] (Get-Ticks-Us $parts $index "waitDurationTicks" $frequency)
                    Add-Value $lists['schedulerTickUs'] (Get-Ticks-Us $parts $index "tickDurationTicks" $frequency)
                    Add-Value $lists['schedulerLoopTotalUs'] (Get-Ticks-Us $parts $index "totalTicks" $frequency)
                    Add-Value $lists['schedulerProcessedMessages'] (Get-Number $parts $index "processedMessageCountBeforeTick")
                    Add-Value $lists['schedulerProcessedMessageDurationUs'] (Get-Ticks-Us $parts $index "processedMessageDurationTicksBeforeTick" $frequency)
                    Add-Value $lists['schedulerMaxMessageDispatchUs'] (Get-Ticks-Us $parts $index "maxMessageDispatchTicksBeforeTick" $frequency)
                    Add-Value $lists['schedulerMessageWakeCount'] (Get-Number $parts $index "messageWakeCount")
                    Add-Value $lists['schedulerFineSleepZeroCount'] (Get-Number $parts $index "fineSleepZeroCount")
                    Add-Value $lists['schedulerFineSpinCount'] (Get-Number $parts $index "fineSpinCount")
                    $reason = Get-Number $parts $index "waitReturnReason"
                    if ($null -ne $reason) {
                        Increment-Count $waitReturnReasons ([int]$reason).ToString([System.Globalization.CultureInfo]::InvariantCulture)
                    }
                } elseif ([int]$kind -eq 2) {
                    $counts["controller"] = [int]$counts["controller"] + 1
                    Add-Value $lists['controllerPollUs'] (Get-Ticks-Us $parts $index "pollDurationTicks" $frequency)
                    Add-Value $lists['controllerSelectTargetUs'] (Get-Ticks-Us $parts $index "selectTargetDurationTicks" $frequency)
                    Add-Value $lists['controllerPredictUs'] (Get-Ticks-Us $parts $index "predictDurationTicks" $frequency)
                    Add-Value $lists['controllerMoveOverlayUs'] (Get-Ticks-Us $parts $index "moveOverlayDurationTicks" $frequency)
                    Add-Value $lists['controllerApplyOpacityUs'] (Get-Ticks-Us $parts $index "applyOpacityDurationTicks" $frequency)
                    Add-Value $lists['controllerTickTotalUs'] (Get-Ticks-Us $parts $index "tickTotalDurationTicks" $frequency)
                    Add-Value $lists['controllerVBlankLeadUs'] (Get-Number $parts $index "vBlankLeadMicroseconds")
                    Add-Value $lists['controllerPollSampleAvailable'] (Get-Number $parts $index "pollSampleAvailable")
                    Add-Value $lists['controllerStalePollSample'] (Get-Number $parts $index "stalePollSample")
                    Add-Value $lists['controllerPredictionEnabled'] (Get-Number $parts $index "predictionEnabled")
                    $gen0Before = Get-Number $parts $index "gen0Before"
                    $gen0After = Get-Number $parts $index "gen0After"
                    $gen1Before = Get-Number $parts $index "gen1Before"
                    $gen1After = Get-Number $parts $index "gen1After"
                    $gen2Before = Get-Number $parts $index "gen2Before"
                    $gen2After = Get-Number $parts $index "gen2After"
                    if ($null -ne $gen0Before -and $null -ne $gen0After) { Add-Value $lists['controllerGen0Delta'] ($gen0After - $gen0Before) }
                    if ($null -ne $gen1Before -and $null -ne $gen1After) { Add-Value $lists['controllerGen1Delta'] ($gen1After - $gen1Before) }
                    if ($null -ne $gen2Before -and $null -ne $gen2After) { Add-Value $lists['controllerGen2Delta'] ($gen2After - $gen2Before) }
                } elseif ([int]$kind -eq 3) {
                    $counts["overlay"] = [int]$counts["overlay"] + 1
                    $operation = Get-Number $parts $index "overlayOperation"
                    $totalUs = Get-Ticks-Us $parts $index "totalTicks" $frequency
                    if ($null -ne $operation) {
                        $operationKey = ([int]$operation).ToString([System.Globalization.CultureInfo]::InvariantCulture)
                        Increment-Count $overlayOperations $operationKey
                        if ([int]$operation -eq 1) {
                            Add-Value $lists['overlayShowCursorUs'] $totalUs
                        } elseif ([int]$operation -eq 2) {
                            Add-Value $lists['overlayMoveUs'] $totalUs
                        } elseif ([int]$operation -eq 3) {
                            Add-Value $lists['overlaySetOpacityUs'] $totalUs
                        } elseif ([int]$operation -eq 4) {
                            Add-Value $lists['overlayUpdateLayerUs'] $totalUs
                            Add-Value $lists['overlayGetDcUs'] (Get-Ticks-Us $parts $index "getDcTicks" $frequency)
                            Add-Value $lists['overlayCreateCompatibleDcUs'] (Get-Ticks-Us $parts $index "createCompatibleDcTicks" $frequency)
                            Add-Value $lists['overlayGetHbitmapUs'] (Get-Ticks-Us $parts $index "getHbitmapTicks" $frequency)
                            Add-Value $lists['overlaySelectObjectUs'] (Get-Ticks-Us $parts $index "selectObjectTicks" $frequency)
                            Add-Value $lists['overlayUpdateLayeredWindowUs'] (Get-Ticks-Us $parts $index "updateLayeredWindowTicks" $frequency)
                            Add-Value $lists['overlayCleanupUs'] (Get-Ticks-Us $parts $index "cleanupTicks" $frequency)
                            $succeeded = Get-Number $parts $index "succeeded"
                            if ($null -ne $succeeded -and [int]$succeeded -eq 0) {
                                $counts["updateLayerFailures"] = [int]$counts["updateLayerFailures"] + 1
                            }
                        }
                    }
                    Add-Value $lists['overlayAlpha'] (Get-Number $parts $index "alpha")
                } else {
                    $counts["unknown"] = [int]$counts["unknown"] + 1
                }
            }
        } finally {
            $reader.Dispose()
        }

        $coalescing = [ordered]@{}
        foreach ($column in $coalescingColumns) {
            $coalescing[$column] = Stats $coalescingLists[$column].ToArray()
        }

        return [pscustomobject][ordered]@{
            package = Split-Path -Leaf $resolvedPath
            path = $resolvedPath
            metadata = $metadata
            counts = [pscustomobject]$counts
            overlayOperations = $overlayOperations
            waitReturnReasons = $waitReturnReasons
            scheduler = [pscustomobject][ordered]@{
                wakeLateUs = Stats $lists['schedulerWakeLateUs'].ToArray()
                vBlankLeadUs = Stats $lists['schedulerVBlankLeadUs'].ToArray()
                dwmReadUs = Stats $lists['schedulerDwmReadUs'].ToArray()
                decisionUs = Stats $lists['schedulerDecisionUs'].ToArray()
                waitUs = Stats $lists['schedulerWaitUs'].ToArray()
                tickDurationUs = Stats $lists['schedulerTickUs'].ToArray()
                loopTotalUs = Stats $lists['schedulerLoopTotalUs'].ToArray()
                processedMessagesBeforeTick = Stats $lists['schedulerProcessedMessages'].ToArray()
                processedMessageDurationUs = Stats $lists['schedulerProcessedMessageDurationUs'].ToArray()
                maxMessageDispatchUs = Stats $lists['schedulerMaxMessageDispatchUs'].ToArray()
                messageWakeCount = Stats $lists['schedulerMessageWakeCount'].ToArray()
                fineSleepZeroCount = Stats $lists['schedulerFineSleepZeroCount'].ToArray()
                fineSpinCount = Stats $lists['schedulerFineSpinCount'].ToArray()
            }
            controller = [pscustomobject][ordered]@{
                pollUs = Stats $lists['controllerPollUs'].ToArray()
                selectTargetUs = Stats $lists['controllerSelectTargetUs'].ToArray()
                predictUs = Stats $lists['controllerPredictUs'].ToArray()
                moveOverlayUs = Stats $lists['controllerMoveOverlayUs'].ToArray()
                applyOpacityUs = Stats $lists['controllerApplyOpacityUs'].ToArray()
                tickTotalUs = Stats $lists['controllerTickTotalUs'].ToArray()
                vBlankLeadUs = Stats $lists['controllerVBlankLeadUs'].ToArray()
                pollSampleAvailable = Stats $lists['controllerPollSampleAvailable'].ToArray()
                stalePollSample = Stats $lists['controllerStalePollSample'].ToArray()
                predictionEnabled = Stats $lists['controllerPredictionEnabled'].ToArray()
                gen0Delta = Stats $lists['controllerGen0Delta'].ToArray()
                gen1Delta = Stats $lists['controllerGen1Delta'].ToArray()
                gen2Delta = Stats $lists['controllerGen2Delta'].ToArray()
            }
            overlay = [pscustomobject][ordered]@{
                showCursorUs = Stats $lists['overlayShowCursorUs'].ToArray()
                moveUs = Stats $lists['overlayMoveUs'].ToArray()
                setOpacityUs = Stats $lists['overlaySetOpacityUs'].ToArray()
                updateLayerUs = Stats $lists['overlayUpdateLayerUs'].ToArray()
                getDcUs = Stats $lists['overlayGetDcUs'].ToArray()
                createCompatibleDcUs = Stats $lists['overlayCreateCompatibleDcUs'].ToArray()
                getHbitmapUs = Stats $lists['overlayGetHbitmapUs'].ToArray()
                selectObjectUs = Stats $lists['overlaySelectObjectUs'].ToArray()
                updateLayeredWindowUs = Stats $lists['overlayUpdateLayeredWindowUs'].ToArray()
                cleanupUs = Stats $lists['overlayCleanupUs'].ToArray()
                alpha = Stats $lists['overlayAlpha'].ToArray()
            }
            coalescing = $coalescing
        }
    } finally {
        $archive.Dispose()
    }
}

function Expand-PackagePaths([string[]]$Paths) {
    $expanded = New-Object System.Collections.Generic.List[string]
    foreach ($path in $Paths) {
        $resolvedItems = Resolve-Path -LiteralPath $path
        foreach ($item in $resolvedItems) {
            if ([System.IO.Directory]::Exists($item.Path)) {
                Get-ChildItem -LiteralPath $item.Path -Filter *.zip -File | Sort-Object Name | ForEach-Object { $expanded.Add($_.FullName) }
            } else {
                $expanded.Add($item.Path)
            }
        }
    }

    return $expanded.ToArray()
}

function Add-Metric-Row($Lines, [string]$Name, $Metric) {
    $Lines.Add("| $Name | $(Format-Stat $Metric "p50") | $(Format-Stat $Metric "p95") | $(Format-Stat $Metric "p99") | $(Format-Stat $Metric "max") |")
}

function Build-Report($Metrics) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("# Product Runtime Outlier v3 Metrics")
    $lines.Add("")
    $lines.Add("## Packages")
    $lines.Add("")
    $lines.Add("| Package | events | dropped | scheduler | controller | overlay | update failures |")
    $lines.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    foreach ($run in $Metrics.packages) {
        $eventCount = if ($null -ne $run.metadata -and $null -ne $run.metadata.eventCount) { $run.metadata.eventCount } else { "" }
        $dropped = if ($null -ne $run.metadata -and $null -ne $run.metadata.droppedCount) { $run.metadata.droppedCount } else { "" }
        $lines.Add("| $($run.package) | $eventCount | $dropped | $($run.counts.scheduler) | $($run.counts.controller) | $($run.counts.overlay) | $($run.counts.updateLayerFailures) |")
    }

    foreach ($run in $Metrics.packages) {
        $lines.Add("")
        $lines.Add("## $($run.package)")
        $lines.Add("")
        $eventCount = if ($null -ne $run.metadata -and $null -ne $run.metadata.eventCount) { $run.metadata.eventCount } else { "" }
        $droppedCount = if ($null -ne $run.metadata -and $null -ne $run.metadata.droppedCount) { $run.metadata.droppedCount } else { "" }
        $lines.Add('- events: `' + $eventCount + '`')
        $lines.Add('- dropped events: `' + $droppedCount + '`')
        $lines.Add('- `UpdateLayeredWindow` failures: `' + $run.counts.updateLayerFailures + '`')
        $lines.Add("")
        $lines.Add("| Metric | p50 us | p95 us | p99 us | max us |")
        $lines.Add("| --- | ---: | ---: | ---: | ---: |")
        Add-Metric-Row $lines "scheduler wake late" $run.scheduler.wakeLateUs
        Add-Metric-Row $lines "scheduler tick total" $run.scheduler.tickDurationUs
        Add-Metric-Row $lines "scheduler wait" $run.scheduler.waitUs
        Add-Metric-Row $lines "controller tick total" $run.controller.tickTotalUs
        Add-Metric-Row $lines "controller poll" $run.controller.pollUs
        Add-Metric-Row $lines "controller predict" $run.controller.predictUs
        Add-Metric-Row $lines "move overlay" $run.controller.moveOverlayUs
        Add-Metric-Row $lines "apply opacity" $run.controller.applyOpacityUs
        Add-Metric-Row $lines '`UpdateLayer`' $run.overlay.updateLayerUs
        Add-Metric-Row $lines '`GetHbitmap`' $run.overlay.getHbitmapUs
        Add-Metric-Row $lines '`UpdateLayeredWindow`' $run.overlay.updateLayeredWindowUs
        Add-Metric-Row $lines "overlay move" $run.overlay.moveUs

        if ($run.coalescing.Keys.Count -gt 0) {
            $lines.Add("")
            $lines.Add("### Coalescing Fields")
            $lines.Add("")
            $lines.Add("| Field | count | p50 | p95 | p99 | max |")
            $lines.Add("| --- | ---: | ---: | ---: | ---: | ---: |")
            foreach ($name in $run.coalescing.Keys) {
                $metric = $run.coalescing[$name]
                $lines.Add(('| `{0}` | {1} | {2} | {3} | {4} | {5} |' -f $name, $metric.count, (Format-Stat $metric "p50"), (Format-Stat $metric "p95"), (Format-Stat $metric "p99"), (Format-Stat $metric "max")))
            }
        } else {
            $lines.Add("")
            $lines.Add("### Coalescing Fields")
            $lines.Add("")
            $lines.Add("No coalescing-related CSV columns were present.")
        }
    }

    return ($lines -join [Environment]::NewLine) + [Environment]::NewLine
}

$packages = Expand-PackagePaths $PackagePath
if ($packages.Count -eq 0) {
    throw "No package paths resolved."
}

$runs = @()
foreach ($package in $packages) {
    $runs += Analyze-Package $package
}

$metrics = [pscustomobject][ordered]@{
    generatedUtc = [DateTime]::UtcNow.ToString("o", [System.Globalization.CultureInfo]::InvariantCulture)
    packageCount = $runs.Count
    packages = $runs
}

$metricsDirectory = Split-Path -Parent $MetricsPath
if (-not [string]::IsNullOrWhiteSpace($metricsDirectory)) {
    New-Item -ItemType Directory -Force -Path $metricsDirectory | Out-Null
}

$reportDirectory = Split-Path -Parent $ReportPath
if (-not [string]::IsNullOrWhiteSpace($reportDirectory)) {
    New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
}

$metrics | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $MetricsPath -Encoding UTF8
Build-Report $metrics | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$metrics | ConvertTo-Json -Depth 12


