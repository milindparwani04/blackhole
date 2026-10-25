# Renders the Blackhole logo (black disc, white rim, violet glow, tilted ring) into a multi-size Windows .ico.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
param([string]$Out = (Join-Path $PSScriptRoot '..\assets\blackhole.ico'))

Add-Type -AssemblyName System.Drawing
$sizes = 256, 128, 64, 48, 32, 24, 16
$pngs = @()

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $s / 64.0

  # Rounded dark tile.
  $r = 12 * $k
  $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tile.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $tile.AddArc($s - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $tile.AddArc($s - 2 * $r, $s - 2 * $r, 2 * $r, 2 * $r, 0, 90); $tile.AddArc(0, $s - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $tile.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 10, 12))), $tile)

  # Violet glow around the event horizon.
  $glow = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gr = 24 * $k
  $glow.AddEllipse(32 * $k - $gr, 32 * $k - $gr, 2 * $gr, 2 * $gr)
  $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
  $pgb.CenterColor = [System.Drawing.Color]::FromArgb(150, 196, 181, 253)
  $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 139, 92, 246))
  $g.FillPath($pgb, $glow)

  # Back half of the ring (behind the disc).
  $ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 167, 139, 250)), ([Math]::Max(1.0, 2.2 * $k))
  $state = $g.Save()
  $g.TranslateTransform(32 * $k, 33 * $k); $g.RotateTransform(-14)
  $g.DrawArc($ringPen, -29 * $k, -6.5 * $k, 58 * $k, 13 * $k, 180, 180)
  $g.Restore($state)

  # Black disc with a white rim.
  $dr = 14 * $k
  $g.FillEllipse([System.Drawing.Brushes]::Black, 32 * $k - $dr, 32 * $k - $dr, 2 * $dr, 2 * $dr)
  $rim = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 237, 233, 254)), ([Math]::Max(1.0, 1.8 * $k))
  $g.DrawEllipse($rim, 32 * $k - $dr, 32 * $k - $dr, 2 * $dr, 2 * $dr)

  # Front half of the ring (in front of the disc).
  $state = $g.Save()
  $g.TranslateTransform(32 * $k, 33 * $k); $g.RotateTransform(-14)
  $g.DrawArc($ringPen, -29 * $k, -6.5 * $k, 58 * $k, 13 * $k, 0, 180)
  $g.Restore($state)

  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngs += , $ms.ToArray()
}

# ICO container with PNG-compressed entries (supported since Windows Vista).
$outDir = Split-Path $Out
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }
$fs = [System.IO.File]::Create($Out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $dim = if ($s -ge 256) { 0 } else { $s }
  $w.Write([Byte]$dim); $w.Write([Byte]$dim); $w.Write([Byte]0); $w.Write([Byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$len); $w.Write([UInt32]$offset)
  $offset += $len
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Close()

# Also keep a PNG preview of the largest size.
[System.IO.File]::WriteAllBytes(([IO.Path]::ChangeExtension($Out, '.png')), $pngs[0])
"Wrote $Out"
