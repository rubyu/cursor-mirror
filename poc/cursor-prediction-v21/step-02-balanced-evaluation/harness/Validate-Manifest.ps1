param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
  [string]$OutDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $OutDir "split-manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$availableZips = Get-ChildItem -Path $Root -Filter $manifest.targetPattern -File | Sort-Object Name
$requiredEntries = @($manifest.requiredZipEntries)
$sampleColumns = @($manifest.loaderRequiredColumns.'motion-samples.csv')
$alignmentColumns = @($manifest.loaderRequiredColumns.'motion-trace-alignment.csv')

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipJson($Archive, [string]$Name) {
  $entry = $Archive.GetEntry($Name)
  if ($null -eq $entry) { return $null }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    return ($reader.ReadToEnd() | ConvertFrom-Json)
  } finally {
    $reader.Dispose()
  }
}

function Test-CsvHeader($Archive, [string]$EntryName, [string[]]$RequiredColumns, [string]$FileName) {
  $errors = @()
  $entry = $Archive.GetEntry($EntryName)
  if ($null -eq $entry) { return $errors }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    $header = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($header)) {
      return @("${FileName}: ${EntryName} has no header")
    }
    $columns = @{}
    foreach ($column in ($header -split ",")) {
      $columns[$column.Trim().ToLowerInvariant()] = $true
    }
    foreach ($required in $RequiredColumns) {
      if (-not $columns.ContainsKey($required.ToLowerInvariant())) {
        $errors += "${FileName}: ${EntryName} missing column ${required}"
      }
    }
  } finally {
    $reader.Dispose()
  }
  return $errors
}

$packageChecks = @()
foreach ($package in $manifest.packages) {
  $errors = @()
  $warnings = @()
  $zipPath = Join-Path $Root ($package.path -replace "/", [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $zipPath)) {
    $packageChecks += [pscustomobject]@{
      file = $package.file
      exists = $false
      errors = @("missing ZIP: $($package.file)")
      warnings = @()
    }
    continue
  }

  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entryNames = @{}
    foreach ($entry in $archive.Entries) {
      $entryNames[$entry.FullName.ToLowerInvariant()] = $entry
    }
    foreach ($required in $requiredEntries) {
      if (-not $entryNames.ContainsKey($required.ToLowerInvariant())) {
        $errors += "$($package.file): missing required entry $required"
      }
    }

    $metadata = Read-ZipJson $archive "motion-metadata.json"
    if ($null -eq $metadata) {
      $errors += "$($package.file): motion-metadata.json unavailable"
    } else {
      if ([double]$package.scenarioDurationMilliseconds -ne [double]$metadata.ScenarioDurationMilliseconds) {
        $errors += "$($package.file): scenarioDurationMilliseconds mismatch"
      }
      if ([double]$package.durationMilliseconds -ne [double]$metadata.DurationMilliseconds) {
        $errors += "$($package.file): durationMilliseconds mismatch"
      }
      if ([int]$package.scenarioCount -ne [int]$metadata.ScenarioCount) {
        $errors += "$($package.file): scenarioCount mismatch"
      }
    }

    $errors += Test-CsvHeader $archive "motion-samples.csv" $sampleColumns $package.file
    $errors += Test-CsvHeader $archive "motion-trace-alignment.csv" $alignmentColumns $package.file

    $entrySizes = @($archive.Entries | Sort-Object FullName | ForEach-Object {
      [pscustomobject]@{
        name = $_.FullName
        uncompressedBytes = $_.Length
        compressedBytes = $_.CompressedLength
      }
    })

    $packageChecks += [pscustomobject]@{
      file = $package.file
      packageId = $package.packageId
      split = $package.split
      qualityBucket = $package.qualityBucket
      durationBucket = $package.durationBucket
      exists = $true
      requiredEntriesPresent = ($requiredEntries | Where-Object { -not $entryNames.ContainsKey($_.ToLowerInvariant()) }).Count -eq 0
      entrySizes = $entrySizes
      errors = @($errors)
      warnings = @($warnings)
    }
  } finally {
    $archive.Dispose()
  }
}

$manifestFiles = @($manifest.packages | ForEach-Object { $_.file })
$missingFromManifest = @($availableZips | Where-Object { $manifestFiles -notcontains $_.Name } | ForEach-Object { $_.Name })
$duplicatePackageIds = @($manifest.packages | Group-Object packageId | Where-Object Count -gt 1 | ForEach-Object Name)
$duplicateFiles = @($manifest.packages | Group-Object file | Where-Object Count -gt 1 | ForEach-Object Name)
$allErrors = @($packageChecks | ForEach-Object { $_.errors } | Where-Object { $_ })
$allErrors += @($duplicatePackageIds | ForEach-Object { "duplicate packageId: $_" })
$allErrors += @($duplicateFiles | ForEach-Object { "duplicate file: $_" })
$allErrors += @($missingFromManifest | ForEach-Object { "available ZIP missing from manifest: $_" })

$output = [pscustomobject]@{
  schemaVersion = "cursor-prediction-v21-step-02-manifest-check/1"
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  root = $Root
  manifest = "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json"
  availableZipCount = $availableZips.Count
  manifestPackageCount = @($manifest.packages).Count
  duplicatePackageIds = @($duplicatePackageIds)
  duplicateFiles = @($duplicateFiles)
  missingFromManifest = @($missingFromManifest)
  constraints = [pscustomobject]@{
    rawCsvExtractedToDisk = $false
    modelTrainingRun = $false
    cpuGpuMeasurementRun = $false
  }
  packages = @($packageChecks)
  ok = $allErrors.Count -eq 0
  errors = @($allErrors)
}

$outPath = Join-Path $OutDir "manifest-check.json"
$output | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding UTF8
Write-Output $outPath
