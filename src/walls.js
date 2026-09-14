// Pure walls model: level outline placement, the level-outline gate and the user's traced walls (no DOM, no file I/O).
import { headingOf } from './quat.js';

const LEVEL_RE = /^ugc_Level_/i; // fallback only, for callers that have no set of level bundle ids

function levelObjects(room) {
  if (!room) return [];
  const objs = Array.isArray(room.objects) ? room.objects : [];
  const sys = Array.isArray(room.systems) ? room.systems : [];
  return [...objs, ...sys];
}

// "<Name>_<8 hex>" prefix of a Custom\UGC\Levels bundle file name -> the room object id ("ugc_<Name>_<hash>").
// Lazy on purpose: the "_[temp_level_stopgap_1234578a]" suffix also ends in 8 hex digits.
export function levelIdFromFile(file) {
  const m = /^(.*?_[0-9a-f]{8})(?![0-9A-Za-z])/.exec(String(file).split(/[\\/]/).pop());
  return m ? 'ugc_' + m[1] : null;
}

// Room objects (objects[] then systems[]) whose id is in `levelIds`, first occurrence of each id, in room order.
// The Levels folder also holds props (screens, shelves), so callers must still check each candidate's cache.
export function levelCandidates(room, levelIds) {
  const seen = new Set(), out = [];
  for (const o of levelObjects(room)) {
    if (o && typeof o.id === 'string' && levelIds.has(o.id) && !seen.has(o.id)) { seen.add(o.id); out.push(o); }
  }
  return out;
}

// The room's level model: the first object whose id is in `levelIds` (a Set of level bundle ids); without a set,
// the first id starting with ugc_Level_. Searched in objects then systems.
export function levelObjectOf(room, levelIds) {
  if (levelIds) return levelCandidates(room, levelIds)[0] || null;
  return levelObjects(room).find(o => o && typeof o.id === 'string' && LEVEL_RE.test(o.id)) || null;
}
export function levelIdOf(room, levelIds) {
  const o = levelObjectOf(room, levelIds);
  return o ? o.id : null;
}

// "ugc_Level_Entertainment_Arcade_9e2f95d3" -> "Entertainment Arcade".
export function levelDisplayName(id) {
  return String(id).replace(/^ugc_(Level_)?/i, '').replace(/_[0-9a-f]{8}$/i, '').replace(/_/g, ' ');
}

// ---- Which level outlines may be drawn (shared by tools/extract_walls.mjs and the app). ----
// A count of cabinets "inside" an outline cannot judge it: the outline is a slice through thick, often open collider
// geometry, and on the real rooms every inside test tried (even-odd on one or four rays, flood-filled enclosure)
// scored correct outlines low and mirrored ones high. Alignment is reviewed by eye with tools/render_walls.mjs, and
// tests/unity_gate.test.js checks Slot 6 against displaced copies. Drawing needs a sane outline and a placement the
// 2D plan can show faithfully.

export const MIN_SEGMENTS = 4;
export const MIN_SPAN = 5; // metres, on both axes

// EmuVR's level conversion names level bundles "<Name>_<8 hex>_[temp_level_stopgap_...].ugc"; props kept in the same
// Custom\UGC\Levels folder (Blockbuster screens and shelves) have no stopgap suffix.
export function isLevelBundleFile(file) {
  return /\[temp_level_stopgap_[0-9a-f]+\]\.ugc$/i.test(String(file)) && levelIdFromFile(file) !== null;
}

export function outlineCheck(outline) {
  const segments = (outline && Array.isArray(outline.segments)) ? outline.segments : [];
  const reasons = [];
  if (segments.length < MIN_SEGMENTS) reasons.push(`${segments.length} segments < ${MIN_SEGMENTS}`);
  const b = wallBounds([segments]);
  if (!b || b.maxX - b.minX < MIN_SPAN || b.maxZ - b.minZ < MIN_SPAN) reasons.push(`outline spans less than ${MIN_SPAN} m`);
  return { ok: reasons.length === 0, reasons };
}

const scaleIsOne = (s) => s === undefined || s === null ||
  (Number.isFinite(s) ? Math.abs(s - 1) <= 1e-6 : typeof s === 'object' && ['x', 'y', 'z'].every(k => Number.isFinite(s[k]) && Math.abs(s[k] - 1) <= 1e-6));
const rotationIsYaw = (q) => !q || (Math.abs(q.x || 0) <= 1e-3 && Math.abs(q.z || 0) <= 1e-3);

// The level object's own placement: a scaled level (Blockbuster in Slot 10 is at scale 75) or a tilted one cannot be
// drawn as a floor plan that matches what EmuVR shows, so it is reported instead.
export function placementCheck(levelObj) {
  const lo = levelObj || {};
  const reasons = [];
  if (!scaleIsOne(lo.scale)) reasons.push(`level is scaled ${Number.isFinite(lo.scale) ? 'x' + lo.scale : JSON.stringify(lo.scale)} in this room`);
  if (!rotationIsYaw(lo.rotation)) reasons.push('level is tilted in this room');
  return { ok: reasons.length === 0, reasons };
}

