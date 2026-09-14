import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelIdOf, levelCandidates, levelDisplayName, levelWallsFit, isLevelBundleFile, transformOutline, emptyTrace, addCorner, closeRun, removeLastCorner, traceSegments, serializeTrace, parseTrace, wallBounds } from '../src/walls.js';
import { quatFromYaw } from '../src/quat.js';
test('levelIdOf finds the level object in objects or systems', () => {
  assert.equal(levelIdOf({ objects: [{ embedded_screen: 0 }, { id: 'ugc_Level_X_12345678', rotation: { x: 0, y: 0, z: 0, w: 1 } }], systems: [] }), 'ugc_Level_X_12345678');
  assert.equal(levelIdOf({ objects: [], systems: [] }), null);
});
test('level objects are recognised by level bundle id, not by the ugc_Level_ prefix', () => {
  const ids = new Set(['ugc_Blockbuster_Video_0837ee25', 'ugc_Blockbuster_Screen_Set_f6a901ec']);
  const room = { objects: [{ embedded_screen: 0 }, { id: 'ugc_Blockbuster_Video_0837ee25' }, { id: 'ugc_Blockbuster_Screen_Set_f6a901ec' }], systems: [{ id: 'ugc_Blockbuster_Video_0837ee25' }, { id: 'ugc_Arcade_X_12345678' }] };
  assert.equal(levelIdOf(room, ids), 'ugc_Blockbuster_Video_0837ee25');
  assert.deepEqual(levelCandidates(room, ids).map(o => o.id), ['ugc_Blockbuster_Video_0837ee25', 'ugc_Blockbuster_Screen_Set_f6a901ec']);
  assert.equal(levelDisplayName('ugc_Level_Entertainment_Arcade_9e2f95d3'), 'Entertainment Arcade');
  assert.equal(levelDisplayName('ugc_Blockbuster_Video_0837ee25'), 'Blockbuster Video');
});
test('level bundles are the stopgap-converted files; props in the Levels folder are not', () => {
  assert.equal(isLevelBundleFile('F:\\games\\RAVE\\Custom\\UGC\\Levels\\Flynns_Arcade_ffd9b269_[temp_level_stopgap_1234578].ugc'), true);
  assert.equal(isLevelBundleFile('Level_Entertainment_Arcade_9e2f95d3 _[temp_level_stopgap_1234578a].ugc'), true);
  assert.equal(isLevelBundleFile('Blockbuster_Screen_Set_f6a901ec.ugc'), false);
  assert.equal(isLevelBundleFile('Blockbuster_Shelves_DVD_and_Tapes_bea93f3d.ugc'), false);
});
test('a level cache is drawn when its outline is sane and the room places the level unscaled and untilted', () => {
  const segs = []; // 10 m square in 1 m pieces
  for (let i = 0; i < 10; i++) segs.push([i, 0, i + 1, 0], [10, i, 10, i + 1], [i + 1, 10, i, 10], [0, i + 1, 0, i]);
  const id = 'ugc_L_12345678', json = { segments: segs };
  assert.deepEqual(levelWallsFit(json, { id }), { ok: true, reason: null });
  assert.equal(levelWallsFit(json, { id, scale: { x: 1, y: 1, z: 1 } }).ok, true);
  assert.equal(levelWallsFit(json, { id, position: { x: 30, y: 0, z: -4 }, rotation: quatFromYaw(1.2), scale: 1 }).ok, true);
  assert.deepEqual(levelWallsFit(json, { id, scale: 75 }), { ok: false, reason: 'level is scaled x75 in this room' });
  assert.deepEqual(levelWallsFit(json, { id, rotation: { x: Math.sin(0.1), y: 0, z: 0, w: Math.cos(0.1) } }), { ok: false, reason: 'level is tilted in this room' });
  assert.equal(levelWallsFit({ segments: segs.slice(0, 3) }, { id }).ok, false);
  assert.equal(levelWallsFit({ segments: [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]] }, { id }).reason, 'level outline cache is too small');
  assert.equal(levelWallsFit(null, { id }).ok, false);
});
test('transformOutline applies position, 90deg yaw and scale', () => {
  const out = transformOutline([[1, 0, 2, 0]], { position: { x: 10, y: 0, z: 0 }, rotation: quatFromYaw(Math.PI / 2), scale: 2 });
  const [x1, z1, x2, z2] = out[0].map(v => Math.round(v * 1e6) / 1e6);
  assert.deepEqual([x1, z1, x2, z2], [10, -2, 10, -4]);
});
test('trace: corners snap, axis lock, close, undo, serialize', () => {
  let t = emptyTrace();
  t = addCorner(t, 0.04, 0.06); t = addCorner(t, 5.02, 0.3, { axisLock: true }); t = addCorner(t, 5, 4);
  assert.deepEqual(t.current, [[0, 0.1], [5, 0.1], [5, 4]]);
  t = removeLastCorner(t); assert.equal(t.current.length, 2);
  t = addCorner(t, 5, 4); t = closeRun(t);
  assert.equal(t.runs.length, 1); assert.equal(t.current.length, 0);
  assert.equal(traceSegments(t).length, 2); // 3 corners in an open run = 2 wall segments
  const back = parseTrace(serializeTrace('6', t)); assert.deepEqual(back.runs, t.runs);
  assert.deepEqual(wallBounds([traceSegments(t)]), { minX: 0, maxX: 5, minZ: 0.1, maxZ: 4 });
});
