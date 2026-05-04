param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",
    [string]$OutDir
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $root "artifacts\bin\$Configuration"
}

$source = Join-Path $root "src\CursorMirror.KernelBench.Native\kernelbench_native.cpp"
if (-not (Test-Path $source)) {
    throw "Native kernel source was not found: $source"
}

function Get-VcVars64Path {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) {
        return $null
    }

    $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($installationPath)) {
        return $null
    }

    $vcvars = Join-Path $installationPath "VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path $vcvars) {
        return $vcvars
    }

    return $null
}

function ConvertTo-CmdArgument([string]$Value) {
    if ($Value -match '[\s"]') {
        return '"' + $Value.Replace('"', '\"') + '"'
    }

    return $Value
}

function Invoke-NativeBuild(
    [string]$VcVars,
    [string]$Name,
    [string[]]$Defines,
    [string[]]$ArchitectureFlags
) {
    $obj = Join-Path $nativeObjDir ($Name + ".obj")
    $dll = Join-Path $OutDir ("CursorMirror.KernelBench.Native." + $Name + ".dll")

    $flags = @(
        "/nologo",
        "/LD",
        "/W4",
        "/EHsc",
        "/fp:fast",
        "/Fo:$obj",
        "/Fe:$dll"
    )

    if ($Configuration -eq "Release") {
        $flags += @("/O2", "/Ob2", "/Oi", "/DNDEBUG")
    } else {
        $flags += @("/Zi", "/Od")
    }

    foreach ($define in $Defines) {
        $flags += "/D$define"
    }

    $flags += $ArchitectureFlags
    $flags += $source
    $flags += @("/link", "/NOLOGO")

    $clLine = ($flags | ForEach-Object { ConvertTo-CmdArgument $_ }) -join " "
    $command = '"' + $VcVars + '" >nul && cl.exe ' + $clLine
    & $env:ComSpec /d /s /c $command
    if ($LASTEXITCODE -ne 0) {
        throw "Native kernel build failed: $Name"
    }

    Write-Host "  $dll"
}

$vcvars64 = Get-VcVars64Path
if ([string]::IsNullOrWhiteSpace($vcvars64)) {
    Write-Host "Native kernel build skipped: MSVC x64 toolchain was not found."
    return
}

$nativeObjDir = Join-Path $root "artifacts\native\$Configuration"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $nativeObjDir | Out-Null

Write-Host "Building native kernels ($Configuration):"
Invoke-NativeBuild -VcVars $vcvars64 -Name "Scalar" -Defines @("CM_KERNEL_SCALAR") -ArchitectureFlags @()
Invoke-NativeBuild -VcVars $vcvars64 -Name "Avx2Fma" -Defines @("CM_KERNEL_AVX2_FMA") -ArchitectureFlags @("/arch:AVX2")
Invoke-NativeBuild -VcVars $vcvars64 -Name "Avx512F" -Defines @("CM_KERNEL_AVX512F") -ArchitectureFlags @("/arch:AVX512")
