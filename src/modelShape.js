// Plan footprint and front of a placed model from its extracted shape (tools/extract_models.mjs):
// info = { min: [x,y,z], max: [x,y,z], front: [fx, fz] | null } in the model's object space. EmuVR keeps the prefab
// root's own rotation, so both already include it; the room object supplies position, rotation and scale.
import { rotateVec, planHeading } from './quat.js';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const MIN_SIZE = 0.1;     // metres: very thin models (cards, cases) still get a clickable footprint
const MIN_LEVEL = 0.3;    // a front whose floor-plane share is below this points up or down: no dot
const scaleOf = (s) => (Number.isFinite(s) ? [s, s, s]
  : s && typeof s === 'object' ? ['x', 'y', 'z'].map(k => (Number.isFinite(s[k]) ? s[k] : 1)) : [1, 1, 1]);

// World floor-plane unit vector the model's front (its screen) faces, or null when unknown or near vertical.
export function modelFront(o, info) {
  if (!info || !Array.isArray(info.front)) return null;
  const v = rotateVec(o.rotation || IDENTITY, [info.front[0], 0, info.front[1]]);
  const h = Math.hypot(v[0], v[2]);
  return h >= MIN_LEVEL ? [v[0] / h, v[2] / h] : null;
}

// { corners: 4 [x,z] (0-1 back edge, 2-3 front edge), front: [x,z] | null, frontMid: [x,z] | null, heading: rad | null }
// The rectangle is aligned with the front so its front edge is where the player stands; null without model bounds.
export function footprint(o, info) {
  if (!info || !Array.isArray(info.min) || !Array.isArray(info.max)) return null;
  const q = o.rotation || IDENTITY, [sx, sy, sz] = scaleOf(o.scale ?? 1), p = o.position || { x: 0, z: 0 };
  const front = modelFront(o, info);
  let u = front;
  if (!u) { // no usable front: frame the box on the model's forward axis, or its right axis when forward is vertical
    for (const axis of [[0, 0, 1], [1, 0, 0]]) {
      const v = rotateVec(q, axis), h = Math.hypot(v[0], v[2]);
      if (h >= MIN_LEVEL) { u = [v[0] / h, v[2] / h]; break; }
    }
    if (!u) u = [0, 1];
  }
  const r = [u[1], -u[0]]; // right of the heading on the floor (heading t: u = (sin t, cos t), r = (cos t, -sin t))
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = [(i & 1 ? info.max[0] : info.min[0]) * sx, (i & 2 ? info.max[1] : info.min[1]) * sy, (i & 4 ? info.max[2] : info.min[2]) * sz];
    const w = rotateVec(q, c);
    const a = w[0] * u[0] + w[2] * u[1], b = w[0] * r[0] + w[2] * r[1];
    if (a < aMin) aMin = a; if (a > aMax) aMax = a; if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  if (aMax - aMin < MIN_SIZE) { const m = (aMax + aMin) / 2; aMin = m - MIN_SIZE / 2; aMax = m + MIN_SIZE / 2; }
  if (bMax - bMin < MIN_SIZE) { const m = (bMax + bMin) / 2; bMin = m - MIN_SIZE / 2; bMax = m + MIN_SIZE / 2; }
  const pt = (a, b) => [p.x + a * u[0] + b * r[0], p.z + a * u[1] + b * r[1]];
  return {
    corners: [pt(aMin, bMin), pt(aMin, bMax), pt(aMax, bMax), pt(aMax, bMin)],
    front,
    frontMid: front ? pt(aMax, (bMin + bMax) / 2) : null,
    heading: front ? Math.atan2(front[0], front[1]) + 0 : null,
  };
}

// How tall the model stands in VR (metres) at its room scale and rotation; null without model bounds.
export function modelHeight(o, info) {
  if (!info || !Array.isArray(info.min) || !Array.isArray(info.max)) return null;
  const q = o.rotation || IDENTITY, [sx, sy, sz] = scaleOf(o.scale ?? 1);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const y = rotateVec(q, [(i & 1 ? info.max[0] : info.min[0]) * sx, (i & 2 ? info.max[1] : info.min[1]) * sy, (i & 4 ? info.max[2] : info.min[2]) * sz])[1];
    if (y < lo) lo = y; if (y > hi) hi = y;
  }
  return hi - lo;
}

// Heading shown on the plan, dial and degree box (0 = +Z, clockwise towards +X): the way the model's front faces,
// else the rotation's own heading when the model's front is unknown.
export function displayHeading(o, info) {
  const f = modelFront(o, info);
  return f ? Math.atan2(f[0], f[1]) + 0 : planHeading(o.rotation);
}
