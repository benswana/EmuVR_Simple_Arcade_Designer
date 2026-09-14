import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lz4Block } from '../tools/unity/lz4.mjs';
import { openBundle } from '../tools/unity/bundle.mjs';
const P = 'F:\\games\\RAVE\\Custom\\UGC\\Levels\\Level_Entertainment_Arcade_9e2f95d3 _[temp_level_stopgap_1234578a].ugc';

test('lz4 literal-only block', () => {
  // token 0x50 = 5 literals, no match
  assert.equal(lz4Block(Buffer.from([0x50, 104, 101, 108, 108, 111]), 5).toString(), 'hello');
});
test('lz4 block with a back-reference', () => {
  // "abc" literals then match offset 3 length 6 -> "abcabcabc"
  const src = Buffer.from([0x32, 97, 98, 99, 0x03, 0x00]);
  assert.equal(lz4Block(src, 9).toString(), 'abcabcabc');
});
test('reads the real Entertainment Arcade bundle index', { skip: !existsSync(P) }, () => {
  const b = openBundle(P);
  assert.equal(b.engine, '2018.4.12f1');
  assert.equal(b.nodes.length, 2);
  const main = b.nodes.find(n => !n.path.endsWith('.resS'));
  const buf = b.readNode(main.path);
  assert.equal(buf.length, main.size);
  // SerializedFile header: version 17 at byte 8 (big-endian)
  assert.equal(buf.readUInt32BE(8), 17);
  b.close();
});
