param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$coreDll = Join-Path $root "artifacts\bin\Release\CursorMirror.Core.dll"
if (-not (Test-Path -LiteralPath $coreDll)) {
    throw "Missing CursorMirror.Core.dll at '$coreDll'. Build the product Release artifacts first."
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path -LiteralPath $csc)) {
    throw "csc.exe was not found."
}

$bin = Join-Path $PSScriptRoot "bin\$Configuration"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$exe = Join-Path $bin "SyntheticOverlayHarness.exe"
$debugFlag = if ($Configuration -eq "Debug") { "/debug+" } else { "/debug-" }
$optimizeFlag = if ($Configuration -eq "Debug") { "/optimize-" } else { "/optimize+" }

& $csc /nologo /target:exe /warn:4 $debugFlag $optimizeFlag /out:$exe /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Windows.Forms.dll /reference:$coreDll (Join-Path $PSScriptRoot "Program.cs")
if ($LASTEXITCODE -ne 0) {
    throw "Harness compilation failed."
}

Copy-Item -LiteralPath $coreDll -Destination $bin -Force
Write-Host "Built $exe"
