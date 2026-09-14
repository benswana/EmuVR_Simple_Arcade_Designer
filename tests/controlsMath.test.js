import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointerToAngle, snapAngle, angleDelta, scaleToSlider, sliderToScale, uniformScale } from '../src/controlsMath.js';
import { headingOf, quatFromYaw, radians } from '../src/quat.js';
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
test('pointer angle: up=0, right=90, down=180, left=-90', () => {
  assert.ok(near(pointerToAngle(0, 0, 0, -10), 0));
  assert.ok(near(pointerToAngle(0, 0, 10, 0), Math.PI / 2));
  assert.ok(near(Math.abs(pointerToAngle(0, 0, 0, 10)), Math.PI));
  assert.ok(near(pointerToAngle(0, 0, -10, 0), -Math.PI / 2));
});
test('snap and delta', () => {
  assert.ok(near(snapAngle(radians(22), 15), radians(15)));
  assert.ok(near(snapAngle(radians(23), 15), radians(30)));
  assert.ok(near(snapAngle(radians(23), 15, true), radians(23)));
  assert.ok(near(angleDelta(radians(170), radians(-170)), radians(20)));
});
test('log slider round-trips and centres (no rounding inside the mapping)', () => {
  assert.ok(near(scaleToSlider(0.03, 0.03), 500, 1e-9));
  for (const s of [0.0003, 0.03, 1, 3]) assert.ok(near(sliderToScale(scaleToSlider(s, 0.03), 0.03), s, 1e-9));
  assert.equal(scaleToSlider(1e9, 1), 1000); assert.equal(scaleToSlider(1e-9, 1), 0);
});
test('uniform scale keeps vector proportions', () => {
  assert.equal(uniformScale(2, 1.5), 3);
  assert.deepEqual(uniformScale({ x: 1, y: 2, z: 4 }, 0.5), { x: 0.5, y: 1, z: 2 });
});
test('headingOf matches yaw for upright objects', () => {
  for (const d of [0, 45, 90, 180, -90]) assert.ok(near(Math.cos(headingOf(quatFromYaw(radians(d)))), Math.cos(radians(d)), 1e-9));
});
