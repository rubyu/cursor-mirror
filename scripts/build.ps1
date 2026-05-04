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
$traceToolOut = Join-Path $bin "CursorMirror.TraceTool.exe"
$demoOut = Join-Path $bin "CursorMirror.Demo.exe"
$calibratorOut = Join-Path $bin "CursorMirror.Calibrator.exe"
$motionLabOut = Join-Path $bin "CursorMirror.MotionLab.exe"
$loadGenOut = Join-Path $bin "CursorMirror.LoadGen.exe"
$kernelBenchOut = Join-Path $bin "CursorMirror.KernelBench.exe"
$testsOut = Join-Path $bin "CursorMirror.Tests.exe"
$manifest = Join-Path $root "src\CursorMirror.App\app.manifest"
$traceToolManifest = Join-Path $root "src\CursorMirror.TraceTool\app.manifest"
$demoManifest = Join-Path $root "src\CursorMirror.Demo\app.manifest"
$calibratorManifest = Join-Path $root "src\CursorMirror.Calibrator\app.manifest"
$motionLabManifest = Join-Path $root "src\CursorMirror.MotionLab\app.manifest"
$icon = Join-Path $root "assets\icons\CursorMirror.ico"
$versionJson = Join-Path $bin "CursorMirror.version.json"
$buildVersionSource = Join-Path $generated "BuildVersion.g.cs"
$coreAssemblyVersionSource = Join-Path $generated "CursorMirror.Core.AssemblyVersion.g.cs"
$appAssemblyVersionSource = Join-Path $generated "CursorMirror.App.AssemblyVersion.g.cs"
$traceToolAssemblyVersionSource = Join-Path $generated "CursorMirror.TraceTool.AssemblyVersion.g.cs"
$demoAssemblyVersionSource = Join-Path $generated "CursorMirror.Demo.AssemblyVersion.g.cs"
$calibratorAssemblyVersionSource = Join-Path $generated "CursorMirror.Calibrator.AssemblyVersion.g.cs"
$motionLabAssemblyVersionSource = Join-Path $generated "CursorMirror.MotionLab.AssemblyVersion.g.cs"
$loadGenAssemblyVersionSource = Join-Path $generated "CursorMirror.LoadGen.AssemblyVersion.g.cs"
$kernelBenchAssemblyVersionSource = Join-Path $generated "CursorMirror.KernelBench.AssemblyVersion.g.cs"

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

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $traceToolAssemblyVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $demoAssemblyVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $calibratorAssemblyVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $motionLabAssemblyVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $loadGenAssemblyVersionSource -Encoding ASCII

@"
using System.Reflection;

[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$informationalVersion")]
"@ | Set-Content -LiteralPath $kernelBenchAssemblyVersionSource -Encoding ASCII

$coreSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Core") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($buildVersionSource, $coreAssemblyVersionSource)
$appCoreSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Core") -Recurse -Filter *.cs | Where-Object { $_.FullName -notmatch "\\Properties\\AssemblyInfo\.cs$" } | ForEach-Object { $_.FullName }) + @($buildVersionSource)
$appSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.App") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($appAssemblyVersionSource)
$traceToolSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.TraceTool") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($traceToolAssemblyVersionSource)
$demoSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Demo") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($demoAssemblyVersionSource)
$calibratorSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.Calibrator") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($calibratorAssemblyVersionSource)
$motionLabSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.MotionLab") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($motionLabAssemblyVersionSource)
$loadGenSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.LoadGen") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($loadGenAssemblyVersionSource)
$kernelBenchSources = @(Get-ChildItem -Path (Join-Path $root "src\CursorMirror.KernelBench") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @($kernelBenchAssemblyVersionSource)
$testSources = Get-ChildItem -Path (Join-Path $root "tests\CursorMirror.Tests") -Recurse -Filter *.cs | ForEach-Object { $_.FullName }

$windowsWinmd = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\UnionMetadata" -Recurse -Filter Windows.winmd -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\Facade\\" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if ([string]::IsNullOrWhiteSpace($windowsWinmd)) {
    throw "Windows.winmd was not found. Install Windows SDK 10.0.22621 or newer to build CursorMirror.Calibrator.exe."
}

$windowsRuntimeRef = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\System.Runtime.WindowsRuntime.dll"
$windowsRuntimeInteropRef = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\System.Runtime.InteropServices.WindowsRuntime.dll"
$systemRuntimeRef = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\System.Runtime.dll"
if (-not (Test-Path $windowsRuntimeRef) -or -not (Test-Path $windowsRuntimeInteropRef) -or -not (Test-Path $systemRuntimeRef)) {
    throw ".NET Framework WinRT reference assemblies were not found."
}

$debugFlag = "/debug+"
$optimizeFlag = "/optimize-"
if ($Configuration -eq "Release") {
    $debugFlag = "/debug-"
    $optimizeFlag = "/optimize+"
}

& (Join-Path $root "scripts\generate-icon.ps1") -Output $icon

& $csc /nologo /target:library /warn:4 $debugFlag $optimizeFlag /out:$coreOut /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll $coreSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$appOut "/win32manifest:$manifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll $appCoreSources $appSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$traceToolOut "/win32manifest:$traceToolManifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:$coreOut $traceToolSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$demoOut "/win32manifest:$demoManifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:$coreOut $demoSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$calibratorOut "/win32manifest:$calibratorManifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:$windowsRuntimeRef /reference:$windowsRuntimeInteropRef /reference:$systemRuntimeRef /reference:$windowsWinmd /reference:$coreOut $calibratorSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:winexe /warn:4 $debugFlag $optimizeFlag /out:$motionLabOut "/win32manifest:$motionLabManifest" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:$coreOut $motionLabSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:exe /warn:4 $debugFlag $optimizeFlag /out:$loadGenOut /reference:System.dll /reference:System.Core.dll $loadGenSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:exe /warn:4 $debugFlag $optimizeFlag /out:$kernelBenchOut /reference:System.dll /reference:System.Core.dll $kernelBenchSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& (Join-Path $root "scripts\build-native-kernels.ps1") -Configuration $Configuration -OutDir $bin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $csc /nologo /target:exe /warn:4 $debugFlag $optimizeFlag /out:$testsOut /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:$coreOut /reference:$traceToolOut /reference:$calibratorOut $testSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Built ($Configuration):"
Write-Host "  Version: $($versionInfo.InformationalVersion)"
Write-Host "  $coreOut"
Write-Host "  $appOut"
Write-Host "  $traceToolOut"
Write-Host "  $demoOut"
Write-Host "  $calibratorOut"
Write-Host "  $motionLabOut"
Write-Host "  $loadGenOut"
Write-Host "  $kernelBenchOut"
Write-Host "  $testsOut"
