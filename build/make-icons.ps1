# Draws the Waypoint diamond (v0.1 favicon) as PNGs and packs build/icon.ico. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File build\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "."
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $s / 32.0
  $pts = @(
    (New-Object System.Drawing.PointF (16 * $k), (2 * $k)),
    (New-Object System.Drawing.PointF (30 * $k), (16 * $k)),
    (New-Object System.Drawing.PointF (16 * $k), (30 * $k)),
    (New-Object System.Drawing.PointF (2 * $k), (16 * $k))
  )
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0x6d, 0x4f, 0xd8))
  $g.FillPolygon($brush, $pts)
  $r = 5 * $k
  $g.FillEllipse([System.Drawing.Brushes]::White, (16 * $k - $r), (16 * $k - $r), (2 * $r), (2 * $r))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += , $ms.ToArray()
  if ($s -eq 256) { $bmp.Save((Join-Path $out "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}
# ICO with PNG-compressed entries (Windows Vista and later).
$fs = [System.IO.File]::Create((Join-Path $out "icon.ico"))
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([Byte]$b); $bw.Write([Byte]$b); $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()
Write-Output "icon.png + icon.ico written to $out"
