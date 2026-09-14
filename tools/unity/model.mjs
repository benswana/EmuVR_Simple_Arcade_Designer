// Shape of a UGC model bundle for the plan: the bounds of its visible meshes and the way its screen faces, in object
// space. Object space is the prefab root's local frame: the room object's position, rotation and scale REPLACE the
// root's own stored transform. Checked against the rooms:
// - rotation: on arcade models whose root carries a stored turn, dropping it puts the screen facing away from the
//   nearest wall in 233 distinct placements (40 toward, 68 sideways); keeping it, 71 / 33 / 237. (An earlier test that
//   favoured keeping it was dominated by DVD cases and used part names, which proved a coin flip.) The user saw the
//   same in VR: Rampage's root is turned 90 degrees and its front dot was drawn 90 degrees off.
// - scale: dropping the root scale gives 1,048 of 1,073 placed cabinets a 1-3 m height (keeping it: 791, some 180 m).
//
// The front is the facing of the renderer(s) using the material named "Screen" (EmuVR's embedded game screen). Its
// triangle winding and its stored vertex normals agree on 811 of 818 cabinets, and it faces away from the nearest wall
// in 88 % of decisive wall-side placements. Part names (front/back/controller) and body-behind-screen were coin flips.
import { openBundle } from './bundle.mjs';
import { parseSerialized } from './serialized.mjs';
import { trsMatrix, mulMatrix, decodeMesh } from './scene.mjs';

const CLASS_TRANSFORM = 4, CLASS_MESH_RENDERER = 23, CLASS_MESH_FILTER = 33, CLASS_RECT_TRANSFORM = 224;
const SCREEN_MATERIAL = /^screen$/i;
const MIN_LEVEL = 0.15; // a screen facing mostly up or down (floor-plane share below this) gives no front
const round = (v) => Math.round(v * 1e4) / 1e4 + 0;

// `resS` is the bundle's .resS buffer, or a function returning it (read only when a screen mesh keeps its data there).
export function modelShapeFromSerialized(sf, resS) {
  let resCache;
  const getRes = typeof resS === 'function' ? () => (resCache === undefined ? (resCache = resS()) : resCache) : () => resS;
  const has =(p) => !!p && p.m_FileID === 0 && p.m_PathID !== 0n && sf.objects.has(p.m_PathID);
  const classOf = (p) => (has(p) ? sf.objects.get(p.m_PathID).classID : -1);
  const transforms = new Map();
  for (const o of [...sf.byClass(CLASS_TRANSFORM), ...sf.byClass(CLASS_RECT_TRANSFORM)]) transforms.set(o.pathID, sf.readObject(o.pathID));

  const worldCache = new Map();
  const world = (tid) => {
    if (worldCache.has(tid)) return worldCache.get(tid);
    const t = transforms.get(tid), father = has(t.m_Father);
    const local = father ? trsMatrix(t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale)
      : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; // root: its whole stored transform is replaced by the room object's
    const m = father ? mulMatrix(world(t.m_Father.m_PathID), local) : local;
    worldCache.set(tid, m); return m;
  };
  const activeCache = new Map();
  const active = (tid) => {
    if (activeCache.has(tid)) return activeCache.get(tid);
    const t = transforms.get(tid);
    let a = has(t.m_GameObject) ? !!sf.readObject(t.m_GameObject.m_PathID).m_IsActive : true;
    if (a && has(t.m_Father)) a = active(t.m_Father.m_PathID);
    activeCache.set(tid, a); return a;
  };
  const componentOf = (goId, classes) => {
    const c = (sf.readObject(goId).m_Component || []).map(x => x.component).find(p => classes.includes(classOf(p)));
    return c ? c.m_PathID : null;
  };

  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const normal = [0, 0, 0];
  let renderers = 0, screens = 0;
  for (const r of sf.byClass(CLASS_MESH_RENDERER)) {
    const mr = sf.readObject(r.pathID);
    if (!mr.m_Enabled || !has(mr.m_GameObject)) continue;
    const go = mr.m_GameObject.m_PathID;
    const tid = componentOf(go, [CLASS_TRANSFORM, CLASS_RECT_TRANSFORM]);
    if (tid === null || !active(tid)) continue;
    const mfId = componentOf(go, [CLASS_MESH_FILTER]);
    if (mfId === null) continue;
    const meshPtr = sf.readObject(mfId).m_Mesh;
    if (!has(meshPtr)) continue;
    const mesh = sf.readObject(meshPtr.m_PathID), W = world(tid);
    const c = mesh.m_LocalAABB.m_Center, e = mesh.m_LocalAABB.m_Extent;
    for (let i = 0; i < 8; i++) {
      const p = [c.x + (i & 1 ? e.x : -e.x), c.y + (i & 2 ? e.y : -e.y), c.z + (i & 4 ? e.z : -e.z)];
      for (let k = 0; k < 3; k++) {
        const w = W[k * 4] * p[0] + W[k * 4 + 1] * p[1] + W[k * 4 + 2] * p[2] + W[k * 4 + 3];
        if (w < mn[k]) mn[k] = w; if (w > mx[k]) mx[k] = w;
      }
    }
    renderers++;
    const materials = (mr.m_Materials || []).filter(has).map(p => String(sf.readObject(p.m_PathID).m_Name));
    if (!materials.some(m => SCREEN_MATERIAL.test(m))) continue;
    const dm = decodeMesh(mesh, mesh.m_StreamData && mesh.m_StreamData.path ? getRes() : null);
    if (dm.skip) continue;
    // A mirrored transform (negative determinant) reverses triangle winding, and with it the cross-product normal.
    const det = W[0] * (W[5] * W[10] - W[6] * W[9]) - W[1] * (W[4] * W[10] - W[6] * W[8]) + W[2] * (W[4] * W[9] - W[5] * W[8]);
    const sign = det < 0 ? -1 : 1, P = dm.positions, I = dm.indices;
    const at = (v, k) => W[k * 4] * P[v * 3] + W[k * 4 + 1] * P[v * 3 + 1] + W[k * 4 + 2] * P[v * 3 + 2];
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], d = I[i + 2];
      const u = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)];
      const v = [at(d, 0) - at(a, 0), at(d, 1) - at(a, 1), at(d, 2) - at(a, 2)];
      normal[0] += sign * (u[1] * v[2] - u[2] * v[1]);
      normal[1] += sign * (u[2] * v[0] - u[0] * v[2]);
      normal[2] += sign * (u[0] * v[1] - u[1] * v[0]);
    }
    screens++;
  }
  const len = Math.hypot(...normal), level = Math.hypot(normal[0], normal[2]);
  return {
    min: renderers ? mn.map(round) : null,
    max: renderers ? mx.map(round) : null,
    front: screens && len > 0 && level / len > MIN_LEVEL ? [round(normal[0] / level), round(normal[2] / level)] : null,
    screens,
    renderers,
  };
}

export function analyseModel(bundlePath) {
  const bundle = openBundle(bundlePath);
  try {
    const serialized = bundle.nodes.filter(n => !/\.(resS|resource)$/i.test(n.path));
    if (serialized.length !== 1) throw new Error(`expected one SerializedFile in the bundle, found ${serialized.length}`);
    const node = serialized[0];
    const sf = parseSerialized(bundle.readNode(node.path));
    const res = bundle.nodes.find(n => n.path === node.path + '.resS');
    return modelShapeFromSerialized(sf, () => (res ? bundle.readNode(res.path) : null));
  } finally {
    bundle.close();
  }
}
