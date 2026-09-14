import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchability } from '../src/linking.js';

test('a game named inside an archive ("x.zip#member") is live when the archive exists', () => {
  const zip = 'Games\\Sega Genesis\\Sonic the Hedgehog (USA, Europe).zip';
  const c = { fileExists: (p) => p === zip };
  assert.equal(launchability(zip + '#Sonic the Hedgehog (USA, Europe).md', c).status, 'live');
  assert.equal(launchability('Games\\Sega Genesis\\Other.zip#Other.md', c).status, 'dead');
});
