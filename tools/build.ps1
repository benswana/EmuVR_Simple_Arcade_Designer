# Builds RoomEditor.html: index.html with the module <script> replaced by one inline classic
# script that contains every src/*.js module (imports removed, export keywords stripped) in
# dependency order, followed by the page's own bootstrap lines (canvas sizing + startApp).
param(
  [string]$Out = (Join-Path (Split-Path -Parent $PSScriptRoot) 'RoomEditor.html')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$order = @('quat.js', 'controlsMath.js', 'planGeom.js', 'modelShape.js', 'undo.js', 'roomModel.js', 'catalog.js', 'linking.js', 'hints.js', 'walls.js', 'fs.js', 'plan.js', 'panel.js', 'app.js')

function Strip-Module([string]$text) {
  $kept = New-Object System.Collections.Generic.List[string]
  foreach ($ln in ($text -split "`r?`n")) {
    if ($ln -match '^\s*import .*;\s*$') { continue }
    $kept.Add(($ln -replace '^export (default )?', ''))
  }
  return ($kept -join "`n").TrimEnd()
}

$parts = New-Object System.Collections.Generic.List[string]
$parts.Add('// Built by tools/build.ps1 from index.html + src/*.js - do not edit; edit the sources and rebuild.')
foreach ($f in $order) {
  $src = Join-Path $root "src\$f"
  if (-not (Test-Path -LiteralPath $src)) { throw "missing module: $src" }
  $parts.Add("// ---- src/$f ----")
  $parts.Add((Strip-Module ([IO.File]::ReadAllText($src))))
}

$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'))
$m = [regex]::Match($html, '<script type="module">([\s\S]*?)</script>')
if (-not $m.Success) { throw 'index.html has no <script type="module"> block' }
$parts.Add('// ---- index.html bootstrap ----')
$parts.Add((Strip-Module $m.Groups[1].Value))
if (($m.Groups[1].Value -split "`r?`n" | Where-Object { $_ -match 'startApp\(document\)' }).Count -eq 0) { $parts.Add('startApp(document);') }

$inline = "<script>`n" + ($parts -join "`n") + "`n</script>"
# String surgery rather than -replace: the JS contains $-sequences that a replacement pattern would interpret.
$result = $html.Substring(0, $m.Index) + $inline + $html.Substring($m.Index + $m.Length)
[IO.File]::WriteAllText($Out, $result, (New-Object System.Text.UTF8Encoding $false))
"wrote $Out  ($($result.Length) chars, $($order.Count) modules inlined)"
