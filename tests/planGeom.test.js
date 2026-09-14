import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footprintSize, obbCorners, pointInObb, obbOverlap, planView } from '../src/planGeom.js';
test('the plan is a top-down view: +X right, +Z up the screen, and screen <-> world round-trips', () => {
  const v = planView({ camX: 10, camZ: 5, zoom: 20, width: 800, height: 600 });
  assert.deepEqual(v.toScreen(10, 5), [400, 300]);
  const [rx] = v.toScreen(11, 5), [, uy] = v.toScreen(10, 6);
  assert.ok(rx > 400, 'world +X is to the right'); assert.ok(uy < 300, 'world +Z is UP the screen (smaller y)');
  const [x, z] = v.toWorld(...v.toScreen(-3.25, 7.5));
  assert.ok(Math.abs(x + 3.25) < 1e-9 && Math.abs(z - 7.5) < 1e-9);
});
test('footprint scales and widens for twins, clamped', () => {
  assert.deepEqual(footprintSize('ugc_Arcade_X', 1), { w: 0.8, d: 0.9 });
  assert.ok(Math.abs(footprintSize('ugc_Arcade_X_Twin', 1).w - 1.44) < 1e-9);
  assert.equal(footprintSize('ugc_Arcade_X', 100).w, 12);
  assert.equal(footprintSize('ugc_Arcade_X', 0.001).w, 0.2);
  assert.deepEqual(footprintSize('ugc_Arcade_X', { x: 2, y: 5, z: 3 }), { w: 1.6, d: 2.7 });
});
test('front edge points along Unity forward (+X at yaw 90)', () => {
  const k = obbCorners(0, 0, Math.PI / 2, 0.8, 0.9);
  const mx = (k[2][0] + k[3][0]) / 2, mz = (k[2][1] + k[3][1]) / 2;
  assert.ok(mx > 0 && Math.abs(mx - 0.45) < 1e-9); assert.ok(Math.abs(mz) < 1e-9);
});
test('hit test and overlap', () => {
  const a = obbCorners(0, 0, 0, 2, 2), b = obbCorners(1, 0, 0, 2, 2), c = obbCorners(5, 0, Math.PI / 4, 2, 2);
  assert.ok(pointInObb(0.5, 0.5, a)); assert.ok(!pointInObb(3, 3, a));
  assert.ok(obbOverlap(a, b)); assert.ok(!obbOverlap(a, c));
});
