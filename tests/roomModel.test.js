import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Room, isScaffold, isPlaced } from '../src/roomModel.js';
import { yawFromQuat, radians, planHeading } from '../src/quat.js';

const fixtureText = () => readFileSync(new URL('./fixtures/mini_room.json', import.meta.url), 'utf8');
const byId = (r, part) => r.placed().find(o => o.id.includes(part));

test('parse classifies scaffold vs placed across objects and systems', () => {
  const r = Room.parse(fixtureText());
  assert.equal(r.scaffold().length, 3);
  assert.equal(r.placed().length, 5); // 1 decor in objects + 4 in systems; cartridges in games are not placed
  assert.equal(r.maxScreen(), 2);
  assert.ok(isScaffold(r.objects[0]) && !isPlaced(r.objects[0]));
  assert.ok(isPlaced(r.objects[3]) && isPlaced(r.systems[0]));
  assert.equal(r.homeOf(r.systems[0]), 'systems'); assert.equal(r.homeOf(r.objects[3]), 'objects'); assert.equal(r.homeOf(r.games[0]), 'games');
});
test('serialize has no BOM, keeps top-level keys and order', () => {
  const r = Room.parse(fixtureText());
  const out = r.serialize();
  assert.equal(out.charCodeAt(0), 0x7b);
  const back = JSON.parse(out);
  assert.deepEqual(Object.keys(back), ['version', 'time', 'season', 'objects', 'systems', 'games']);
  assert.equal(back.objects.length, 4); assert.equal(back.systems.length, 4); assert.equal(back.games.length, 1);
});
test('parse does not invent a games array', () => {
  const r = Room.parse(JSON.stringify({ version: 6, objects: [], systems: [] }));
  assert.deepEqual(Object.keys(JSON.parse(r.serialize())), ['version', 'objects', 'systems']);
});
test('validate passes on the fixture', () => {
  const v = Room.parse(fixtureText()).validate();
  assert.deepEqual(v.errors, []);
});
test('validate detects an orphaned screen', () => {
  const r = Room.parse(fixtureText());
  r.systems.splice(0, 1); // drop Pac-Man but leave its scaffold
  const v = r.validate();
  assert.ok(v.errors.some(e => /screen 0.*once/i.test(e)));
});
test('validate detects scaffold not first', () => {
  const r = Room.parse(fixtureText());
  const s = r.objects.shift(); r.objects.push(s);
  assert.ok(r.validate().errors.some(e => /scaffold/i.test(e)));
});
test('validate warns on duplicate game paths and dead games', () => {
  const r = Room.parse(fixtureText());
  r.systems[1].path = r.systems[0].path;
  const v = r.validate({ launchability: () => 'dead' });
  assert.ok(v.warnings.some(w => /duplicate/i.test(w)));
  assert.ok(v.warnings.some(w => /dead/i.test(w)));
  assert.deepEqual(v.errors, []);
});
test('missing frozen is a warning, not an error, and is left untouched', () => {
  const r = Room.parse(fixtureText());
  delete r.systems[0].frozen; delete r.objects[3].frozen;
  const v = r.validate();
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some(w => /2 object\(s\) have no frozen/i.test(w)));
  assert.equal('frozen' in r.systems[0], false);
});
test('validate rejects non-numeric position/rotation/scale but accepts a vector scale', () => {
  const r = Room.parse(fixtureText());
  r.setScale(r.systems[3], { x: 1.25, y: 0.945, z: 1.25 }); // EmuVR non-uniform scale
  assert.deepEqual(r.validate().errors, []);
  r.setScale(r.systems[0], NaN); r.systems[1].position.x = null; r.systems[2].rotation.w = 'x';
  const e = r.validate().errors;
  assert.ok(e.some(x => /scale is not numeric/.test(x)));
  assert.ok(e.some(x => /position is not numeric/.test(x)));
  assert.ok(e.some(x => /rotation is not numeric/.test(x)));
});
test('validate rejects an arcade cabinet with a game but no screen', () => {
  const r = Room.parse(fixtureText());
  r.systems.push({ id: 'ugc_Arcade_X_00000000', path: 'Games\\MAME\\x.zip', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, frozen: true });
  assert.ok(r.validate().errors.some(e => /has a game but no embedded_screen/.test(e)));
  // consoles carry a path without a screen in real rooms: allowed
  r.systems.pop(); r.setGame(r.systems[3], 'Games\\PS2\\x.iso');
  assert.deepEqual(r.validate().errors, []); assert.equal('embedded_screen' in r.systems[3], false);
});

