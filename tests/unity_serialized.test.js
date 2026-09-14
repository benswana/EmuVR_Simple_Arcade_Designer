import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openBundle } from '../tools/unity/bundle.mjs';
import { parseSerialized, commonString } from '../tools/unity/serialized.mjs';
const P = 'F:\\games\\RAVE\\Custom\\UGC\\Levels\\Level_Entertainment_Arcade_9e2f95d3 _[temp_level_stopgap_1234578a].ugc';
let sf; const load = () => { if (!sf) { const b = openBundle(P); const main = b.nodes.find(n => !n.path.endsWith('.resS')); sf = parseSerialized(b.readNode(main.path)); b.close(); } return sf; };

test('object table matches the probe', { skip: !existsSync(P) }, () => {
  const s = load();
  assert.equal(s.version, 17);
  assert.equal(s.objects.size, 36701);
  assert.equal(s.byClass(4).length, 9308);
  assert.equal(s.byClass(64).length, 3076);
  assert.equal(s.byClass(65).length, 33);
});
test('Transform type tree resolves names (common-string table is right)', { skip: !existsSync(P) }, () => {
  const s = load();
  const t = s.types.find(x => x.classID === 4).tree;
  assert.equal(t[0].type, 'Transform'); assert.equal(t[0].name, 'Base');
  const names = t.filter(n => n.depth === 1).map(n => n.name);
  for (const k of ['m_GameObject', 'm_LocalRotation', 'm_LocalPosition', 'm_LocalScale', 'm_Children', 'm_Father']) assert.ok(names.includes(k), k);
});
test('every Transform decodes to finite position and unit rotation', { skip: !existsSync(P) }, () => {
  const s = load(); let bad = 0;
  for (const o of s.byClass(4)) {
    const t = s.readObject(o.pathID); const q = t.m_LocalRotation, v = t.m_LocalPosition;
    const n = Math.hypot(q.x, q.y, q.z, q.w);
    if (!Number.isFinite(v.x + v.y + v.z) || Math.abs(n - 1) > 1e-3) bad++;
  }
  assert.equal(bad, 0);
});
test('a MeshCollider references a mesh', { skip: !existsSync(P) }, () => {
  const s = load(); const mc = s.readObject(s.byClass(64)[0].pathID);
  assert.ok(mc.m_Mesh && typeof mc.m_Mesh.m_PathID !== 'undefined');
});
test('common strings sit at Unity 2018.4 offsets', () => {
  assert.equal(commonString(0), 'AABB');
  assert.equal(commonString(55), 'Base');
  assert.equal(commonString(884), 'Transform');
  assert.equal(commonString(1161), 'Hash128');
});
test('geometry-relevant objects decode to exactly their byteSize', { skip: !existsSync(P) }, () => {
  const s = load();
  for (const cid of [1, 4, 33, 43, 64, 65]) {
    let bad = 0;
    for (const o of s.byClass(cid)) { const r = s.readObjectRaw(o.pathID); if (r.consumed !== r.byteSize) bad++; }
    assert.equal(bad, 0, 'class ' + cid);
  }
});
