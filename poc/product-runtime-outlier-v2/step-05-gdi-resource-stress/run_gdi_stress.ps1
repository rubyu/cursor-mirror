param(
    [string]$Configuration = "Release",
    [int]$Iterations = 250,
    [int]$MovesPerImage = 24,
    [int]$AllowedFinalDelta = 8,
    [string]$MetricsPath = ".\poc\product-runtime-outlier-v2\step-05-gdi-resource-stress\metrics.json"
)

$ErrorActionPreference = "Stop"

$step = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $step "..\..\..")
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $csc)) {
    throw "csc.exe was not found."
}

$bin = Join-Path $step "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$core = Join-Path $root "artifacts\bin\$Configuration\CursorMirror.Core.dll"
if (-not (Test-Path $core)) {
    throw "CursorMirror.Core.dll was not found. Build first."
}

$exe = Join-Path $bin "OverlayGdiStress.exe"
$source = Join-Path $step "OverlayGdiStress.cs"
& $csc /nologo /target:exe /warn:4 /optimize+ /out:$exe /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:$core $source
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item -LiteralPath $core -Destination (Join-Path $bin "CursorMirror.Core.dll") -Force
& $exe $MetricsPath $Iterations $MovesPerImage $AllowedFinalDelta
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Get-Content -LiteralPath $MetricsPath