test('setters change only the intended fields', () => {
  const r = Room.parse(fixtureText());
  const o = r.systems[0]; const before = JSON.stringify(o);
  r.setPosition(o, 5, 0, 7);
  assert.deepEqual(o.position, { x: 5, y: 0, z: 7 });
  r.setYaw(o, radians(90));
  assert.ok(Math.abs(yawFromQuat(o.rotation) - radians(90)) < 1e-9);
  assert.equal(o.rotation.x, 0); assert.equal(o.rotation.z, 0);
  r.setScale(o, 2.5); assert.equal(o.scale, 2.5);
  r.setGame(o, 'Games\\MAME\\galaga.zip'); assert.equal(o.path, 'Games\\MAME\\galaga.zip');
  r.setGame(o, null); assert.equal('path' in o, false);
  r.setFrozen(o, false); assert.equal(o.frozen, false);
  assert.equal(o.embedded_screen, 0); // untouched
  assert.notEqual(JSON.stringify(o), before);
});
test('setGame drops the EmuVR-owned crc/open of the previous game', () => {
  const r = Room.parse(fixtureText());
  const o = r.systems[0]; o.crc = '78D28959|crc';
  r.setGame(o, o.path); assert.equal(o.open, true); assert.equal(o.crc, '78D28959|crc'); // same game: untouched
  r.setGame(o, 'Games\\MAME\\galaga.zip');
  assert.equal('open' in o, false); assert.equal('crc' in o, false);
});
test('setGame allocates a paired screen for an arcade cabinet that has none; releaseScreen undoes it', () => {
  const r = Room.parse(fixtureText());
  const o = { id: 'ugc_Arcade_Frogger_eeee5555', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, frozen: true };
  r.systems.push(o);
  r.setGame(o, 'Games\\MAME\\frogger.zip');
  assert.equal(o.embedded_screen, 3); assert.deepEqual(r.objects[3], { embedded_screen: 3 }); assert.deepEqual(r.validate().errors, []);
  r.setGame(o, null); r.releaseScreen(o);
  assert.equal('embedded_screen' in o, false); assert.equal(r.maxScreen(), 2); assert.deepEqual(r.validate().errors, []);
});
test('rotation is composed so a tilted (Z-up authored) model keeps its tilt', () => {
  const r = Room.parse(fixtureText());
  const o = r.systems[0]; o.rotation = { x: 0.7071068, y: 0, z: 0, w: -0.7071068 }; // 90-degree X tilt, yaw 0
  assert.ok(Math.abs(yawFromQuat(o.rotation)) < 1e-6);
  r.rotateYaw(o, radians(90));
  assert.ok(Math.abs(o.rotation.x) > 0.4, 'x component preserved: ' + JSON.stringify(o.rotation));
  assert.ok(Math.abs(yawFromQuat(o.rotation) - radians(90)) < 1e-6);
  r.setYaw(o, 0);
  for (const k of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(o.rotation[k] - { x: 0.7071068, y: 0, z: 0, w: -0.7071068 }[k]) < 1e-6, k);
});
test('setYaw sets the plan heading and is idempotent for a model rolled 90 degrees about Z', () => {
  const r = Room.parse(fixtureText());
  const o = r.systems[0]; o.rotation = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }; // right axis vertical
  r.setYaw(o, radians(90));
  assert.ok(Math.abs(planHeading(o.rotation) - radians(90)) < 1e-9, String(planHeading(o.rotation)));
  const once = { ...o.rotation };
  r.setYaw(o, radians(90));
  for (const k of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(o.rotation[k] - once[k]) < 1e-9, k);
});
test('setModel flags the object as unverified unless told otherwise', () => {
  const r = Room.parse(fixtureText());
  const o = r.systems[0];
  r.setModel(o, 'ugc_Arcade_Galaga_bbbb2222');
  assert.ok(r.unverified.has(o));
  r.setModel(o, 'ugc_Arcade_Pac-Man_aaaa1111', { verified: true });
  assert.ok(!r.unverified.has(o));
});

