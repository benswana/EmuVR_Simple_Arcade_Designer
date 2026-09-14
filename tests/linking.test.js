import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/catalog.js';
import { launchability, launchableGames, suggestGamesForModel, suggestModelsForGame, hasAttractVideo } from '../src/linking.js';

const mk = (over = {}) => buildCatalog({
  ugcNames: ['Arcade_Pac-Man_aaaa1111', 'Arcade_Daytona_USA_cccc3333'],
  gameFiles: { 'MAME': ['pacman.zip'], 'Arcade (Capture)': ['Daytona USA.win', 'SEGA Rally 3.win', 'Tomb Raider.win', 'Mystery.win', 'Elsewhere.win', 'Drug Wars.win', 'Dragon.win'] },
  winTexts: {
    'Games\\Arcade (Capture)\\Daytona USA.win': 'emulator_multicpu.exe daytona',
    'Games\\Arcade (Capture)\\SEGA Rally 3.win': 'start "TeknoParrotUi.exe" --profile=SR3.xml',
    'Games\\Arcade (Capture)\\Tomb Raider.win': 'start "TeknoParrotUi.exe" --profile=TombRaider.xml',
    'Games\\Arcade (Capture)\\Elsewhere.win': 'start "TeknoParrotUi.exe" --profile=Else.xml',
    'Games\\Arcade (Capture)\\Mystery.win': 'someother.exe',
    'Games\\Arcade (Capture)\\Drug Wars.win': 'cd "..\\..\\Emulators\\Daphne"\nstart daphne.exe singe vldp -x 1920 -y 1080 -framefile vldp\\drugwars\\drugwars.txt -script singe/drugwars/drugwars.singe',
    'Games\\Arcade (Capture)\\Dragon.win': 'cd "..\\..\\Emulators\\Daphne"\nstart daphne.exe lair vldp -framefile vldp\\lair\\lair.txt',
  },
  tpProfiles: { SR3: '<GameProfile><GamePath>D:\\SR3\\Rally.exe</GamePath></GameProfile>', TombRaider: '<GameProfile><GamePath></GamePath></GameProfile>', Else: '<GameProfile><GamePath>E:\\x\\y.exe</GamePath></GameProfile>' },
  m2Roms: ['daytona.zip'], m3Roms: [], videoNames: ['pacman', 'daytona usa'], daphneFrames: ['vldp\\drugwars\\drugwars.txt', 'vldp\\DLCDROM\\list.txt'],
  fileExists: () => true, tpGamePathExists: (p) => p === 'D:\\SR3\\Rally.exe' ? true : p === 'E:\\x\\y.exe' ? null : false, ...over,
});

test('TeknoParrot GamePath that cannot be probed is unknown, not live', () => {
  const t = launchability('Games\\Arcade (Capture)\\Elsewhere.win', mk());
  assert.equal(t.status, 'unknown'); assert.match(t.reason, /not verifiable/i);
});
test('Daphne: framefile present is live, missing is dead with the path, no listing is unknown', () => {
  const c = mk();
  assert.equal(launchability('Games\\Arcade (Capture)\\Drug Wars.win', c).status, 'live');
  const d = launchability('Games\\Arcade (Capture)\\Dragon.win', c);
  assert.equal(d.status, 'dead'); assert.match(d.reason, /vldp\\lair\\lair\.txt/);
  assert.equal(launchability('Games\\Arcade (Capture)\\Drug Wars.win', mk({ daphneFrames: undefined })).status, 'unknown');
});

test('MAME rom present is live; missing is dead', () => {
  assert.equal(launchability('Games\\MAME\\pacman.zip', mk()).status, 'live');
  assert.equal(launchability('Games\\MAME\\pacman.zip', mk({ fileExists: () => false })).status, 'dead');
});
test('TeknoParrot: wired profile live, empty GamePath dead with reason', () => {
  const c = mk();
  assert.equal(launchability('Games\\Arcade (Capture)\\SEGA Rally 3.win', c).status, 'live');
  const t = launchability('Games\\Arcade (Capture)\\Tomb Raider.win', c);
  assert.equal(t.status, 'dead'); assert.match(t.reason, /game location/i);
});
test('Model2 rom owned live; unknown launcher unknown', () => {
  const c = mk();
  assert.equal(launchability('Games\\Arcade (Capture)\\Daytona USA.win', c).status, 'live');
  assert.equal(launchability('Games\\Arcade (Capture)\\Mystery.win', c).status, 'unknown');
});
test('launchableGames excludes dead and (by default) unknown', () => {
  const paths = launchableGames(mk()).map(g => g.path);
  assert.ok(paths.includes('Games\\MAME\\pacman.zip'));
  assert.ok(!paths.includes('Games\\Arcade (Capture)\\Tomb Raider.win'));
  assert.ok(!paths.includes('Games\\Arcade (Capture)\\Mystery.win'));
  assert.ok(launchableGames(mk(), { includeUnknown: true }).some(g => g.path.endsWith('Mystery.win')));
});
test('suggestions pair by normalised name', () => {
  const c = mk();
  assert.equal(suggestGamesForModel('ugc_Arcade_Daytona_USA_cccc3333', c)[0].path, 'Games\\Arcade (Capture)\\Daytona USA.win');
  assert.equal(suggestModelsForGame('Games\\MAME\\pacman.zip', c)[0].id, 'ugc_Arcade_Pac-Man_aaaa1111');
});
test('attract video by basename', () => {
  const c = mk();
  assert.equal(hasAttractVideo('Games\\MAME\\pacman.zip', c), true);
  assert.equal(hasAttractVideo('Games\\Arcade (Capture)\\SEGA Rally 3.win', c), false);
});
