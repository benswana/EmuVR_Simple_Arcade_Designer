import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, normalizeName, parseTpGamePath } from '../src/catalog.js';

test('normalizeName strips prefix, hash, punctuation', () => {
  assert.equal(normalizeName('Arcade_Pac-Man_aaaa1111'), 'pac man');
  assert.equal(normalizeName('HALO Fireteam Raven Twin'), 'halo fireteam raven twin');
});
test('parseTpGamePath reads GamePath', () => {
  assert.equal(parseTpGamePath('<GameProfile><GamePath>D:\\g\\x.exe</GamePath></GameProfile>'), 'D:\\g\\x.exe');
  assert.equal(parseTpGamePath('<GameProfile><GamePath></GamePath></GameProfile>'), '');
});
test('buildCatalog assembles models, games, sets', () => {
  const c = buildCatalog({
    ugcNames: ['Arcade_Pac-Man_aaaa1111'],
    gameFiles: { 'MAME': ['pacman.zip'], 'Arcade (Capture)': ['Daytona USA.win'] },
    winTexts: { 'Games\\Arcade (Capture)\\Daytona USA.win': 'emulator_multicpu.exe daytona' },
    tpProfiles: { SR3: '<GameProfile><GamePath>X</GamePath></GameProfile>' },
    m2Roms: ['daytona.zip'], m3Roms: [], videoNames: ['pacman']
  });
  assert.deepEqual(c.models[0], { id: 'ugc_Arcade_Pac-Man_aaaa1111', name: 'Arcade_Pac-Man_aaaa1111', key: 'pac man' });
  assert.equal(c.games.length, 2);
  assert.deepEqual(c.games[0], { path: 'Games\\MAME\\pacman.zip', system: 'MAME', file: 'pacman.zip', key: 'pacman' });
  assert.equal(c.tpProfiles.get('SR3').gamePath, 'X');
  assert.ok(c.m2Roms.has('daytona')); assert.ok(c.videos.has('pacman'));
  assert.equal(c.winTexts.get('Games\\Arcade (Capture)\\Daytona USA.win'), 'emulator_multicpu.exe daytona');
});