test('add appends scaffold in-block and cabinet at end of systems, keeps invariant', () => {
  const r = Room.parse(fixtureText());
  const o = r.add({ id: 'ugc_Arcade_Frogger_eeee5555', path: 'Games\\MAME\\frogger.zip', x: 9, z: 2, yaw: 0, scale: 1 });
  assert.equal(r.maxScreen(), 3);
  assert.deepEqual(r.objects[3], { embedded_screen: 3 });
  assert.equal(r.systems[r.systems.length - 1], o); assert.equal(r.objects.includes(o), false);
  assert.equal(o.embedded_screen, 3);
  assert.equal(o.frozen, true);
  assert.equal('crc' in o, false); assert.equal('open' in o, false);
  assert.deepEqual(o.rotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(r.validate().errors, []);
  assert.ok(r.unverified.has(o));
});
test('add of an arcade cabinet without a game still gets a paired screen (assign game later)', () => {
  const r = Room.parse(fixtureText());
  const o = r.add({ id: 'ugc_Arcade_Frogger_eeee5555', x: 0, z: 0 });
  assert.equal(o.embedded_screen, 3); assert.equal(r.maxScreen(), 3); assert.equal(r.homeOf(o), 'systems');
  assert.equal('path' in o, false);
  assert.deepEqual(r.validate().errors, []);
  r.setGame(o, 'Games\\MAME\\frogger.zip'); assert.equal(o.embedded_screen, 3); assert.equal(r.maxScreen(), 3); // no second allocation
});
test('add of non-arcade decor without path makes decor in objects (no screen)', () => {
  const r = Room.parse(fixtureText());
  const o = r.add({ id: 'ugc_Decor_Sign_ffff6666', x: 0, z: 0 });
  assert.equal('embedded_screen' in o, false); assert.equal(r.homeOf(o), 'objects');
  assert.equal(r.maxScreen(), 2);
  assert.deepEqual(r.validate().errors, []);
});

test('remove deletes object and its scaffold and renumbers across arrays', () => {
  const r = Room.parse(fixtureText());
  const galaga = byId(r, 'Galaga'); // screen 1
  r.remove(galaga);
  assert.equal(r.maxScreen(), 1);
  assert.deepEqual(r.scaffold().map(s => s.embedded_screen), [0, 1]);
  assert.equal(byId(r, 'Daytona').embedded_screen, 1); // was 2
  assert.equal(r.placed().length, 4); assert.equal(r.systems.length, 3);
  assert.deepEqual(r.validate().errors, []);
});
test('remove decor leaves screens untouched', () => {
  const r = Room.parse(fixtureText());
  r.remove(r.objects[3]);
  assert.equal(r.maxScreen(), 2); assert.equal(r.objects.length, 3);
  assert.deepEqual(r.validate().errors, []);
});
test('snapshot/restore undoes a remove exactly', () => {
  const r = Room.parse(fixtureText()); const before = r.serialize();
  const snap = r.snapshot(); r.remove(byId(r, 'Galaga')); assert.notEqual(r.serialize(), before);
  r.restore(snap); assert.equal(r.serialize(), before);
});
