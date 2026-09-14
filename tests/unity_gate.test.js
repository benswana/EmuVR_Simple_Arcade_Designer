import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { extractLevel, levelIdFromFile, affineInverse, floorHeight, cacheDecision } from '../tools/extract_walls.mjs';
import { trsMatrix, mulMatrix } from '../tools/unity/scene.mjs';
import { transformOutline, levelObjectOf } from '../src/walls.js';
const P = 'F:\\games\\RAVE\\Custom\\UGC\\Levels\\Level_Entertainment_Arcade_9e2f95d3 _[temp_level_stopgap_1234578a].ugc';
const S6 = 'F:\\games\\RAVE\\Saved Data\\Rooms\\Slot6.json';

let eaOutline; const ea = () => (eaOutline ??= extractLevel(P));

test('Entertainment Arcade is extracted in its prefab root space and sliced 1 m above its floor', { skip: !existsSync(P) }, () => {
  // EmuVR spawns the prefab with its root at the room object, so the root's own stored transform
  // (arcade @ 20.86, 3.006, 5.957) must not be baked into level space.
  const o = ea();
  assert.equal(o.stats.root.name, 'arcade');
  assert.ok(Math.abs(o.stats.root.position.x - 20.86) < 0.01 && Math.abs(o.stats.root.position.y - 3.006) < 0.01, JSON.stringify(o.stats.root));
  assert.ok(Math.abs(o.stats.floorY) < 0.05, 'floorY ' + o.stats.floorY);
  assert.ok(Math.abs(o.sliceY - 1) < 0.05, 'sliceY ' + o.sliceY);
  assert.ok(o.bounds.minX < -45 && o.bounds.maxX > -2 && o.bounds.maxX < 5, JSON.stringify(o.bounds));
});

// Share of points within `d` metres of any wall segment.
function nearWallShare(segs, pts, d = 1.5) {
  const dist = (px, pz, [x1, z1, x2, z2]) => {
    const dx = x2 - x1, dz = z2 - z1, L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L)) : 0;
    return Math.hypot(px - x1 - t * dx, pz - z1 - t * dz);
  };
  return pts.filter(([x, z]) => segs.some(s => dist(x, z, s) <= d)).length / pts.length;
}

// Slot 6 lines its cabinets up along the arcade's walls and partitions, so the placed outline must sit next to far
// more of them than the same outline would if it were shifted, turned or mirrored. (Measured: 92% of cabinets within
// 1.5 m; the best displaced copy reaches 77%.)
test('Entertainment Arcade walls line up with Slot 6 cabinets better than any displaced copy', { skip: !existsSync(P) || !existsSync(S6) }, () => {
  const room = JSON.parse(readFileSync(S6, 'utf8').replace(/^\uFEFF/, ''));
  const levelObj = levelObjectOf(room, new Set(['ugc_Level_Entertainment_Arcade_9e2f95d3']));
  assert.ok(levelObj, 'Slot 6 places the Entertainment Arcade');
  const segs = transformOutline(ea().segments, levelObj);
  const cabs = room.systems.filter(o => o.position).map(o => [o.position.x, o.position.z]);
  assert.ok(cabs.length > 100, 'cabinets ' + cabs.length);
  const real = nearWallShare(segs, cabs);
  const controls = {
    'shifted +2 m x': ([x, z]) => [x + 2, z], 'shifted -2 m x': ([x, z]) => [x - 2, z],
    'shifted +2 m z': ([x, z]) => [x, z + 2], 'shifted -2 m z': ([x, z]) => [x, z - 2],
    'shifted +5 m x': ([x, z]) => [x + 5, z], 'shifted +5 m z': ([x, z]) => [x, z + 5],
    'turned 90 degrees': ([x, z]) => [-z, x], 'mirrored x': ([x, z]) => [-x, z], 'mirrored z': ([x, z]) => [x, -z],
  };
  const scores = Object.entries(controls).map(([name, f]) => [name, nearWallShare(segs.map(([x1, z1, x2, z2]) => [...f([x1, z1]), ...f([x2, z2])]), cabs)]);
  const [bestName, best] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.ok(real >= 0.85, `only ${(real * 100).toFixed(1)}% of cabinets within 1.5 m of a wall`);
  assert.ok(real >= best + 0.1, `real ${(real * 100).toFixed(1)}% vs ${bestName} ${(best * 100).toFixed(1)}%`);
});

