export function normalizeName(s) {
  return String(s).replace(/^Arcade_/i, '').replace(/_[0-9a-f]{8}$/i, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function parseTpGamePath(xml) {
  const m = /<GamePath>([\s\S]*?)<\/GamePath>/.exec(xml || '');
  return m ? m[1].trim() : '';
}
const base = (f) => f.replace(/\.[^.]+$/, '');
export function buildCatalog(l) {
  const models = (l.ugcNames || []).map(n => ({ id: 'ugc_' + n, name: n, key: normalizeName(n) }));
  const games = [];
  for (const [system, files] of Object.entries(l.gameFiles || {}))
    for (const file of files) games.push({ path: `Games\\${system}\\${file}`, system, file, key: normalizeName(base(file)) });
  const tpProfiles = new Map(Object.entries(l.tpProfiles || {}).map(([n, x]) => [n, { gamePath: parseTpGamePath(x) }]));
  const lowerBase = (a) => new Set((a || []).map(x => base(x).toLowerCase()));
  return {
    models, games,
    winTexts: new Map(Object.entries(l.winTexts || {})),
    tpProfiles,
    m2Roms: lowerBase(l.m2Roms), m3Roms: lowerBase(l.m3Roms),
    videos: new Set((l.videoNames || []).map(v => v.toLowerCase())),
    // Daphne framefiles relative to Emulators\Daphne (e.g. vldp\drugwars\drugwars.txt); null = listing unavailable -> unknown
    daphneFrames: l.daphneFrames ? new Set(l.daphneFrames.map(p => p.replace(/\//g, '\\').replace(/^\.?\\/, '').toLowerCase())) : null,
    // true / false / null (null = not verifiable from here -> unknown)
    tpGamePathExists: l.tpGamePathExists || (() => true),
    fileExists: l.fileExists || (() => true),
  };
}
