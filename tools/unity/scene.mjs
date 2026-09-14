// Scene geometry from a parsed SerializedFile: Transform hierarchy -> world
// (level-space) matrices, and MeshCollider / BoxCollider -> world triangles.

const CLASS_TRANSFORM = 4, CLASS_RECT_TRANSFORM = 224, CLASS_MESH_COLLIDER = 64, CLASS_BOX_COLLIDER = 65;

// Vertex format byte sizes, Unity 2018.4 VertexFormat enum.
const FORMAT_SIZE = [4, 2, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4];

// 3x4 affine matrices stored row-major: [m00 m01 m02 m03  m10 ... m23].
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function trsMatrix(pos, q, scale) {
  const { x, y, z, w } = q;
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  return [
    r00 * scale.x, r01 * scale.y, r02 * scale.z, pos.x,
    r10 * scale.x, r11 * scale.y, r12 * scale.z, pos.y,
    r20 * scale.x, r21 * scale.y, r22 * scale.z, pos.z,
  ];
}

export function mulMatrix(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2];
    o[r * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    o[r * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    o[r * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    o[r * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a[r * 4 + 3];
  }
  return o;
}

// Growable Float64 buffer for the triangle soup.
function triBuffer() {
  let buf = new Float64Array(1 << 16), len = 0;
  return {
    push9(m, ax, ay, az, bx, by, bz, cx, cy, cz) {
      if (len + 9 > buf.length) { const nb = new Float64Array(buf.length * 2); nb.set(buf); buf = nb; }
      for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
        buf[len++] = m[0] * x + m[1] * y + m[2] * z + m[3];
        buf[len++] = m[4] * x + m[5] * y + m[6] * z + m[7];
        buf[len++] = m[8] * x + m[9] * y + m[10] * z + m[11];
      }
    },
    result() { return buf.slice(0, len); },
    get count() { return len / 9; },
  };
}

// Decode an uncompressed Mesh into local positions and triangle indices.
// Returns { positions: Float64Array(3n), indices: Uint32Array(3t), badIndices } or { skip: reason }.
export function decodeMesh(mesh, resS) {
  if (mesh.m_MeshCompression !== 0) return { skip: 'compressed' };
  const vd = mesh.m_VertexData; const vertexCount = vd.m_VertexCount;
  const channels = vd.m_Channels;
  const pos = channels[0];
  if (!pos || pos.format !== 0 || pos.dimension < 3) return { skip: 'format' };

  let data = vd.m_DataSize;
  const sd = mesh.m_StreamData;
  if (sd && sd.path) {
    if (!resS) return { skip: 'external' };
    const off = Number(sd.offset), size = Number(sd.size);
    if (off + size > resS.length) return { skip: 'external' };
    data = resS.subarray(off, off + size);
  }

  // Stream strides and consecutive, 4-aligned stream offsets.
  const streamCount = channels.reduce((mx, c) => c.dimension > 0 ? Math.max(mx, c.stream + 1) : mx, 0);
  const strides = new Array(streamCount).fill(0);
  for (const c of channels) if (c.dimension > 0) strides[c.stream] += c.dimension * FORMAT_SIZE[c.format];
  const streamOffsets = []; let acc = 0;
  for (let s = 0; s < streamCount; s++) { streamOffsets.push(acc); acc += strides[s] * vertexCount; acc = (acc + 3) & ~3; }

  const base = streamOffsets[pos.stream] + pos.offset, stride = strides[pos.stream];
  if (vertexCount > 0 && base + stride * (vertexCount - 1) + 12 > data.length) return { skip: 'format' };
  const positions = new Float64Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const o = base + v * stride;
    positions[v * 3] = data.readFloatLE(o); positions[v * 3 + 1] = data.readFloatLE(o + 4); positions[v * 3 + 2] = data.readFloatLE(o + 8);
  }

  // Stored vertex normals (channel 1) when present as float triples; null otherwise.
  let normals = null;
  const nrm = channels[1];
  if (nrm && nrm.dimension >= 3 && nrm.format === 0) {
    const nb = streamOffsets[nrm.stream] + nrm.offset, ns = strides[nrm.stream];
    if (!(vertexCount > 0 && nb + ns * (vertexCount - 1) + 12 > data.length)) {
      normals = new Float64Array(vertexCount * 3);
      for (let v = 0; v < vertexCount; v++) {
        const o = nb + v * ns;
        normals[v * 3] = data.readFloatLE(o); normals[v * 3 + 1] = data.readFloatLE(o + 4); normals[v * 3 + 2] = data.readFloatLE(o + 8);
      }
    }
  }

  const ib = mesh.m_IndexBuffer; const wide = mesh.m_IndexFormat === 1; const isz = wide ? 4 : 2;
  const tri = []; let badIndices = 0;
  for (const sm of mesh.m_SubMeshes) {
    if (sm.topology !== 0) continue;
    const count = sm.indexCount - (sm.indexCount % 3);
    const baseVertex = sm.baseVertex || 0;
    for (let i = 0; i < count; i += 3) {
      const o = sm.firstByte + i * isz;
      if (o + 3 * isz > ib.length) { badIndices++; continue; }
      const rd = (p) => (wide ? ib.readUInt32LE(p) : ib.readUInt16LE(p)) + baseVertex;
      const a = rd(o), b = rd(o + isz), c = rd(o + 2 * isz);
      if (a >= vertexCount || b >= vertexCount || c >= vertexCount) { badIndices++; continue; }
      tri.push(a, b, c);
    }
  }
  return { positions, normals, indices: Uint32Array.from(tri), vertexCount, badIndices };
}

