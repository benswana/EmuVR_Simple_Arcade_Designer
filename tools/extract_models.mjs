// Model shapes for the plan: for every UGC model bundle (all Custom\UGC folders except Levels and Cache) record the
// bounds of its visible meshes and the way its screen faces (see tools/unity/model.mjs), in models/index.json.
//
//   node tools/extract_models.mjs
//   node tools/extract_models.mjs --ugc "<EmuVR folder>\Custom\UGC"
import { readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyseModel } from './unity/model.mjs';

// The editor lives in <EmuVR folder>\RoomEditor, so the EmuVR folder is two levels above tools\ (EMUVR_DIR overrides).
export const UGC_DIR = join(process.env.EMUVR_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'Custom', 'UGC');
export const INDEX_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'index.json');
const SKIP_FOLDERS = new Set(['levels', 'cache']); // level bundles have their own walls cache

// "Arcade_Galaga_a3762074.ugc" -> the room object id "ugc_Arcade_Galaga_a3762074".
export function modelIdFromFile(file) {
  const name = String(file).split(/[\\/]/).pop();
  return /\.ugc$/i.test(name) ? 'ugc_' + name.replace(/\.ugc$/i, '') : null;
}

// One model per line so the index diffs well.
export function indexText(models) {
  const ids = Object.keys(models).sort((a, b) => a.localeCompare(b));
  return '{\n  "version": 1,\n  "models": {\n' + ids.map(id => `    ${JSON.stringify(id)}: ${JSON.stringify(models[id])}`).join(',\n') + '\n  }\n}\n';
}

export function main(argv = process.argv.slice(2)) {
  let ugc = UGC_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ugc' && i + 1 < argv.length) ugc = argv[++i];
    else { console.error('usage: node tools/extract_models.mjs [--ugc "<Custom\\UGC>"]'); return 2; }
  }
  const t0 = Date.now(), models = {}, errors = [];
  let files = 0, withFront = 0, noBounds = 0;
  for (const folder of readdirSync(ugc).sort()) {
    const dir = join(ugc, folder);
    if (SKIP_FOLDERS.has(folder.toLowerCase()) || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter(n => /\.ugc$/i.test(n)).sort()) {
      const id = modelIdFromFile(f);
      files++;
      try {
        const s = analyseModel(join(dir, f));
        models[id] = { min: s.min, max: s.max, front: s.front, screens: s.screens, folder };
        if (s.front) withFront++;
        if (!s.min) noBounds++;
      } catch (e) {
        errors.push(`${folder}\\${f}: ${e.message}`);
      }
    }
  }
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  writeFileSync(INDEX_PATH, indexText(models));
  console.log(`models: ${Object.keys(models).length} of ${files} bundles | with a screen front: ${withFront} | no visible mesh: ${noBounds} | errors: ${errors.length} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const e of errors.slice(0, 20)) console.log('  error: ' + e);
  console.log('wrote ' + INDEX_PATH);
  return errors.length && !Object.keys(models).length ? 1 : 0;
}

const invokedDirectly = import.meta.main ?? (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url);
if (invokedDirectly) process.exitCode = main();
