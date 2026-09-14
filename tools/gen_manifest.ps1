# Generates manifest.js (window.RAVE_MANIFEST = {...}) for the RoomEditor fallback mode
# (no File System Access API, e.g. opened via file://). The object has the same "listings"
# shape that src/catalog.js buildCatalog() consumes, plus tpGamePathExists (absolute path -> bool)
# which the browser cannot probe itself.
param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$Out = (Join-Path (Split-Path -Parent $PSScriptRoot) 'manifest.js')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath (Join-Path $Root 'Saved Data\Rooms'))) { throw "not a RAVE folder (no Saved Data\Rooms): $Root" }

# A symlink whose target is gone is still listed by Get-ChildItem; treat it as absent (spec 7: "symlink resolves").
function Test-LinkResolves($item) {
  if (-not $item.LinkType) { return $true }
  $t = @($item.Target)[0]
  if (-not $t) { return $false }
  if (-not [IO.Path]::IsPathRooted($t)) { $t = Join-Path $item.DirectoryName $t }
  return [bool](Test-Path -LiteralPath $t)
}
# The leading comma keeps 0/1-element arrays from being unrolled into $null / a scalar on return.
function Get-FileNames([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return ,[string[]]@() }
  return ,[string[]]@(Get-ChildItem -LiteralPath $dir -File | Where-Object { Test-LinkResolves $_ } | ForEach-Object { $_.Name })
}
function Get-BaseNames([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return ,[string[]]@() }
  return ,[string[]]@(Get-ChildItem -LiteralPath $dir -File | ForEach-Object { $_.BaseName })
}
# Some launcher files sit at paths longer than MAX_PATH; retry with the \\?\ prefix, else skip (launcher becomes 'unknown').
function Read-TextFile([string]$path) {
  try { return [IO.File]::ReadAllText($path) } catch {}
  try { return [string](Get-Content -LiteralPath ('\\?\' + $path) -Raw -ErrorAction Stop) } catch {}
  Write-Warning "could not read (path too long?): $path"
  return $null
}

# UGC model names (basenames without .ugc)
$ugcNames = [string[]]@(Get-ChildItem -LiteralPath (Join-Path $Root 'Custom\UGC\Arcade') -File -Filter '*.ugc' | ForEach-Object { $_.BaseName })

# Per-system game files and the launcher text of every .win under Games\Arcade (Capture)*
$gameFiles = [ordered]@{}
$winTexts = [ordered]@{}
foreach ($sys in (Get-ChildItem -LiteralPath (Join-Path $Root 'Games') -Directory)) {
  $files = Get-FileNames $sys.FullName
  $gameFiles[$sys.Name] = $files
  if ($sys.Name -match '^Arcade \(Capture\)') {
    foreach ($f in $files) {
      if ($f -match '\.win$') {
        $rel = "Games\$($sys.Name)\$f"
        $txt = Read-TextFile (Join-Path $sys.FullName $f)
        if ($null -ne $txt) { $winTexts[$rel] = $txt }
      }
    }
  }
}

# TeknoParrot profiles: keep only the GamePath (full profile XML is several KB each) and
# record whether the absolute GamePath exists on disk.
$tpProfiles = [ordered]@{}
$tpExists = [ordered]@{}
$tpDir = Join-Path $Root 'Emulators\TeknoParrot\UserProfiles'
if (Test-Path -LiteralPath $tpDir) {
  foreach ($x in (Get-ChildItem -LiteralPath $tpDir -File -Filter '*.xml')) {
    $xml = [IO.File]::ReadAllText($x.FullName)
    $m = [regex]::Match($xml, '<GamePath>([\s\S]*?)</GamePath>')
    $gp = ''
    if ($m.Success) { $gp = $m.Groups[1].Value.Trim() }
    $tpProfiles[$x.BaseName] = "<GameProfile><GamePath>$gp</GamePath></GameProfile>"
    if ($gp -ne '' -and -not $tpExists.Contains($gp)) { $tpExists[$gp] = [bool](Test-Path -LiteralPath $gp) }
  }
}

# Daphne framefiles (relative to Emulators\Daphne, e.g. vldp\drugwars\drugwars.txt) so .win launchers can be verified.
$daphneDir = Join-Path $Root 'Emulators\Daphne'
$daphneFrames = [string[]]@()
$vldp = Join-Path $daphneDir 'vldp'
if (Test-Path -LiteralPath $vldp) {
  $daphneFrames = [string[]]@(Get-ChildItem -LiteralPath $vldp -File -Recurse -Filter '*.txt' | ForEach-Object { $_.FullName.Substring($daphneDir.Length).TrimStart('\') })
}

$manifest = [ordered]@{
  generated = (Get-Date).ToString('s')
  root = $Root
  ugcNames = $ugcNames
  gameFiles = $gameFiles
  winTexts = $winTexts
  tpProfiles = $tpProfiles
  tpGamePathExists = $tpExists
  daphneFrames = $daphneFrames
  m2Roms = Get-FileNames (Join-Path $Root 'Emulators\M2emulator\roms\RetroBat')
  m3Roms = Get-FileNames (Join-Path $Root 'Emulators\SuperModel 3\roms\RetroBat')
  videoNames = Get-BaseNames (Join-Path $Root 'Custom\Videos\Arcade')
}

$json = ConvertTo-Json -InputObject $manifest -Depth 6 -Compress
$text = "window.RAVE_MANIFEST = $json;`n"
[IO.File]::WriteAllText($Out, $text, (New-Object System.Text.UTF8Encoding $false))
$gameCount = 0; foreach ($k in $gameFiles.Keys) { $gameCount += $gameFiles[$k].Count }
"wrote $Out  models: $($ugcNames.Count)  systems: $($gameFiles.Count)  games: $gameCount  win: $($winTexts.Count)  tp: $($tpProfiles.Count)  videos: $($manifest.videoNames.Count)"
