const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Top-down view of EmuVR's Unity world (X right, Y up, Z forward) as seen from above: +X to the right and +Z UP the
// screen. Screen y grows downward, so z is negated; drawing +Z downward would show the room mirrored.
export function planView({ camX, camZ, zoom, width, height }) {
  return {
    toScreen: (x, z) => [(x - camX) * zoom + width / 2, (camZ - z) * zoom + height / 2],
    toWorld: (sx, sy) => [(sx - width / 2) / zoom + camX, camZ - (sy - height / 2) / zoom],
  };
}
export function footprintSize(modelId, scale = 1) {
  const wide = /Twin|SDX|_DX|Deluxe|Sit|Racer|Driver|Motion/i.test(modelId || '');
  // scale may be a {x,y,z} vector (EmuVR non-uniform scale); footprint uses its floor-plane components
  const sx = Number.isFinite(scale) ? scale : (scale && Number.isFinite(scale.x) ? scale.x : 1);
  const sz = Number.isFinite(scale) ? scale : (scale && Number.isFinite(scale.z) ? scale.z : 1);
  return { w: clamp(0.8 * (wide ? 1.8 : 1) * sx, 0.2, 12), d: clamp(0.9 * sz, 0.2, 12) };
}
export function obbCorners(x, z, yaw, w, d) {
  const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
  // Unity Y-up: at yaw t, forward (local +z) = (sin t, cos t) and right (local +x) = (cos t, -sin t)
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
}
export function pointInObb(px, pz, k) {
  let sign = 0;
  for (let i = 0; i < 4; i++) { const [ax, az] = k[i], [bx, bz] = k[(i + 1) % 4];
    const cross = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
    if (cross !== 0) { const sg = Math.sign(cross); if (sign === 0) sign = sg; else if (sg !== sign) return false; } }
  return true;
}
export function obbOverlap(a, b) {
  const axes = [];
  for (const k of [a, b]) for (let i = 0; i < 2; i++) { const [ax, az] = k[i], [bx, bz] = k[i + 1]; axes.push([-(bz - az), bx - ax]); }
  for (const [nx, nz] of axes) {
    const proj = (k) => k.map(([x, z]) => x * nx + z * nz);
    const pa = proj(a), pb = proj(b);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
