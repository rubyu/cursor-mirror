param(
    [string]$RepositoryRoot,
    [string]$BranchName,
    [string]$TagName,
    [switch]$RequireStableTag
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$date = [DateTime]::UtcNow.ToString("yyyyMMdd")

function Split-Lines([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @()
    }

    return $Text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Invoke-Git([string[]]$Arguments) {
    $oldLocation = Get-Location
    try {
        Set-Location -LiteralPath $RepositoryRoot
        $output = & git @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }

        return ($output -join "`n").Trim()
    } finally {
        Set-Location $oldLocation
    }
}

function ConvertFrom-StableTag([string]$Tag) {
    if ($Tag -match "^v(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)$") {
        return [PSCustomObject]@{
            Tag = $Tag
            Major = [int]$Matches["major"]
            Minor = [int]$Matches["minor"]
            Patch = [int]$Matches["patch"]
        }
    }

    return $null
}

function New-VersionInfo(
    [int]$Major,
    [int]$Minor,
    [int]$Patch,
    [string]$Sha,
    [bool]$Dirty,
    [bool]$Stable,
    [string]$Tag,
    [string]$Branch
) {
    $assemblyVersion = "$Major.$Minor.$Patch.0"
    if ($Stable) {
        $version = "v$Major.$Minor.$Patch+$date.$Sha"
        $packageVersion = "$Major.$Minor.$Patch"
    } else {
        $dirtySuffix = if ($Dirty) { ".dirty" } else { "" }
        $version = "v$Major.$Minor.$Patch-dev+$date.$Sha$dirtySuffix"
        $packageVersion = "$Major.$Minor.$Patch-dev.$date.$Sha$dirtySuffix"
    }

    return [PSCustomObject]@{
        Version = $version
        InformationalVersion = $version
        AssemblyVersion = $assemblyVersion
        FileVersion = $assemblyVersion
        PackageVersion = $packageVersion
        IsStable = $Stable
        TagName = $Tag
        BranchName = $Branch
        Date = $date
        Sha = $Sha
        Dirty = $Dirty
    }
}

function Get-LatestStableTag() {
    $tagOutput = Invoke-Git @("tag", "--list", "v*")
    $stableTags = @()
    foreach ($tag in (Split-Lines $tagOutput)) {
        $parsed = ConvertFrom-StableTag $tag
        if ($null -ne $parsed) {
            $stableTags += $parsed
        }
    }

    if ($stableTags.Count -eq 0) {
        return [PSCustomObject]@{
            Tag = "v0.0.0"
            Major = 0
            Minor = 0
            Patch = 0
        }
    }

    return $stableTags | Sort-Object Major, Minor, Patch | Select-Object -Last 1
}

function Get-ExactStableTag() {
    if (-not [string]::IsNullOrWhiteSpace($TagName)) {
        $parsedTag = ConvertFrom-StableTag $TagName
        if ($null -eq $parsedTag) {
            if ($RequireStableTag) {
                throw "Release tag '$TagName' must match vMAJOR.MINOR.PATCH."
            }

            return $null
        }

        $pointedTags = Split-Lines (Invoke-Git @("tag", "--points-at", "HEAD"))
        if ($pointedTags -contains $TagName) {
            return $parsedTag
        }

        if ($RequireStableTag) {
            throw "Release tag '$TagName' does not point at HEAD."
        }

        return $null
    }

    $exactTags = @()
    foreach ($tag in (Split-Lines (Invoke-Git @("tag", "--points-at", "HEAD")))) {
        $parsed = ConvertFrom-StableTag $tag
        if ($null -ne $parsed) {
            $exactTags += $parsed
        }
    }

    if ($exactTags.Count -eq 0) {
        return $null
    }

    return $exactTags | Sort-Object Major, Minor, Patch | Select-Object -Last 1
}

function Get-BranchName() {
    if (-not [string]::IsNullOrWhiteSpace($BranchName)) {
        return $BranchName
    }

    if ($env:GITHUB_REF_TYPE -eq "branch" -and -not [string]::IsNullOrWhiteSpace($env:GITHUB_REF_NAME)) {
        return $env:GITHUB_REF_NAME
    }

    $branch = Invoke-Git @("branch", "--show-current")
    if (-not [string]::IsNullOrWhiteSpace($branch)) {
        return $branch
    }

    return ""
}

$shaFull = Invoke-Git @("rev-parse", "HEAD")
if ([string]::IsNullOrWhiteSpace($shaFull)) {
    if ($RequireStableTag) {
        throw "Git metadata is required for stable release packaging."
    }

    New-VersionInfo 0 0 0 "unknown" $false $false "" ""
    return
}

$sha = $shaFull.Trim().Substring(0, [Math]::Min(12, $shaFull.Trim().Length)).ToLowerInvariant()
$branch = Get-BranchName
$dirty = -not [string]::IsNullOrWhiteSpace((Invoke-Git @("status", "--porcelain")))
$exactStableTag = Get-ExactStableTag

if ($null -ne $exactStableTag) {
    if ($dirty) {
        throw "Stable tag builds require a clean working tree."
    }

    New-VersionInfo $exactStableTag.Major $exactStableTag.Minor $exactStableTag.Patch $sha $false $true $exactStableTag.Tag $branch
    return
}

if ($RequireStableTag) {
    throw "A valid stable tag matching vMAJOR.MINOR.PATCH must point at HEAD."
}

$latest = Get-LatestStableTag
if ($branch -eq "develop") {
    New-VersionInfo $latest.Major ($latest.Minor + 1) 0 $sha $dirty $false "" $branch
} else {
    New-VersionInfo $latest.Major $latest.Minor ($latest.Patch + 1) $sha $dirty $false "" $branch
}
