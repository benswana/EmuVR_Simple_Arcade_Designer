import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yawFromQuat, quatFromYaw, qmul, rotateVec, degrees, radians, planHeading } from '../src/quat.js';

test('planHeading follows the forward axis, falling back to the right axis when forward is vertical', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.equal(planHeading(undefined), 0);
  assert.ok(near(planHeading(quatFromYaw(radians(30))), radians(30)));
  // 180-degree X tilt: forward points to -Z, so the plan heading is 180 (the right axis would say 0)
  assert.ok(near(Math.abs(planHeading({ x: 1, y: 0, z: 0, w: 0 })), Math.PI));
  // 90-degree X tilt (Z-up authored): forward is vertical, so the right-axis yaw is used
  assert.ok(near(planHeading(qmul(quatFromYaw(radians(90)), { x: Math.SQRT1_2, y: 0, z: 0, w: -Math.SQRT1_2 })), radians(90)));
});

test('rotateVec follows Unity Y-up: yaw 90 sends forward +Z to +X and right +X to -Z', () => {
  const q = quatFromYaw(radians(90));
  const [fx, fy, fz] = rotateVec(q, [0, 0, 1]); assert.ok(Math.abs(fx - 1) < 1e-6 && Math.abs(fy) < 1e-6 && Math.abs(fz) < 1e-6);
  const [rx, , rz] = rotateVec(q, [1, 0, 0]); assert.ok(Math.abs(rx) < 1e-6 && Math.abs(rz + 1) < 1e-6);
});
test('composing a world-Y turn onto an X-tilted quaternion keeps the tilt and is reversible', () => {
  const q0 = { x: 0.7071068, y: 0, z: 0, w: -0.7071068 };
  const q1 = qmul(quatFromYaw(radians(90)), q0);
  assert.ok(Math.abs(Math.abs(q1.x) - 0.5) < 1e-6, JSON.stringify(q1));
  assert.ok(Math.abs(degrees(yawFromQuat(q1)) - 90) < 1e-4); // 0.7071068 is not exactly unit
  const back = qmul(quatFromYaw(radians(-90)), q1);
  for (const k of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(back[k] - q0[k]) < 1e-6, k);
});

test('identity quaternion has yaw 0', () => {
  assert.equal(yawFromQuat({ x: 0, y: 0, z: 0, w: 1 }), 0);
});
test('90 degree yaw round-trips', () => {
  const q = quatFromYaw(radians(90));
  assert.ok(Math.abs(q.y - 0.7071068) < 1e-6 && Math.abs(q.w - 0.7071068) < 1e-6);
  assert.equal(q.x, 0); assert.equal(q.z, 0);
  assert.ok(Math.abs(degrees(yawFromQuat(q)) - 90) < 1e-6);
});
test('180 degree yaw round-trips', () => {
  const q = quatFromYaw(radians(180));
  assert.ok(Math.abs(Math.abs(degrees(yawFromQuat(q))) - 180) < 1e-6);
});
