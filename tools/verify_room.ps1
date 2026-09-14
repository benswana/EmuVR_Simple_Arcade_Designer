param([Parameter(Mandatory=$true)][string]$Path)
$b = [IO.File]::ReadAllBytes($Path); $t = [IO.File]::ReadAllText($Path)
$fail = @()
if ($b[0] -ne 0x7B) { $fail += ('first byte is {0:X2}, expected 7B (BOM?)' -f $b[0]) }
$nums = [regex]::Matches($t, '"embedded_screen":\s*(\d+)') | ForEach-Object { [int]$_.Groups[1].Value }
$set = @{}; $nums | ForEach-Object { $set[$_] = ($set[$_] + 1) }
$max = ($nums | Measure-Object -Maximum).Maximum
for ($i = 0; $i -le $max; $i++) { if ($set[$i] -ne 2) { $fail += "screen $i appears $($set[$i]) times" } }
$first = [regex]::Match($t, '"objects":\s*\[\s*\{\s*"embedded_screen":\s*0\s*\}')
if (-not $first.Success) { $fail += 'objects array does not start with { "embedded_screen": 0 }' }
try { $null = $t | ConvertFrom-Json } catch { $fail += "invalid JSON: $($_.Exception.Message)" }
$paths = [regex]::Matches($t, '"path": "([^"]+)"') | ForEach-Object { $_.Groups[1].Value.ToLower() }
$dupes = $paths | Group-Object | Where-Object { $_.Count -gt 1 }
"objects with id: $(([regex]::Matches($t,'"id":')).Count)  games: $($paths.Count)  screens: 0..$max  duplicate games: $($dupes.Count)"
if ($fail) { 'FAIL:'; $fail | ForEach-Object { '  ' + $_ }; exit 1 } else { 'OK'; exit 0 }
