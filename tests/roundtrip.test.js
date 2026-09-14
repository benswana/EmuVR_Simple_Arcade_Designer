import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Room } from '../src/roomModel.js';
const P = 'F:\\games\\RAVE\\Saved Data\\Rooms\\Slot6.json';
test('semantic round-trip of the real Slot6', { skip: !existsSync(P) }, () => {
  const text = readFileSync(P, 'utf8'); const a = Room.parse(text); const out = a.serialize(); const b = Room.parse(out);
  assert.equal(out.charCodeAt(0), 0x7b);
  assert.deepEqual(Object.keys(b.raw), Object.keys(JSON.parse(text.replace(/^\uFEFF/, ''))));
  for (const k of ['objects', 'systems', 'games']) {
    assert.equal(a[k].length, b[k].length, k);
    for (let i = 0; i < a[k].length; i++) assert.deepEqual(b[k][i], a[k][i]);
  }
  assert.deepEqual(a.validate().errors, []); assert.deepEqual(b.validate().errors, []);
});
test('add then remove on the real room restores the invariant', { skip: !existsSync(P) }, () => {
  const r = Room.parse(readFileSync(P, 'utf8')); const n = r.objects.length, ns = r.systems.length, max = r.maxScreen();
  const o = r.add({ id: 'ugc_Arcade_Test_deadbeef', path: 'Games\\MAME\\pacman.zip', x: 0, z: 0 });
  assert.equal(r.maxScreen(), max + 1); assert.equal(r.systems.length, ns + 1); assert.deepEqual(r.validate().errors, []);
  r.remove(o); assert.equal(r.objects.length, n); assert.equal(r.systems.length, ns); assert.equal(r.maxScreen(), max); assert.deepEqual(r.validate().errors, []);
});
