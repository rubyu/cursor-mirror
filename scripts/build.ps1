param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug"
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
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$coreOut = Join-Path $bin "CursorMirror.Core.dll"
$appOut = Join-Path $bin "CursorMirror.exe"
$testsOut = Join-Path $bin "CursorMirror.Tests.exe"
$manifest = Join-Path $root "src\CursorMirror.App\app.manifest"
$icon = Join-Path $root "assets\icons\CursorMirror.ico"

$coreSources = Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Core") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }
$appCoreSources = Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Core") -Recurse -Filter *.cs | Where-Object { $_.FullName -notmatch "\\Properties\\AssemblyInfo\.cs$" } | ForEach-Object { $_.FullName }
$appSources = Get-ChildItem -Path (Join-Path $root "src\CursorMirror.App") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }
$testSources = Get-ChildItem -Path (Join-Path $root "tests\CursorMirror.Tests") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }

$debugFlag = "/debug+"
$optimizeFlag = "/optimize-"
if ($Configuration -eq "Release") {
    $debugFlag = "/debug-"
    $optimizeFlag = "/optimize+"
}

& (Join-Path $root "scripts\generate-icon.ps1") -Output $icon

& $csc /nologo /target:library /warn:4 $debugFlag $optimizeFlag /out:$coreOut /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $coreSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$appOut "/win32manifest:$manifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $appCoreSources $appSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:exe /warn:4 $debugFlag $optimizeFlag /out:$testsOut /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:$coreOut $testSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Built ($Configuration):"
Write-Host "  $coreOut"
Write-Host "  $appOut"
Write-Host "  $testsOut"