test('level id comes from the <Name>_<8-hex> filename prefix, not the stopgap suffix', () => {
  assert.equal(levelIdFromFile('Level_Entertainment_Arcade_9e2f95d3 _[temp_level_stopgap_1234578a].ugc'), 'ugc_Level_Entertainment_Arcade_9e2f95d3');
  assert.equal(levelIdFromFile('F:\\games\\RAVE\\Custom\\UGC\\Levels\\02_house_73a9f1ae_[temp_level_stopgap_12345789].ugc'), 'ugc_02_house_73a9f1ae');
  assert.equal(levelIdFromFile('Blockbuster_Screen_Set_f6a901ec.ugc'), 'ugc_Blockbuster_Screen_Set_f6a901ec');
  assert.equal(levelIdFromFile('no_hash_here.ugc'), null);
});

// Closed square outline with each side split into `parts` collinear pieces.
function square(x0, z0, size, parts = 5) {
  const segs = []; const c = [[x0, z0], [x0 + size, z0], [x0 + size, z0 + size], [x0, z0 + size]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4];
    for (let i = 0; i < parts; i++) {
      segs.push([ax + (bx - ax) * i / parts, az + (bz - az) * i / parts, ax + (bx - ax) * (i + 1) / parts, az + (bz - az) * (i + 1) / parts]);
    }
  }
  return segs;
}

test('cache decision: an outline is cached when it has >= 4 segments spanning >= 5 m both ways', () => {
  assert.deepEqual(cacheDecision({ segments: square(0, 0, 10, 1) }), { write: true, status: 'WRITTEN', reasons: [] });
  const small = cacheDecision({ segments: square(0, 0, 4) });
  assert.equal(small.write, false); assert.ok(small.reasons.some(r => /spans/.test(r)), small.reasons.join('; '));
  const few = cacheDecision({ segments: square(0, 0, 10, 1).slice(0, 3) });
  assert.equal(few.write, false); assert.ok(few.reasons.some(r => /segments/.test(r)), few.reasons.join('; '));
  assert.equal(cacheDecision({ segments: [] }).write, false);
});

test('affineInverse undoes a rotated, non-uniformly scaled TRS matrix', () => {
  const q0 = { x: 0.1, y: 0.7, z: -0.2, w: 0.678 }; const n = Math.hypot(q0.x, q0.y, q0.z, q0.w);
  const m = trsMatrix({ x: 20.86, y: 3.0062, z: 5.9575 }, { x: q0.x / n, y: q0.y / n, z: q0.z / n, w: q0.w / n }, { x: 2, y: 0.5, z: -1 });
  const id = mulMatrix(affineInverse(m), m);
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].forEach((v, k) => assert.ok(Math.abs(id[k] - v) < 1e-12, `entry ${k}: ${id[k]}`));
});

test('floorHeight is the 5th percentile of collider vertex heights (a few pit vertices do not move it)', () => {
  const tri = (y0, y1, y2) => [0, y0, 0, 1, y1, 0, 0, y2, 1];
  const tris = new Float64Array([
    ...tri(2.2, 2.2, 2.2), ...tri(2.2, 2.2, 2.2),               // 6 vertices in a pit
    ...Array.from({ length: 40 }, () => tri(3, 3, 3)).flat(),   // 120 floor vertices
    ...Array.from({ length: 20 }, () => tri(3, 9, 9)).flat(),   // walls up to the ceiling
  ]);
  assert.equal(floorHeight(tris), 3);
  assert.equal(floorHeight(new Float64Array(0)), null);
});
