param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [double]$WarmupMilliseconds = 1500.0
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$stepRoot = $PSScriptRoot
$manifestPath = Join-Path $RepoRoot "poc\cursor-prediction-v21\step-02-balanced-evaluation\split-manifest.json"
$scoresOut = Join-Path $stepRoot "scores.json"
$reportOut = Join-Path $stepRoot "report.md"

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

function Get-DoubleField([string[]]$Fields, [hashtable]$Index, [string]$Name, [double]$Fallback = 0.0) {
    $text = Get-Field $Fields $Index $Name
    $value = 0.0
    if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
        return $value
    }

    return $Fallback
}

function Read-Zip-Entry-Header([System.IO.Compression.ZipArchive]$Archive, [string]$Name) {
    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry) {
        return $null
    }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
        return $reader.ReadLine()
    }
    finally {
        $reader.Dispose()
    }
}

function Count-Sample-Package([string]$ZipPath) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entry = $archive.GetEntry("motion-trace-alignment.csv")
        if ($null -eq $entry) {
            throw "motion-trace-alignment.csv not found in $ZipPath"
        }

        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            $header = $reader.ReadLine()
            $index = Header-Index $header
            $rows = 0
            $runtimeRows = 0
            $eligibleRows = 0
            $phaseCounts = @{}
            while (($line = $reader.ReadLine()) -ne $null) {
                $rows++
                $fields = $line.Split(",")
                if ((Get-Field $fields $index "traceEvent") -ne "runtimeSchedulerPoll") {
                    continue
                }

                $runtimeRows++
                $scenarioElapsed = Get-DoubleField $fields $index "scenarioElapsedMilliseconds"
                if ($scenarioElapsed -ge $WarmupMilliseconds) {
                    $eligibleRows++
                    $phase = Get-Field $fields $index "movementPhase"
                    if ([string]::IsNullOrWhiteSpace($phase)) {
                        $phase = "(blank)"
                    }

                    if (-not $phaseCounts.ContainsKey($phase)) {
                        $phaseCounts[$phase] = 0
                    }

                    $phaseCounts[$phase] = [int]$phaseCounts[$phase] + 1
                }
            }

            return [ordered]@{
                alignmentRowsRead = $rows
                runtimeSchedulerPollRows = $runtimeRows
                eligibleRowsAfterWarmup = $eligibleRows
                eligibleRuntimeRatio = if ($rows -gt 0) { [Math]::Round($eligibleRows / $rows, 6) } else { 0 }
                movementPhaseCounts = $phaseCounts
            }
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$requiredEntries = @(
    "metadata.json",
    "motion-metadata.json",
    "motion-script.json",
    "motion-samples.csv",
    "motion-trace-alignment.csv",
    "trace.csv"
)
$requiredAlignmentColumns = @(
    "traceEvent",
    "traceElapsedMicroseconds",
    "generatedElapsedMilliseconds",
    "scenarioIndex",
    "scenarioElapsedMilliseconds",
    "generatedX",
    "generatedY",
    "velocityPixelsPerSecond",
    "movementPhase",
    "holdIndex",
    "phaseElapsedMilliseconds"
)
$requiredTraceColumns = @(
    "sequence",
    "event",
    "elapsedMicroseconds"
)

$packageAudits = @()
foreach ($package in $manifest.packages) {
    $zipPath = Resolve-RepoPath $package.path
    $exists = Test-Path -LiteralPath $zipPath
    $entryStatus = @{}
    $alignmentHeader = ""
    $traceHeader = ""
    $missingAlignmentColumns = @()
    $missingTraceColumns = @()

    if ($exists) {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            foreach ($entryName in $requiredEntries) {
                $entryStatus[$entryName] = $null -ne $archive.GetEntry($entryName)
            }

            $alignmentHeader = Read-Zip-Entry-Header $archive "motion-trace-alignment.csv"
            $traceHeader = Read-Zip-Entry-Header $archive "trace.csv"
            if (-not [string]::IsNullOrWhiteSpace($alignmentHeader)) {
                $alignmentIndex = Header-Index $alignmentHeader
                $missingAlignmentColumns = $requiredAlignmentColumns | Where-Object { -not $alignmentIndex.ContainsKey($_) }
            }

            if (-not [string]::IsNullOrWhiteSpace($traceHeader)) {
                $traceIndex = Header-Index $traceHeader
                $missingTraceColumns = $requiredTraceColumns | Where-Object { -not $traceIndex.ContainsKey($_) }
            }
        }
        finally {
            $archive.Dispose()
        }
    }

    $packageAudits += [ordered]@{
        packageId = $package.packageId
        split = $package.split
        qualityBucket = $package.qualityBucket
        durationBucket = $package.durationBucket
        scenarioDurationMilliseconds = $package.scenarioDurationMilliseconds
        scenarioCount = $package.scenarioCount
        alignmentRows = $package.alignmentRows
        zipExists = $exists
        requiredEntries = $entryStatus
        missingAlignmentColumns = @($missingAlignmentColumns)
        missingTraceColumns = @($missingTraceColumns)
    }
}

