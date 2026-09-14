// Plane slicing of triangle soups and 2D segment utilities (XZ plane).
// Segments are [x1, z1, x2, z2].

// Intersect every triangle (9 numbers each) with the horizontal plane at `y`.
// A vertex exactly on the plane counts as "above" so each straddling triangle
// yields exactly one segment and shared edges are cut consistently.
export function sliceTriangles(tris, y) {
  const out = [];
  const n = Math.floor(tris.length / 9);
  const px = [0, 0, 0], pz = [0, 0, 0], d = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    let above = 0;
    for (let k = 0; k < 3; k++) {
      px[k] = tris[o + 3 * k]; d[k] = tris[o + 3 * k + 1] - y; pz[k] = tris[o + 3 * k + 2];
      if (d[k] >= 0) above++;
    }
    if (above === 0 || above === 3) continue;
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if ((d[k] >= 0) === (d[j] >= 0)) continue;
      const s = d[k] / (d[k] - d[j]);
      pts.push(px[k] + s * (px[j] - px[k]), pz[k] + s * (pz[j] - pz[k]));
    }
    if (pts.length === 4 && pts.every(Number.isFinite)) out.push(pts);
  }
  return out;
}

// Snap to a grid, drop zero-length and duplicate segments, then join collinear
// segments that meet end-to-end at a point shared by exactly those two.
export function snapMerge(segs, snap = 0.01) {
  const inv = 1 / snap;
  const q = (v) => Math.round(v * inv);
  const key = (x, z) => x + ',' + z;
  const list = []; // integer grid units: [ax, az, bx, bz] or null when removed
  const seen = new Set();
  const addUnique = (ax, az, bx, bz) => {
    if (ax === bx && az === bz) return -1;
    if (ax > bx || (ax === bx && az > bz)) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
    const k = ax + ',' + az + ',' + bx + ',' + bz;
    if (seen.has(k)) return -1;
    seen.add(k); list.push([ax, az, bx, bz]); return list.length - 1;
  };
  for (const s of segs) addUnique(q(s[0]), q(s[1]), q(s[2]), q(s[3]));

  const at = new Map(); // point key -> Set of segment indices
  const link = (i) => {
    const s = list[i];
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { let m = at.get(k); if (!m) at.set(k, m = new Set()); m.add(i); }
  };
  const unlink = (i) => {
    const s = list[i];
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { const m = at.get(k); if (m) { m.delete(i); if (!m.size) at.delete(k); } }
  };
  for (let i = 0; i < list.length; i++) link(i);

  const work = [...at.keys()];
  while (work.length) {
    const pk = work.pop();
    const m = at.get(pk); if (!m || m.size !== 2) continue;
    const [i, j] = [...m];
    const [px, pz] = pk.split(',').map(Number);
    const far = (s) => (s[0] === px && s[1] === pz) ? [s[2], s[3]] : [s[0], s[1]];
    const [ax, az] = far(list[i]), [bx, bz] = far(list[j]);
    const ux = ax - px, uz = az - pz, vx = bx - px, vz = bz - pz;
    if (ux * vx + uz * vz >= 0) continue; // must point in opposite directions
    // perpendicular distance of P from line A-B, in grid units
    const lx = bx - ax, lz = bz - az, len = Math.hypot(lx, lz);
    if (Math.abs(lx * (pz - az) - lz * (px - ax)) / len > 0.5) continue;
    unlink(i); unlink(j);
    seen.delete(list[i].join(',')); seen.delete(list[j].join(','));
    list[i] = null; list[j] = null;
    const ni = addUnique(ax, az, bx, bz);
    if (ni >= 0) link(ni);
    work.push(key(ax, az), key(bx, bz));
  }

  const out = [];
  for (const s of list) if (s) out.push([s[0] / inv + 0, s[1] / inv + 0, s[2] / inv + 0, s[3] / inv + 0]);
  return out;
}

// Even-odd point-in-outline test: ray toward +X, half-open crossing rule.
export function insideEvenOdd(x, z, segs) {
  let inside = false;
  for (const [x1, z1, x2, z2] of segs) {
    if ((z1 > z) !== (z2 > z)) {
      const xi = x1 + (z - z1) * (x2 - x1) / (z2 - z1);
      if (xi > x) inside = !inside;
    }
  }
  return inside;
}

export function boundsOf(segs) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x1, z1, x2, z2] of segs) {
    if (x1 < minX) minX = x1; if (x2 < minX) minX = x2; if (x1 > maxX) maxX = x1; if (x2 > maxX) maxX = x2;
    if (z1 < minZ) minZ = z1; if (z2 < minZ) minZ = z2; if (z1 > maxZ) maxZ = z1; if (z2 > maxZ) maxZ = z2;
  }
  return { minX, maxX, minZ, maxZ };
}
