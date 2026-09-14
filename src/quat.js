// Hamilton product: qmul(a, b) = rotate by b first, then by a (Unity's a * b).
export function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
// v' = q v q* (q assumed unit).
export function rotateVec(q, [vx, vy, vz]) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
// Heading of the model's local right axis (+X) on the floor plane, Unity Y-up: at yaw t, right = (cos t, 0, -sin t).
// Using the right axis (not forward) keeps the value meaningful for models authored Z-up that carry a 90-degree X tilt;
// the Euler-angle formula is degenerate for those.
export function yawFromQuat(q) {
  const [rx, , rz] = rotateVec(q, [1, 0, 0]);
  return Math.atan2(-rz, rx) + 0; // + 0 turns -0 into 0
}
export function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
// Heading of the model's forward (+Z) on the plan, Unity Y-up: forward = (sin t, cos t) -> t. 0 = +Z (north), clockwise positive.
export function headingOf(q) {
  const [fx, , fz] = rotateVec(q || { x: 0, y: 0, z: 0, w: 1 }, [0, 0, 1]);
  return Math.atan2(fx, fz) + 0; // + 0 turns -0 into 0
}
// Heading as drawn on the plan, dial and number box (0 = +Z, clockwise towards +X): the forward axis; models
// authored Z-up (90-degree X tilt) have a vertical forward, so fall back to the right-axis yaw for those.
export function planHeading(q) {
  if (!q) return 0;
  const [fx, , fz] = rotateVec(q, [0, 0, 1]);
  return Math.hypot(fx, fz) > 0.25 ? headingOf(q) : yawFromQuat(q);
}
export const degrees = (r) => (r * 180) / Math.PI;
export const radians = (d) => (d * Math.PI) / 180;
