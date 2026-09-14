import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { sliceTriangles, snapMerge, insideEvenOdd, boundsOf } from '../tools/unity/slice.mjs';
import { openBundle } from '../tools/unity/bundle.mjs';
import { parseSerialized } from '../tools/unity/serialized.mjs';
import { levelColliderTriangles } from '../tools/unity/scene.mjs';
const P = 'F:\\games\\RAVE\\Custom\\UGC\\Levels\\Level_Entertainment_Arcade_9e2f95d3 _[temp_level_stopgap_1234578a].ugc';

function cube(cx, cz, half) { // axis-aligned box y 0..2 as 12 triangles
  const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
  const v = (x, y, z) => [x, y, z];
  const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  return new Float64Array([
    ...quad(v(x0,0,z0), v(x1,0,z0), v(x1,2,z0), v(x0,2,z0)), ...quad(v(x1,0,z0), v(x1,0,z1), v(x1,2,z1), v(x1,2,z0)),
    ...quad(v(x1,0,z1), v(x0,0,z1), v(x0,2,z1), v(x1,2,z1)), ...quad(v(x0,0,z1), v(x0,0,z0), v(x0,2,z0), v(x0,2,z1)),
    ...quad(v(x0,0,z0), v(x1,0,z0), v(x1,0,z1), v(x0,0,z1)), ...quad(v(x0,2,z0), v(x1,2,z0), v(x1,2,z1), v(x0,2,z1)),
  ]);
}
test('slicing a box at mid-height gives its square outline', () => {
  const segs = snapMerge(sliceTriangles(cube(0, 0, 5), 1.0));
  const b = boundsOf(segs);
  assert.deepEqual([b.minX, b.maxX, b.minZ, b.maxZ], [-5, 5, -5, 5]);
  assert.ok(insideEvenOdd(0, 0, segs)); assert.ok(!insideEvenOdd(7, 0, segs));
  assert.ok(segs.length >= 4 && segs.length <= 8);
});
test('slicing above the box yields nothing', () => {
  assert.equal(sliceTriangles(cube(0, 0, 5), 3).length, 0);
});
test('real level produces sane collider geometry', { skip: !existsSync(P) }, () => {
  const b = openBundle(P); const main = b.nodes.find(n => !n.path.endsWith('.resS')); const res = b.nodes.find(n => n.path.endsWith('.resS'));
  const sf = parseSerialized(b.readNode(main.path));
  const { tris, stats } = levelColliderTriangles(sf, res ? b.readNode(res.path) : null);
  assert.ok(stats.triangles > 1000, JSON.stringify(stats));
  for (let i = 0; i < Math.min(tris.length, 90000); i++) assert.ok(Number.isFinite(tris[i]));
  b.close();
});
