param([int]$Port = 8765)
$root = Split-Path -Parent $PSScriptRoot
$types = @{ '.html'='text/html'; '.js'='text/javascript'; '.json'='application/json'; '.css'='text/css'; '.png'='image/png'; '.ico'='image/x-icon' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "RoomEditor serving $root at http://localhost:$Port/index.html  (Ctrl+C to stop)"
while ($l.IsListening) {
  $ctx = $l.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/')); if ($rel -eq '') { $rel = 'index.html' }
  $path = Join-Path $root $rel
  if ((Test-Path -LiteralPath $path) -and -not (Get-Item -LiteralPath $path).PSIsContainer) {
    $bytes = [IO.File]::ReadAllBytes($path); $ext = [IO.Path]::GetExtension($path).ToLower()
    $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store') # a rebuilt editor or re-extracted model index is always picked up
    $res.ContentLength64 = $bytes.Length; $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $res.StatusCode = 404 }
  $res.OutputStream.Close()
}