$samplePackage = $manifest.packages | Where-Object { $_.split -eq "test" -and $_.qualityBucket -eq "normal" } | Select-Object -First 1
if ($null -eq $samplePackage) {
    $samplePackage = $manifest.packages | Select-Object -First 1
}

$sampleZipPath = Resolve-RepoPath $samplePackage.path
$sampleCounts = Count-Sample-Package $sampleZipPath

$horizonMilliseconds = @(-24, -16, -8, 0, 4, 8, 12, 16, 24, 32, 40)
$labelsPerRow = $horizonMilliseconds.Count
$estimatedBySplit = @{}
foreach ($group in ($manifest.packages | Group-Object split)) {
    $alignmentRows = ($group.Group | Measure-Object -Property alignmentRows -Sum).Sum
    $estimatedEligibleRows = [long][Math]::Round($alignmentRows * [double]$sampleCounts.eligibleRuntimeRatio)
    $estimatedBySplit[$group.Name] = [ordered]@{
        packages = $group.Count
        manifestAlignmentRows = [long]$alignmentRows
        estimatedEligibleRows = $estimatedEligibleRows
        estimatedMultiHorizonLabels = [long]($estimatedEligibleRows * $labelsPerRow)
    }
}

$allEntriesOk = $true
foreach ($audit in $packageAudits) {
    if (-not $audit.zipExists -or $audit.missingAlignmentColumns.Count -gt 0 -or $audit.missingTraceColumns.Count -gt 0) {
        $allEntriesOk = $false
    }

    foreach ($entry in $requiredEntries) {
        if (-not $audit.requiredEntries[$entry]) {
            $allEntriesOk = $false
        }
    }
}

$result = [ordered]@{
    schemaVersion = "cursor-prediction-v24-step-02-multi-horizon-dataset-audit/1"
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceManifest = "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json"
    warmupMilliseconds = $WarmupMilliseconds
    horizonGridMilliseconds = $horizonMilliseconds
    labelsPerEligibleRow = $labelsPerRow
    packageCount = $manifest.packages.Count
    allRequiredEntriesAndColumnsPresent = $allEntriesOk
    packageAudits = $packageAudits
    samplePackage = [ordered]@{
        packageId = $samplePackage.packageId
        path = $samplePackage.path
        split = $samplePackage.split
        qualityBucket = $samplePackage.qualityBucket
        counts = $sampleCounts
    }
    estimatedBySplit = $estimatedBySplit
    limitations = @(
        "Only one package was fully scanned for runtimeSchedulerPoll/eligible ratio; other packages use manifest alignment rows multiplied by that ratio.",
        "This step does not materialize a row-level dataset and does not interpolate multi-horizon labels yet.",
        "The horizon grid includes internal target offsets from -24ms to +40ms plus intermediate future probes."
    )
}

Set-Content -LiteralPath $scoresOut -Value ($result | ConvertTo-Json -Depth 12) -Encoding ASCII

$report = @()
$report += "# Step 02 Report - Multi-Horizon Dataset Audit"
$report += ""
$report += "## Summary"
$report += ""
$report += "This step verifies the existing v21 MotionLab package shape and estimates the size of a multi-horizon dataset without writing a large row dump."
$report += ""
$report += "All required ZIP entries and required header columns were present: $allEntriesOk."
$report += ""
$report += "The initial horizon grid contains $labelsPerRow labels per eligible runtime row:"
$report += ""
$report += '```text'
$report += ($horizonMilliseconds -join ", ")
$report += '```'
$report += ""
$report += "## Sample Package"
$report += ""
$report += "| item | value |"
$report += "| --- | ---: |"
$report += "| package | $($samplePackage.packageId) |"
$report += "| split | $($samplePackage.split) |"
$report += "| quality | $($samplePackage.qualityBucket) |"
$report += "| alignment rows read | $($sampleCounts.alignmentRowsRead) |"
$report += "| runtimeSchedulerPoll rows | $($sampleCounts.runtimeSchedulerPollRows) |"
$report += "| eligible rows after warmup | $($sampleCounts.eligibleRowsAfterWarmup) |"
$report += "| eligible ratio | $($sampleCounts.eligibleRuntimeRatio) |"
$report += ""
$report += "## Estimated Dataset Size"
$report += ""
$report += "| split | packages | manifest alignment rows | estimated eligible rows | estimated labels |"
$report += "| --- | ---: | ---: | ---: | ---: |"
foreach ($key in ($estimatedBySplit.Keys | Sort-Object)) {
    $value = $estimatedBySplit[$key]
    $report += "| $key | $($value.packages) | $($value.manifestAlignmentRows) | $($value.estimatedEligibleRows) | $($value.estimatedMultiHorizonLabels) |"
}
$report += ""
$report += "## Decision"
$report += ""
$report += "Proceed to a row-level builder only after Step 03 confirms the exact training format. The likely builder should stream rows, interpolate labels for the horizon grid, and write either compact sampled training arrays or untracked large artifacts."
$report += ""
$report += "## Command"
$report += ""
$report += '```powershell'
$report += 'powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-02-multi-horizon-dataset\dataset-audit.ps1'
$report += '```'

Set-Content -LiteralPath $reportOut -Value $report -Encoding ASCII
Write-Host "Wrote $scoresOut"
Write-Host "Wrote $reportOut"
