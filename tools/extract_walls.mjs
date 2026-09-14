// Level wall outlines: decode a UGC level bundle's colliders, slice them 1 m above the level's floor, and cache
// every sane outline as walls/levels/<levelId>.json in level-local metres (the space the room's level object
// transforms). Alignment with the rooms is reviewed by eye: node tools/render_walls.mjs
//
//   node tools/extract_walls.mjs --all
//   node tools/extract_walls.mjs --level ugc_Level_Entertainment_Arcade_9e2f95d3
//   node tools/extract_walls.mjs --level "<file>.ugc" --rooms "<EmuVR folder>\Saved Data\Rooms"
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBundle } from './unity/bundle.mjs';
import { parseSerialized } from './unity/serialized.mjs';
import { levelColliderTriangles, trsMatrix } from './unity/scene.mjs';
import { sliceTriangles, snapMerge, boundsOf } from './unity/slice.mjs';
import { levelIdFromFile, isLevelBundleFile, outlineCheck, MIN_SEGMENTS, MIN_SPAN } from '../src/walls.js';

export { levelIdFromFile, isLevelBundleFile, outlineCheck, MIN_SEGMENTS, MIN_SPAN };

// The editor lives in <EmuVR folder>\RoomEditor, so the EmuVR folder is two levels above tools\ (EMUVR_DIR overrides).
export const EMUVR_DIR = process.env.EMUVR_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEVELS_DIR = join(EMUVR_DIR, 'Custom', 'UGC', 'Levels');
export const ROOMS_DIR = join(EMUVR_DIR, 'Saved Data', 'Rooms');
export const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'walls', 'levels');

export const SLICE_ABOVE_FLOOR = 1.0; // metres
export const FLOOR_PERCENTILE = 0.05; // floor height = this percentile of collider vertex heights
export const SNAP = 0.01;             // metres

const CLASS_GAME_OBJECT = 1, CLASS_TRANSFORM = 4, CLASS_ASSET_BUNDLE = 142, CLASS_RECT_TRANSFORM = 224;
const fileName = (p) => String(p).split(/[\\/]/).pop();

// Inverse of a 3x4 row-major affine matrix (the trsMatrix layout).
export function affineInverse(m) {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m;
  const c00 = e * i - f * h, c01 = c * h - b * i, c02 = b * f - c * e;
  const c10 = f * g - d * i, c11 = a * i - c * g, c12 = c * d - a * f;
  const c20 = d * h - e * g, c21 = b * g - a * h, c22 = a * e - b * d;
  const det = a * c00 + b * c10 + c * c20;
  if (!det || !Number.isFinite(det)) throw new Error('singular transform');
  const r = [c00 / det, c01 / det, c02 / det, 0, c10 / det, c11 / det, c12 / det, 0, c20 / det, c21 / det, c22 / det, 0];
  r[3] = -(r[0] * tx + r[1] * ty + r[2] * tz);
  r[7] = -(r[4] * tx + r[5] * ty + r[6] * tz);
  r[11] = -(r[8] * tx + r[9] * ty + r[10] * tz);
  return r;
}

