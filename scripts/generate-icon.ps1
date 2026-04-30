param(
    [string]$Output
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$iconDir = Join-Path $root "assets\icons"

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $iconDir "CursorMirror.ico"
}

Add-Type -AssemblyName System.Drawing

function Get-SourcePngPath([int]$size) {
    $specific = Join-Path $iconDir "icon.$size.png"
    if (Test-Path $specific) {
        return $specific
    }

    $preferred = Join-Path $iconDir "icon.256.png"
    if (Test-Path $preferred) {
        return $preferred
    }

    return (Join-Path $iconDir "icon.png")
}

function New-PngBytes([int]$size) {
    $sourcePath = Get-SourcePngPath $size
    $source = [System.Drawing.Image]::FromFile($sourcePath)
    try {
        if ($source.Width -eq $size -and $source.Height -eq $size) {
            return ,[System.IO.File]::ReadAllBytes($sourcePath)
        }

        $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($source, 0, 0, $size, $size)
            } finally {
                $graphics.Dispose()
            }

            $stream = New-Object System.IO.MemoryStream
            try {
                $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                return ,$stream.ToArray()
            } finally {
                $stream.Dispose()
            }
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

$sizes = @(16, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
    $images += [PSCustomObject]@{
        Size = $size
        Bytes = New-PngBytes $size
    }
}

$outputDir = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$stream = [System.IO.File]::Open($Output, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
    $writer = New-Object System.IO.BinaryWriter $stream
    try {
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]$images.Count)

        $offset = 6 + (16 * $images.Count)
        foreach ($image in $images) {
            $sizeByte = if ($image.Size -eq 256) { 0 } else { $image.Size }
            $writer.Write([Byte]$sizeByte)
            $writer.Write([Byte]$sizeByte)
            $writer.Write([Byte]0)
            $writer.Write([Byte]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]32)
            $writer.Write([UInt32]$image.Bytes.Length)
            $writer.Write([UInt32]$offset)
            $offset += $image.Bytes.Length
        }

        foreach ($image in $images) {
            $writer.Write($image.Bytes)
        }
    } finally {
        $writer.Dispose()
    }
} finally {
    $stream.Dispose()
}

Write-Host "Generated icon:"
Write-Host "  $Output"
