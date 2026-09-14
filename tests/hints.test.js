import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHints, hintFor } from '../src/hints.js';
const room = (objs) => JSON.stringify({ version: 6, time: 0, season: 0, objects: objs });
test('hints collect per-object scale by id across rooms, ignoring excluded slot', () => {
  const h = buildHints([
    { slot: '7', text: room([{ embedded_screen: 0 }, { id: 'ugc_A', embedded_screen: 0, position: {}, rotation: {}, scale: 0.03, frozen: true }, { id: 'ugc_B', position: {}, rotation: {}, frozen: true }]) },
    { slot: '8', text: room([{ id: 'ugc_A', position: {}, rotation: {}, scale: 0.03, frozen: true }, { id: 'ugc_A', position: {}, rotation: {}, scale: 5, frozen: true }]) },
    { slot: '6', text: room([{ id: 'ugc_A', position: {}, rotation: {}, scale: 99, frozen: true }]) },
  ], { excludeSlot: '6' });
  const a = hintFor('ugc_A', h);
  assert.equal(a.samples.length, 3); assert.equal(a.median, 0.03);
  assert.equal(hintFor('ugc_B', h).median, 1);       // absent scale means 1
  assert.equal(hintFor('ugc_Z', h), null);
});
test('hints see cabinets in systems[] and cartridges in games[]', () => {
  const h = buildHints([{ slot: '3', text: JSON.stringify({ version: 6, objects: [{ embedded_screen: 0 }], systems: [{ id: 'ugc_Arcade_Cab', embedded_screen: 0, position: {}, rotation: {}, scale: 0.02, frozen: true }], games: [{ id: 'ugc_Cart', path: 'x', position: {}, rotation: {}, scale: 3 }] }) }]);
  assert.equal(hintFor('ugc_Arcade_Cab', h).median, 0.02);
  assert.equal(hintFor('ugc_Cart', h).median, 3);
});
test('a vector scale contributes its uniform (x) part, not 1', () => {
  const h = buildHints([{ slot: '2', text: room([{ id: 'ugc_V', position: {}, rotation: {}, scale: { x: 0.02, y: 0.03, z: 0.02 }, frozen: true }]) }]);
  assert.equal(hintFor('ugc_V', h).median, 0.02);
});
test('hints never bleed a neighbouring object scale (regression)', () => {
  const h = buildHints([{ slot: '1', text: room([{ id: 'ugc_NoScale', position: {}, rotation: {}, frozen: true }, { id: 'ugc_Big', position: {}, rotation: {}, scale: 155, frozen: true }]) }]);
  assert.equal(hintFor('ugc_NoScale', h).median, 1);
});
