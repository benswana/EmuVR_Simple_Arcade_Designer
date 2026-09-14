import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandStack } from '../src/undo.js';
test('execute/undo/redo', () => {
  let v = 0; const s = new CommandStack();
  s.execute({ label: 'inc', do: () => { v++; }, undo: () => { v--; } });
  assert.equal(v, 1); assert.ok(s.canUndo && !s.canRedo);
  s.undo(); assert.equal(v, 0); assert.ok(s.canRedo);
  s.redo(); assert.equal(v, 1);
  s.execute({ label: 'inc', do: () => { v++; }, undo: () => { v--; } });
  assert.ok(!s.canRedo);
});
