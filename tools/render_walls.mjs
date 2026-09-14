// Visual review of level walls: every room that places a cached level is drawn with its walls exactly as the app
// places them (grey; red when the app would refuse to draw them), cabinets (green on the floor, blue raised) and
// decor (amber), on contact sheets rendered by headless Chrome. Run after tools/extract_walls.mjs.
//
//   node tools/render_walls.mjs [--rooms "<Saved Data\Rooms>"] [--out <dir>]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_DIR, ROOMS_DIR } from './extract_walls.mjs';
import { levelCandidates, levelWallsFit, levelDisplayName, transformOutline } from '../src/walls.js';
import { footprint } from '../src/modelShape.js';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

//   --slot N (repeatable) renders only those rooms; --cell / --cols / --per set the sheet layout.
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const roomsDir = arg('--rooms', ROOMS_DIR), outDir = arg('--out', join(tmpdir(), 'roomeditor-walls-review'));
const CELL = Number(arg('--cell', '640')), COLS = Number(arg('--cols', '3')), PER_SHEET = Number(arg('--per', '6'));
const onlySlots = new Set(argv.flatMap((a, i) => (a === '--slot' && i + 1 < argv.length ? [String(argv[i + 1])] : [])));
// Model footprints and front dots, drawn exactly as the plan draws them (tools/extract_models.mjs).
const MODELS_INDEX = join(CACHE_DIR, '..', '..', 'models', 'index.json');
const models = existsSync(MODELS_INDEX) ? JSON.parse(readFileSync(MODELS_INDEX, 'utf8')).models : {};

const cached = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).filter(f => /\.json$/i.test(f)).map(f => f.replace(/\.json$/i, '')) : [];
if (!cached.length) { console.error(`no level caches in ${CACHE_DIR}: run node tools/extract_walls.mjs --all first`); process.exit(1); }
const caches = new Map(cached.map(id => [id, JSON.parse(readFileSync(join(CACHE_DIR, id + '.json'), 'utf8'))]));

const cells = [];
const slotNo = (f) => Number(/\d+/.exec(f)[0]);
for (const f of readdirSync(roomsDir).filter(n => /^Slot\d+\.json$/i.test(n)).sort((a, b) => slotNo(a) - slotNo(b))) {
  if (onlySlots.size && !onlySlots.has(String(slotNo(f)))) continue;
  let room;
  try { room = JSON.parse(readFileSync(join(roomsDir, f), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { console.warn(`skipped ${f}: ${e.message}`); continue; }
  const cands = levelCandidates(room, new Set(cached));
  if (!cands.length) { console.log(`${f}: no cached level`); continue; }
  const lo = cands.find(c => levelWallsFit(caches.get(c.id), c).ok) || cands[0];
  const fit = levelWallsFit(caches.get(lo.id), lo);
  const segs = transformOutline(caches.get(lo.id).segments, lo);
  const cabs = (room.systems || []).filter(o => o.position).map(o => [o.position.x, o.position.z, o.position.y]);
  const decor = (room.objects || []).filter(o => o.position && o.id).map(o => [o.position.x, o.position.z]);
  const shapes = (room.systems || []).filter(o => o.position).map(o => footprint(o, models[o.id])).filter(Boolean);
  const title = `${f.replace(/\.json$/i, '')} ${levelDisplayName(lo.id)} segs=${segs.length} cabs=${cabs.length}${fit.ok ? '' : ' NOT DRAWN: ' + fit.reason}`;
  console.log(title);
  cells.push({ title, segs, cabs, decor, shapes, ok: fit.ok });
}

function cellSvg(c) {
  const xs = [...c.segs.flatMap(s => [s[0], s[2]]), ...c.cabs.map(v => v[0])], zs = [...c.segs.flatMap(s => [s[1], s[3]]), ...c.cabs.map(v => v[1])];
  const minX = Math.min(...xs) - 2, maxX = Math.max(...xs) + 2, minZ = Math.min(...zs) - 2, maxZ = Math.max(...zs) + 2;
  const k = (CELL - 30) / Math.max(maxX - minX, maxZ - minZ), X = x => ((x - minX) * k).toFixed(1), Z = z => (26 + (maxZ - z) * k).toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}"><rect width="100%" height="100%" fill="#0d1117" stroke="#30363d"/>`;
  s += `<g stroke="${c.ok ? '#c9d1d9' : '#f85149'}" stroke-width="1">` + c.segs.map(g => `<line x1="${X(g[0])}" y1="${Z(g[1])}" x2="${X(g[2])}" y2="${Z(g[3])}"/>`).join('') + '</g>';
  s += c.decor.map(d => `<circle cx="${X(d[0])}" cy="${Z(d[1])}" r="2" fill="#d29922"/>`).join('');
  s += c.cabs.map(v => `<circle cx="${X(v[0])}" cy="${Z(v[1])}" r="1.5" fill="${v[2] > 0.5 ? '#58a6ff' : '#3fb950'}"/>`).join('');
  s += c.shapes.map(f => `<polygon points="${f.corners.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="none" stroke="#3fb950" stroke-width="0.8"/>`).join('');
  s += c.shapes.filter(f => f.frontMid).map(f => `<circle cx="${X(f.frontMid[0])}" cy="${Z(f.frontMid[1])}" r="2.2" fill="#ffffff"/>`).join('');
  return s + `<text x="8" y="18" fill="#c9d1d9" font-family="Segoe UI" font-size="14">${esc(c.title)}</text></svg>`;
}

mkdirSync(outDir, { recursive: true });
for (let p = 0; p * PER_SHEET < cells.length; p++) {
  const page = cells.slice(p * PER_SHEET, (p + 1) * PER_SHEET), rows = Math.ceil(page.length / COLS);
  const html = `<html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${COLS},${CELL}px)">${page.map(cellSvg).join('')}</body></html>`;
  const htmlPath = join(outDir, `walls_sheet${p + 1}.html`), png = join(outDir, `walls_sheet${p + 1}.png`);
  writeFileSync(htmlPath, html);
  const profile = mkdtempSync(join(tmpdir(), 'roomeditor-walls-'));
  try {
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--hide-scrollbars',
      `--window-size=${CELL * COLS},${CELL * rows}`, `--screenshot=${png}`, 'file:///' + htmlPath.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 90000 });
  } finally {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile briefly */ }
  }
  console.log('sheet', png);
}