function transformPoints(xyz, m) {
  for (let k = 0; k + 2 < xyz.length; k += 3) {
    const x = xyz[k], y = xyz[k + 1], z = xyz[k + 2];
    xyz[k] = m[0] * x + m[1] * y + m[2] * z + m[3];
    xyz[k + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    xyz[k + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
}

// Floor height of a triangle soup: the given percentile of all vertex heights; null when empty.
export function floorHeight(tris, q = FLOOR_PERCENTILE) {
  const n = Math.floor(tris.length / 3);
  if (!n) return null;
  const ys = new Float64Array(n);
  for (let v = 0; v < n; v++) ys[v] = tris[v * 3 + 1];
  ys.sort();
  return ys[Math.min(n - 1, Math.floor(q * n))];
}

// The prefab's root Transform: the GameObject named by the AssetBundle container, else the only root.
function prefabRoot(sf) {
  const local = (p) => !!p && p.m_FileID === 0 && p.m_PathID !== 0n && sf.objects.has(p.m_PathID);
  const classOf = (p) => (local(p) ? sf.objects.get(p.m_PathID).classID : -1);
  const transformOf = (goId) => {
    for (const c of sf.readObject(goId).m_Component || []) {
      const k = classOf(c.component);
      if (k === CLASS_TRANSFORM || k === CLASS_RECT_TRANSFORM) return c.component.m_PathID;
    }
    return null;
  };
  const describe = (tid, via) => {
    const t = sf.readObject(tid);
    if (local(t.m_Father)) return null;
    const name = local(t.m_GameObject) ? sf.readObject(t.m_GameObject.m_PathID).m_Name : '';
    return { name, position: t.m_LocalPosition, rotation: t.m_LocalRotation, scale: t.m_LocalScale, via };
  };
  for (const ab of sf.byClass(CLASS_ASSET_BUNDLE)) {
    for (const entry of sf.readObject(ab.pathID).m_Container || []) {
      const asset = entry && entry.second && entry.second.asset;
      if (classOf(asset) !== CLASS_GAME_OBJECT) continue;
      const tid = transformOf(asset.m_PathID);
      const root = tid === null ? null : describe(tid, 'container');
      if (root) return root;
    }
  }
  const roots = [...sf.byClass(CLASS_TRANSFORM), ...sf.byClass(CLASS_RECT_TRANSFORM)].filter(o => !local(sf.readObject(o.pathID).m_Father));
  return roots.length === 1 ? describe(roots[0].pathID, 'only-root') : null;
}

// Level bundle -> { levelId, source, sliceY, segments: [[x1,z1,x2,z2]...], bounds, stats } in level-local metres.
export function extractLevel(bundlePath) {
  const bundle = openBundle(bundlePath);
  let tris, colliderStats, root;
  try {
    const serialized = bundle.nodes.filter(n => !/\.(resS|resource)$/i.test(n.path));
    if (serialized.length !== 1) throw new Error(`expected one SerializedFile in the bundle, found ${serialized.length}`);
    const node = serialized[0];
    const sf = parseSerialized(bundle.readNode(node.path));
    const res = bundle.nodes.find(n => n.path === node.path + '.resS');
    ({ tris, stats: colliderStats } = levelColliderTriangles(sf, res ? bundle.readNode(res.path) : null));
    root = prefabRoot(sf);
  } finally {
    bundle.close();
  }
  // EmuVR spawns the prefab with its root at the room's level object, replacing the root's own stored
  // transform, so level space is the root's local space (Entertainment Arcade's root sits at 20.86, 3.006, 5.957).
  if (root) transformPoints(tris, affineInverse(trsMatrix(root.position, root.rotation, root.scale)));
  const floorY = floorHeight(tris);
  const sliceY = floorY === null ? null : Math.round((floorY + SLICE_ABOVE_FLOOR) * 1000) / 1000;
  const raw = sliceY === null ? [] : sliceTriangles(tris, sliceY);
  const segments = snapMerge(raw, SNAP);
  return {
    levelId: levelIdFromFile(bundlePath),
    source: fileName(bundlePath),
    sliceY,
    segments,
    bounds: segments.length ? boundsOf(segments) : null,
    stats: { ...colliderStats, root, floorY: floorY === null ? null : Math.round(floorY * 1000) / 1000 + 0, rawSegments: raw.length },
  };
}

// Cache an outline only when it is sane (enough segments, spanning a room-sized area).
export function cacheDecision(outline) {
  const c = outlineCheck(outline);
  return { write: c.ok, status: c.ok ? 'WRITTEN' : 'REJECTED', reasons: c.reasons };
}

// ---- CLI ----

const USAGE = 'usage: node tools/extract_walls.mjs (--all | --level <idOrFile> [--level ...]) [--rooms "<Saved Data\\Rooms>"]';

function parseArgs(argv) {
  const opts = { all: false, levels: [], rooms: ROOMS_DIR, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--all') opts.all = true;
    else if (a === '--level') opts.levels.push(value());
    else if (a === '--rooms') opts.rooms = value();
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return opts;
}

function resolveLevel(arg, files) {
  for (const p of [arg, join(LEVELS_DIR, arg)]) if (existsSync(p) && statSync(p).isFile()) return resolve(p);
  const want = arg.replace(/^ugc_/i, '').toLowerCase();
  const hits = want ? files.filter(f => (levelIdFromFile(f) || '').slice(4).toLowerCase() === want) : [];
  if (hits.length !== 1) throw new Error(hits.length ? `"${arg}" matches ${hits.length} level files` : `no level bundle for "${arg}" in ${LEVELS_DIR}`);
  return hits[0];
}

// Rooms are only reported (which rooms use each level), so an unreadable room is a warning.
function loadRooms(dir) {
  const slotNo = (f) => Number(/\d+/.exec(f)[0]);
  const rooms = [];
  for (const f of readdirSync(dir).filter(f => /^Slot\d+\.json$/i.test(f)).sort((a, b) => slotNo(a) - slotNo(b))) {
    try {
      let text = readFileSync(join(dir, f), 'utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const json = JSON.parse(text);
      const ids = new Set();
      for (const o of [...(json.objects || []), ...(json.systems || [])]) if (o && typeof o.id === 'string') ids.add(o.id);
      rooms.push({ name: f.replace(/\.json$/i, ''), ids });
    } catch (e) {
      console.warn(`warning: skipped room ${f}: ${e.message}`);
    }
  }
  return rooms;
}

// UTF-8 JSON, one segment per line.
function cacheText(outline, usedBy) {
  const head = JSON.stringify({ levelId: outline.levelId, source: outline.source, sliceY: outline.sliceY, usedBy }, null, 2);
  const segments = '[\n' + outline.segments.map(s => '    ' + JSON.stringify(s)).join(',\n') + '\n  ]';
  return head.slice(0, -2) +
    ',\n  "segments": ' + segments +
    ',\n  "bounds": ' + JSON.stringify(outline.bounds) +
    ',\n  "stats": ' + JSON.stringify(outline.stats, null, 2).replace(/\n/g, '\n  ') + '\n}\n';
}

function processLevel(file, rooms) {
  const levelId = levelIdFromFile(file);
  const row = { levelId: levelId || fileName(file), segs: '-', usedBy: '-', status: '' };
  if (!levelId) { row.status = 'SKIPPED (file name has no <Name>_<8-hex> id)'; return row; }
  const target = join(CACHE_DIR, levelId + '.json');
  const dropStale = () => { if (existsSync(target)) { rmSync(target); row.status += ' (stale cache removed)'; } };
  if (!isLevelBundleFile(file)) { row.status = 'SKIPPED (prop, not a level bundle)'; dropStale(); return row; }
  const usedBy = rooms.filter(r => r.ids.has(levelId)).map(r => r.name);
  row.usedBy = usedBy.join(' ') || 'no room';
  let outline;
  try { outline = extractLevel(file); }
  catch (e) { row.status = 'ERROR: ' + e.message; dropStale(); return row; }
  row.segs = outline.segments.length;
  const decision = cacheDecision(outline);
  row.status = decision.status + (decision.reasons.length ? ` [${decision.reasons.join('; ')}]` : '');
  if (decision.write) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(target, cacheText(outline, usedBy));
  } else {
    dropStale();
  }
  return row;
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(e.message + '\n' + USAGE); return 2; }
  if (opts.help) { console.log(USAGE); return 0; }
  if (!opts.all && !opts.levels.length) { console.error(USAGE); return 2; }
  let files, rooms;
  try {
    const all = readdirSync(LEVELS_DIR).filter(f => /\.ugc$/i.test(f)).sort((a, b) => a.localeCompare(b)).map(f => join(LEVELS_DIR, f));
    files = opts.levels.length ? opts.levels.map(a => resolveLevel(a, all)) : all;
    rooms = loadRooms(opts.rooms);
  } catch (e) { console.error(e.message); return 1; }
  const t0 = Date.now();
  console.log(`levels: ${files.length} | rooms: ${rooms.length} (${opts.rooms}) | cache: ${CACHE_DIR}`);
  console.log('level | segs | used by | result');
  const tally = new Map();
  for (const file of files) {
    const r = processLevel(file, rooms);
    console.log(`${r.levelId} | ${r.segs} | ${r.usedBy} | ${r.status}`);
    const key = r.status.startsWith('ERROR') ? 'ERROR' : r.status.replace(/ [([].*$/, '');
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  console.log(`totals: ${[...tally.entries()].map(([k, v]) => `${k} ${v}`).join(', ')} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('review alignment with: node tools/render_walls.mjs');
  return tally.has('ERROR') ? 1 : 0;
}

const invokedDirectly = import.meta.main ?? (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url);
if (invokedDirectly) process.exitCode = main();
