param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",
    [switch]$RequireStableTag
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $csc)) {
    throw "csc.exe was not found."
}

$bin = Join-Path $root "artifacts\bin\$Configuration"
$generated = Join-Path $root "artifacts\generated\$Configuration"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
New-Item -ItemType Directory -Force -Path $generated | Out-Null

$coreOut = Join-Path $bin "CursorMirror.Core.dll"
$appOut = Join-Path $bin "CursorMirror.exe"
$testsOut = Join-Path $bin "CursorMirror.Tests.exe"
$manifest = Join-Path $root "src\CursorMirror.App\app.manifest"
$icon = Join-Path $root "assets\icons\CursorMirror.ico"
$versionJson = Join-Path $bin "CursorMirror.version.json"
$buildVersionSource = Join-Path $generated "BuildVersion.g.cs"
$coreAssemblyVersionSource = Join-Path $generated "CursorMirror.Core.AssemblyVersion.g.cs"
$appAssemblyVersionSource = Join-Path $generated "CursorMirror.App.AssemblyVersion.g.cs"

function ConvertTo-CSharpLiteral([string]$Value) {
    return $Value.Replace('\', '\\').Replace('"', '\"')
}

$resolveArgs = @{
    RepositoryRoot = $root
}
if ($RequireStableTag) {
    $resolveArgs.RequireStableTag = $true
}

$versionInfo = & (Join-Path $root "scripts\resolve-version.ps1") @resolveArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$versionInfo | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $versionJson -Encoding ASCII

$informationalVersion = ConvertTo-CSharpLiteral $versionInfo.InformationalVersion
$assemblyVersion = ConvertTo-CSharpLiteral $versionInfo.AssemblyVersion
$fileVersion = ConvertTo-CSharpLiteral $versionInfo.FileVersion
$packageVersion = ConvertTo-CSharpLiteral $versionInfo.PackageVersion
$isStable = if ($versionInfo.IsStable) { "true" } else { "false" }

@"
namespace CursorMirror
{
    public static class BuildVersion
    {
        public const string InformationalVersion = "$informationalVersion";
        public const string AssemblyVersion = "$assemblyVersion";
        public const string FileVersion = "$fileVersion";
        public const string PackageVersion = "$packageVersion";
        public const bool IsStable = $isStable;
    }
}
"@ | Set-Content -LiteralPath $buildVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $coreAssemblyVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $appAssemblyVersionSource -Encoding ASCII

$coreSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Core") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($buildVersionSource, $coreAssemblyVersionSource)
$appCoreSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Core") -Recurse -Filter *.cs | Where-Object { $_.FullName -notmatch "\\Properties\\AssemblyInfo\.cs$" } | ForEach-Object { $_.FullName }) + @($buildVersionSource)
$appSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.App") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($appAssemblyVersionSource)
$testSources = Get-ChildItem -Path (Join-Path $root "tests\CursorMirror.Tests") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }

$debugFlag = "/debug+"
$optimizeFlag = "/optimize-"
if ($Configuration -eq "Release") {
    $debugFlag = "/debug-"
    $optimizeFlag = "/optimize+"
}

& (Join-Path $root "scripts\generate-icon.ps1") -Output $icon

& $csc /nologo /target:library /warn:4 $debugFlag $optimizeFlag /out:$coreOut /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll $coreSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$appOut "/win32manifest:$manifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll $appCoreSources $appSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:exe /warn:4 $debugFlag $optimizeFlag /out:$testsOut /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:$coreOut $testSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Built ($Configuration):"
Write-Host "  Version: $($versionInfo.InformationalVersion)"
Write-Host "  $coreOut"
Write-Host "  $appOut"
Write-Host "  $testsOut"
