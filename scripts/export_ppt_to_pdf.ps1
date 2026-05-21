param(
  [Parameter(Mandatory = $true)]
  [string]$PptxPath,
  [string]$PdfPath
)

$ErrorActionPreference = "Stop"

$resolvedPptx = (Resolve-Path $PptxPath).Path
if (-not $PdfPath) {
  $PdfPath = [System.IO.Path]::ChangeExtension($resolvedPptx, ".pdf")
}
$resolvedPdf = [System.IO.Path]::GetFullPath($PdfPath)

$pp = $null
$pres = $null

try {
  $pp = New-Object -ComObject PowerPoint.Application
  $pp.Visible = -1
  $pres = $pp.Presentations.Open($resolvedPptx, $false, $false, $false)

  # 32 = ppSaveAsPDF
  $pres.SaveAs($resolvedPdf, 32)
  Write-Output "[DONE] wrote $resolvedPdf"
}
finally {
  if ($pres -ne $null) {
    $pres.Close()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($pres) | Out-Null
  }
  if ($pp -ne $null) {
    $pp.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($pp) | Out-Null
  }
}
