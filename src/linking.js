import { normalizeName } from './catalog.js';
const baseOf = (p) => p.split('\\').pop().replace(/\.[^.]+$/, '');

export function launchability(path, c) {
  // EmuVR names a game inside an archive as "<archive>.zip#<member>"; the file on disk is the archive.
  if (!c.fileExists(path.split('#')[0])) return { status: 'dead', reason: 'file not found' };
  if (!/\.win$/i.test(path)) return { status: 'live', reason: 'file present' };
  const w = c.winTexts.get(path) || '';
  let m;
  if ((m = /--profile=([^\s"]+)\.xml/.exec(w))) {
    const prof = c.tpProfiles.get(m[1]);
    if (!prof) return { status: 'dead', reason: `TeknoParrot profile ${m[1]}.xml missing` };
    if (!prof.gamePath) return { status: 'dead', reason: 'TeknoParrot game location not set' };
    const ok = c.tpGamePathExists(prof.gamePath);
    if (ok === false) return { status: 'dead', reason: 'TeknoParrot game file missing' };
    if (ok === null || ok === undefined) return { status: 'unknown', reason: 'TeknoParrot game file not verifiable from the browser' };
    return { status: 'live', reason: `TeknoParrot ${m[1]}` };
  }
  if ((m = /emulator_multicpu\.exe\s+(\w+)/i.exec(w))) return c.m2Roms.has(m[1].toLowerCase()) ? { status: 'live', reason: 'Model2 rom owned' } : { status: 'dead', reason: `Model2 rom ${m[1]} not owned` };
  if ((m = /supermodel.*roms\\(\w+)\.zip/i.exec(w))) return c.m3Roms.has(m[1].toLowerCase()) ? { status: 'live', reason: 'Model3 rom owned' } : { status: 'dead', reason: `Model3 rom ${m[1]} not owned` };
  if (/daphne/i.test(w)) {
    const f = /-framefile\s+"?([^"\s]+)/i.exec(w);
    if (!f) return { status: 'unknown', reason: 'Daphne launcher has no -framefile' };
    if (!c.daphneFrames) return { status: 'unknown', reason: 'Daphne framefile not verifiable (no listing)' };
    const rel = f[1].replace(/\//g, '\\').replace(/^\.?\\/, '');
    return c.daphneFrames.has(rel.toLowerCase()) ? { status: 'live', reason: 'Daphne framefile present' } : { status: 'dead', reason: `Daphne framefile ${rel} missing` };
  }
  return { status: 'unknown', reason: 'launcher type not recognised' };
}
export function launchableGames(c, { includeUnknown = false } = {}) {
  return c.games.filter(g => { const s = launchability(g.path, c).status; return s === 'live' || (includeUnknown && s === 'unknown'); });
}
// Keys are compared both as-is and with spaces removed so that "pac man" (model) matches "pacman" (rom file).
const squash = (s) => s.replace(/\s+/g, '');
const score = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 3;
  const sa = squash(a), sb = squash(b);
  if (sa === sb) return 3;
  if (a.startsWith(b) || b.startsWith(a) || sa.startsWith(sb) || sb.startsWith(sa)) return 2;
  const ta = new Set(a.split(' '));
  return b.split(' ').some(t => ta.has(t)) ? 1 : 0;
};
export function suggestGamesForModel(modelId, c) {
  const k = normalizeName(modelId.replace(/^ugc_/, ''));
  return c.games.map(g => [score(g.key, k), g]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).map(x => x[1]);
}
export function suggestModelsForGame(path, c) {
  const k = normalizeName(baseOf(path));
  return c.models.map(m => [score(m.key, k), m]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).map(x => x[1]);
}
export function hasAttractVideo(path, c) { return c.videos.has(baseOf(path).toLowerCase()); }