export function levelColliderTriangles(sf, resS) {
  const stats = { meshColliders: 0, boxColliders: 0, skippedCompressed: 0, skippedExternal: 0, skippedDisabled: 0, skippedNullMesh: 0, skippedFormat: 0, badIndices: 0, triangles: 0 };
  const objCache = new Map();
  const read = (id) => { let v = objCache.get(id); if (v === undefined) { v = sf.readObject(id); objCache.set(id, v); } return v; };
  const has = (pptr) => pptr && pptr.m_FileID === 0 && pptr.m_PathID !== 0n && sf.objects.has(pptr.m_PathID);

  const worldCache = new Map();
  function worldOf(tid) {
    if (worldCache.has(tid)) return worldCache.get(tid);
    const t = read(tid);
    const local = trsMatrix(t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale);
    const m = has(t.m_Father) ? mulMatrix(worldOf(t.m_Father.m_PathID), local) : local;
    worldCache.set(tid, m); return m;
  }
  const transformOfGO = new Map();
  function transformOf(goId) {
    if (transformOfGO.has(goId)) return transformOfGO.get(goId);
    let tid = null;
    for (const c of read(goId).m_Component || []) {
      const p = c.component; if (!has(p)) continue;
      const cls = sf.objects.get(p.m_PathID).classID;
      if (cls === CLASS_TRANSFORM || cls === CLASS_RECT_TRANSFORM) { tid = p.m_PathID; break; }
    }
    transformOfGO.set(goId, tid); return tid;
  }
  // Active in hierarchy: this GameObject and every ancestor's GameObject is active.
  const activeCache = new Map();
  function activeTransform(tid) {
    if (activeCache.has(tid)) return activeCache.get(tid);
    const t = read(tid);
    let a = has(t.m_GameObject) ? !!read(t.m_GameObject.m_PathID).m_IsActive : true;
    if (a && has(t.m_Father)) a = activeTransform(t.m_Father.m_PathID);
    activeCache.set(tid, a); return a;
  }
  // Resolve a collider to its world matrix, or null (counted as disabled).
  function colliderMatrix(col) {
    if (!col.m_Enabled || !has(col.m_GameObject)) return null;
    const tid = transformOf(col.m_GameObject.m_PathID);
    if (tid === null || !activeTransform(tid)) return null;
    return worldOf(tid);
  }

  const out = triBuffer();
  const meshCache = new Map();
  for (const o of sf.byClass(CLASS_MESH_COLLIDER)) {
    const mc = read(o.pathID);
    const m = colliderMatrix(mc);
    if (!m) { stats.skippedDisabled++; continue; }
    const mp = mc.m_Mesh;
    if (!mp || mp.m_PathID === 0n) { stats.skippedNullMesh++; continue; }
    if (mp.m_FileID !== 0 || !sf.objects.has(mp.m_PathID)) { stats.skippedExternal++; continue; }
    let dm = meshCache.get(mp.m_PathID);
    if (!dm) { dm = decodeMesh(sf.readObject(mp.m_PathID), resS); meshCache.set(mp.m_PathID, dm); if (dm.badIndices) stats.badIndices += dm.badIndices; }
    if (dm.skip) {
      if (dm.skip === 'compressed') stats.skippedCompressed++;
      else if (dm.skip === 'external') stats.skippedExternal++;
      else stats.skippedFormat++;
      continue;
    }
    const P = dm.positions, I = dm.indices;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      out.push9(m, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
    }
    stats.meshColliders++;
  }

  // Box corner index -> sign pattern; 12 triangles over 6 faces.
  const BOX_FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const o of sf.byClass(CLASS_BOX_COLLIDER)) {
    const bc = read(o.pathID);
    const m = colliderMatrix(bc);
    if (!m) { stats.skippedDisabled++; continue; }
    const c = bc.m_Center, s = bc.m_Size;
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push([c.x + (i & 4 ? 0.5 : -0.5) * s.x, c.y + (i & 2 ? 0.5 : -0.5) * s.y, c.z + (i & 1 ? 0.5 : -0.5) * s.z]);
    for (const [a, b, d, e] of BOX_FACES) {
      out.push9(m, ...corners[a], ...corners[b], ...corners[d]);
      out.push9(m, ...corners[a], ...corners[d], ...corners[e]);
    }
    stats.boxColliders++;
  }

  stats.triangles = out.count;
  return { tris: out.result(), stats };
}
