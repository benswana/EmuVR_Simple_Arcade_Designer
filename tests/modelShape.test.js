import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footprint, modelFront, displayHeading, modelHeight } from '../src/modelShape.js';
import { quatFromYaw, qmul } from '../src/quat.js';
import { Room } from '../src/roomModel.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearPt = (p, q, eps = 1e-9) => near(p[0], q[0], eps) && near(p[1], q[1], eps);
// A cabinet whose screen faces its object-space -X (like Street Fighter III), 0.98 m wide x 0.93 m deep x 2 m tall.
const SF3 = { min: [-0.5, 0, -0.47], max: [0.48, 2, 0.46], front: [-1, 0] };
const at = (x, z, extra = {}) => ({ id: 'ugc_Arcade_X_12345678', position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: 1, ...extra });

test('the front dot sits at the middle of the edge the screen faces, from the model bounds', () => {
  const f = footprint(at(10, 5), SF3);
  assert.ok(nearPt(f.front, [-1, 0]), String(f.front));
  assert.ok(nearPt(f.frontMid, [9.5, 4.995]), String(f.frontMid));
  assert.ok(near(f.heading, -Math.PI / 2));
  // corners 2 and 3 are the front edge, so the plan can keep drawing its dot between them
  assert.ok(nearPt([(f.corners[2][0] + f.corners[3][0]) / 2, (f.corners[2][1] + f.corners[3][1]) / 2], f.frontMid));
  const xs = f.corners.map(c => c[0]), zs = f.corners.map(c => c[1]);
  assert.ok(near(Math.min(...xs), 9.5) && near(Math.max(...xs), 10.48) && near(Math.min(...zs), 4.53) && near(Math.max(...zs), 5.46));
});

test('turning the object turns the front: yaw 90 degrees takes object -X to world +Z', () => {
  const f = footprint(at(0, 0, { rotation: quatFromYaw(Math.PI / 2) }), SF3);
  assert.ok(nearPt(f.front, [0, 1]), String(f.front));
  assert.ok(near(f.heading, 0));
  assert.ok(near(f.frontMid[1], 0.5), String(f.frontMid));
  const back = footprint(at(0, 0, { rotation: quatFromYaw(-Math.PI / 2) }), SF3);
  assert.ok(nearPt(back.front, [0, -1]) && near(back.frontMid[1], -0.5), String(back.frontMid));
});

test('room scale multiplies the bounds, a vector scale per axis', () => {
  assert.ok(nearPt(footprint(at(0, 0, { scale: 2 }), SF3).frontMid, [-1, -0.01]));
  const v = footprint(at(0, 0, { scale: { x: 3, y: 1, z: 1 } }), SF3);
  assert.ok(near(v.frontMid[0], -1.5), String(v.frontMid));
});

test('a model turned inside its file keeps that turn: its front comes pre-rotated in object space', () => {
  const galaga = { min: [-0.31, 0, -0.44], max: [0.32, 1.77, 0.41], front: [0, 1] }; // screen already faces object +Z
  const f = footprint(at(0, 0, { rotation: quatFromYaw(Math.PI) }), galaga);
  assert.ok(nearPt(f.front, [0, -1], 1e-9) && near(f.frontMid[1], -0.41), String(f.frontMid)); // object +Z edge (0.41) turned to -Z
});

test('a front that ends up vertical (model tipped over) has no dot and no heading, but still a footprint', () => {
  const tipped = qmul(quatFromYaw(0.3), { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }); // +Z tipped onto -Y
  const galaga = { min: [-0.31, 0, -0.44], max: [0.32, 1.77, 0.41], front: [0, 1] };
  const f = footprint(at(0, 0, { rotation: tipped }), galaga);
  assert.equal(f.front, null); assert.equal(f.frontMid, null); assert.equal(f.heading, null);
  assert.equal(f.corners.length, 4);
  assert.equal(modelFront(at(0, 0, { rotation: tipped }), galaga), null);
});

test('without model data there is no footprint; the heading falls back to the rotation', () => {
  assert.equal(footprint(at(0, 0), null), null);
  assert.equal(footprint(at(0, 0), { front: [1, 0] }), null);
  assert.ok(near(displayHeading(at(0, 0, { rotation: quatFromYaw(0.4) }), null), 0.4));
  assert.ok(near(displayHeading(at(0, 0, { rotation: quatFromYaw(Math.PI / 2) }), SF3), 0));
});

test('a very thin model still gets a clickable footprint', () => {
  const card = { min: [0, 0, 0], max: [0.001, 0.2, 0.001], front: [0, 1] };
  const f = footprint(at(0, 0), card);
  const xs = f.corners.map(c => c[0]), zs = f.corners.map(c => c[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 0.1 - 1e-9 && Math.max(...zs) - Math.min(...zs) >= 0.1 - 1e-9);
});

test('modelHeight is how tall the model stands in VR at its room scale and rotation', () => {
  assert.ok(near(modelHeight(at(0, 0), SF3), 2));
  assert.ok(near(modelHeight(at(0, 0, { scale: 0.01 }), SF3), 0.02));
  assert.ok(near(modelHeight(at(0, 0, { scale: { x: 1, y: 3, z: 1 } }), SF3), 6));
  assert.ok(near(modelHeight(at(0, 0, { rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } }), SF3), 0.93)); // lying on its back
  assert.equal(modelHeight(at(0, 0), null), null);
});

test('typing a facing turns the model so its front (screen) faces that way', () => {
  const room = new Room({ objects: [] });
  const o = at(0, 0, { rotation: quatFromYaw(0.2) });
  room.setYaw(o, Math.PI / 2, displayHeading(o, SF3));
  assert.ok(near(displayHeading(o, SF3), Math.PI / 2, 1e-9), String(displayHeading(o, SF3)));
  assert.ok(nearPt(footprint(o, SF3).front, [1, 0], 1e-9));
});
