import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { analyseModel } from '../tools/unity/model.mjs';
import { modelIdFromFile, indexText } from '../tools/extract_models.mjs';

const A = 'F:\\games\\RAVE\\Custom\\UGC\\Arcade\\';
const SF3 = A + 'Arcade_Street_Fighter_III_3rd_Strike_4b3ea15c.ugc';
const GALAGA = A + 'Arcade_Galaga_a3762074.ugc';
const DDR = A + 'Arcade_DDR_5fb2b91f.ugc';
const faces = (front, dir) => front && front[0] * dir[0] + front[1] * dir[1] > 0.9;

test('Street Fighter III: its screen faces object -X, and its visible bounds are cabinet-sized', { skip: !existsSync(SF3) }, () => {
  const s = analyseModel(SF3);
  assert.ok(faces(s.front, [-1, 0]), JSON.stringify(s.front));
  assert.ok(s.screens >= 1);
  const [w, h, d] = [0, 1, 2].map(k => s.max[k] - s.min[k]);
  assert.ok(h > 1.7 && h < 2.3, 'height ' + h);
  assert.ok(w > 0.7 && w < 1.4 && d > 0.7 && d < 1.4, `footprint ${w} x ${d}`);
});

test('Galaga: the 90 degree turn stored on its root is replaced by the room rotation, so its screen faces root-local -X', { skip: !existsSync(GALAGA) }, () => {
  const s = analyseModel(GALAGA);
  assert.ok(faces(s.front, [-1, 0]), JSON.stringify(s.front)); // its "front", "coindoor" and "joystick" parts sit at local -X too
});

const RAMPAGE = A + 'Arcade_Rampage_5f9a5194.ugc';
test('Rampage (root turned 90 degrees, seen 90 degrees off in VR before this fix): screen faces root-local -X', { skip: !existsSync(RAMPAGE) }, () => {
  assert.ok(faces(analyseModel(RAMPAGE).front, [-1, 0]), JSON.stringify(analyseModel(RAMPAGE).front));
});

test('DDR: screen faces object +Z', { skip: !existsSync(DDR) }, () => {
  assert.ok(faces(analyseModel(DDR).front, [0, 1]));
});

test('model ids come from the bundle file name', () => {
  assert.equal(modelIdFromFile('F:\\games\\RAVE\\Custom\\UGC\\Arcade\\Arcade_Galaga_a3762074.ugc'), 'ugc_Arcade_Galaga_a3762074');
  assert.equal(modelIdFromFile('DVD_Case_(Green)_9533fe73.ugc'), 'ugc_DVD_Case_(Green)_9533fe73');
  assert.equal(modelIdFromFile('readme.txt'), null);
});

test('the index is valid JSON with one model per line, sorted by id', () => {
  const text = indexText({ ugc_b: { min: [0, 0, 0], max: [1, 1, 1], front: null, screens: 0, folder: 'Props' }, ugc_a: { min: null, max: null, front: [0, 1], screens: 1, folder: 'Arcade' } });
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed.models), ['ugc_a', 'ugc_b']);
  assert.equal(parsed.version, 1);
  assert.equal(text.split('\n').filter(l => l.includes('"ugc_')).length, 2);
});