// Whether a level cache may be drawn for the room object `levelObj` that places it.
export function levelWallsFit(json, levelObj) {
  if (!json || !Array.isArray(json.segments)) return { ok: false, reason: 'level outline cache is unreadable' };
  const o = outlineCheck(json);
  if (!o.ok) return { ok: false, reason: 'level outline cache is too small' };
  const p = placementCheck(levelObj);
  if (!p.ok) return { ok: false, reason: p.reasons[0] };
  return { ok: true, reason: null };
}

// Level-local segments [x1,z1,x2,z2] -> room space: scale, then yaw (Unity Y-up, forward = (sin t, cos t)), then position.
// Missing position/rotation/scale are identity. A vector scale uses its x and z components.
export function transformOutline(segments, levelObj) {
  const lo = levelObj || {};
  const p = lo.position || {};
  const px = Number.isFinite(p.x) ? p.x : 0, pz = Number.isFinite(p.z) ? p.z : 0;
  let sx = 1, sz = 1;
  if (Number.isFinite(lo.scale)) { sx = sz = lo.scale; }
  else if (lo.scale && typeof lo.scale === 'object') {
    sx = Number.isFinite(lo.scale.x) ? lo.scale.x : 1;
    sz = Number.isFinite(lo.scale.z) ? lo.scale.z : 1;
  }
  const t = lo.rotation ? headingOf(lo.rotation) : 0;
  const c = Math.cos(t), s = Math.sin(t);
  const map = (x, z) => {
    const lx = x * sx, lz = z * sz;
    return [px + lx * c + lz * s, pz - lx * s + lz * c];
  };
  return (segments || []).map(([x1, z1, x2, z2]) => [...map(x1, z1), ...map(x2, z2)]);
}

// Bounds over a list of segment arrays (null/empty entries ignored); null when there are no segments.
export function wallBounds(segmentsList) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const segs of segmentsList || []) {
    for (const seg of segs || []) {
      const [x1, z1, x2, z2] = seg;
      for (const [x, z] of [[x1, z1], [x2, z2]]) {
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }
  return minX === Infinity ? null : { minX, maxX, minZ, maxZ };
}

// ---- Traced walls. A trace is { runs: [[[x,z],...], ...], current: [[x,z],...] }; every op returns a new trace. ----

export function emptyTrace() { return { runs: [], current: [] }; }

const snapTo = (v, step) => {
  if (!(step > 0)) return v + 0;
  return Number((Math.round(v / step) * step).toFixed(10)) + 0; // toFixed strips float noise like 5.000000000000001
};

// Add a corner snapped to `snap` metres; axisLock keeps it horizontal or vertical from the previous corner.
export function addCorner(trace, x, z, { snap = 0.1, axisLock = false } = {}) {
  const cur = trace.current || [];
  let nx = snapTo(x, snap), nz = snapTo(z, snap);
  if (axisLock && cur.length) {
    const [lx, lz] = cur[cur.length - 1];
    if (Math.abs(x - lx) >= Math.abs(z - lz)) nz = lz; else nx = lx;
  }
  return { runs: trace.runs || [], current: [...cur, [nx, nz]] };
}

// Finish the in-progress run as drawn (open-ended; no segment back to the first corner). Runs of < 2 corners are dropped.
export function closeRun(trace) {
  const cur = trace.current || [];
  const runs = trace.runs || [];
  return { runs: cur.length >= 2 ? [...runs, cur] : runs, current: [] };
}

export function removeLastCorner(trace) {
  return { runs: trace.runs || [], current: (trace.current || []).slice(0, -1) };
}

const runSegments = (run) => {
  const out = [];
  for (let i = 1; i < run.length; i++) out.push([run[i - 1][0], run[i - 1][1], run[i][0], run[i][1]]);
  return out;
};

// Segments of the finished runs only; the in-progress run (trace.current) is drawn separately by the plan.
export function traceSegments(trace) {
  return (trace && trace.runs ? trace.runs : []).flatMap(runSegments);
}

// File format: { "slot", "runs": [[[x,z],...], ...] }. An unfinished run with >= 2 corners is saved as a run too.
export function serializeTrace(slot, trace) {
  const runs = [...(trace.runs || [])];
  if (trace.current && trace.current.length >= 2) runs.push(trace.current);
  return JSON.stringify({ slot, runs });
}

export function parseTrace(text) {
  if (typeof text === 'string' && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const raw = JSON.parse(text);
  const runs = (raw && Array.isArray(raw.runs) ? raw.runs : [])
    .filter(Array.isArray)
    .map(run => run.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, z]) => [x, z]))
    .filter(run => run.length >= 2);
  return { runs, current: [] };
}
