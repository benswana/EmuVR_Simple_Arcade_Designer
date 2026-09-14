import { createFs } from './fs.js';
import { Room } from './roomModel.js';
import { buildCatalog } from './catalog.js';
import { launchability } from './linking.js';
import { buildHints, hintFor } from './hints.js';
import { createPlan } from './plan.js';
import { createPanel } from './panel.js';
import { CommandStack } from './undo.js';
import { levelCandidates, levelDisplayName, levelWallsFit, transformOutline, emptyTrace, serializeTrace, parseTrace } from './walls.js';

export default async function startApp(doc) {
  const fs = createFs(); const $ = (id) => doc.getElementById(id);
  let room = null, slot = null, originalText = '', catalog = null, hints = new Map(), plan = null, pendingModel = null;
  // Model shapes (visible bounds + the way the screen faces) from RoomEditor\models\index.json (tools/extract_models.mjs).
  let models = null;
  const modelInfo = (id) => (models && id && models[id]) || null;
  // Walls: `level` = room-space outline from the level cache (or null), `trace` = the user's traced walls for this slot.
  // Traced walls live in RoomEditor\walls\traced\Slot<N>.json and are never written into the room file.
  // `levelNote` = why a cached level outline was not drawn; `traceError` = the traced file exists but could not be read.
  let level = null, levelName = null, levelNote = null, trace = emptyTrace(), wallsDirty = false, traceError = null;
  const tracedRel = (s) => `RoomEditor\\walls\\traced\\Slot${s}.json`;
  const hasTrace = (t) => !!t && ((t.runs && t.runs.length) || (t.current && t.current.length));
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1-$2');
  const wallsStatus = () => {
    const parts = [];
    if (level) parts.push(`${levelName} (level)`);
    if (hasTrace(trace) || wallsDirty) parts.push(wallsDirty ? 'traced (unsaved)' : 'traced');
    if (traceError) parts.push('traced walls file unreadable');
    return 'walls: ' + (parts.length ? parts.join(' + ') : `${levelNote || 'none'} — use Trace walls`);
  };
  const syncTraceButton = () => { $('trace').textContent = plan && plan.traceMode ? 'Done tracing' : 'Trace walls'; };
  const stack = new CommandStack();
  const status = (m) => { $('status').textContent = m; };
  const memo = new Map(); const exists = async (rel) => { if (!memo.has(rel)) memo.set(rel, await fs.exists(rel)); return memo.get(rel); };

  // Game files are pre-listed, so launchability's fileExists never has to touch the disk.
  const gameFileExists = (gameFiles) => { const s = new Set(); for (const [sys, files] of Object.entries(gameFiles || {})) for (const f of files) s.add(`Games\\${sys}\\${f}`.toLowerCase()); return (rel) => s.has(rel.toLowerCase()); };
  // Fallback (no File System Access API): tools/gen_manifest.ps1 writes manifest.js = window.RAVE_MANIFEST with the buildCatalog listings shape.
  function loadManifestCatalog(m) {
    const tpSeen = new Map(Object.entries(m.tpGamePathExists || {}));
    catalog = buildCatalog({ ugcNames: m.ugcNames, gameFiles: m.gameFiles, winTexts: m.winTexts, tpProfiles: m.tpProfiles, m2Roms: m.m2Roms, m3Roms: m.m3Roms, videoNames: m.videoNames, daphneFrames: m.daphneFrames,
      fileExists: gameFileExists(m.gameFiles), tpGamePathExists: (abs) => tpSeen.has(abs) ? tpSeen.get(abs) : null }); // null = not probed -> unknown
    status(`library (manifest.js): ${catalog.models.length} models, ${catalog.games.length} games`);
  }
  // Recursive file listing (relative paths under `rel`, excluding the `rel` prefix); [] if the folder is missing.
  async function listTree(rel) {
    const out = []; const walk = async (dir, prefix) => { const l = await fs.listDir(dir); for (const f of l.files) out.push(prefix + f); for (const d of l.dirs) await walk(dir + '\\' + d, prefix + d + '\\'); };
    try { await walk(rel, ''); } catch {} return out;
  }
  async function loadCatalog() {
    if (fs.mode !== 'fsa') {
      if (typeof window !== 'undefined' && window.RAVE_MANIFEST) { loadManifestCatalog(window.RAVE_MANIFEST); return; }
      catalog = buildCatalog({}); status('no manifest.js - badges unavailable (run tools\\gen_manifest.ps1)'); return;
    }
    status('reading library...');
    const ugc = (await fs.listDir('Custom\\UGC\\Arcade')).files.filter(f => /\.ugc$/i.test(f)).map(f => f.replace(/\.ugc$/i, ''));
    // probe: game folders hold symlinks, and a dangling one must not count as a present game
    const gameFiles = {}; for (const d of (await fs.listDir('Games')).dirs) gameFiles[d] = (await fs.listDir('Games\\' + d, { probe: true })).files;
    const winTexts = {}; for (const d of Object.keys(gameFiles).filter(d => /^Arcade \(Capture\)/i.test(d)))
      for (const f of gameFiles[d].filter(f => /\.win$/i.test(f))) winTexts[`Games\\${d}\\${f}`] = await fs.readText(`Games\\${d}\\${f}`);
    const tpProfiles = {}; try { for (const f of (await fs.listDir('Emulators\\TeknoParrot\\UserProfiles')).files.filter(f => /\.xml$/i.test(f))) tpProfiles[f.replace(/\.xml$/i, '')] = await fs.readText('Emulators\\TeknoParrot\\UserProfiles\\' + f); } catch {}
    const safeList = async (rel) => { try { return (await fs.listDir(rel)).files; } catch { return []; } };
    catalog = buildCatalog({ ugcNames: ugc, gameFiles, winTexts, tpProfiles,
      m2Roms: await safeList('Emulators\\M2emulator\\roms\\RetroBat'), m3Roms: await safeList('Emulators\\SuperModel 3\\roms\\RetroBat'),
      videoNames: (await safeList('Custom\\Videos\\Arcade')).map(f => f.replace(/\.[^.]+$/, '')),
      daphneFrames: (await listTree('Emulators\\Daphne\\vldp')).map(p => 'vldp\\' + p),
      fileExists: gameFileExists(gameFiles),
    });
    // A TeknoParrot GamePath is absolute; only the part under the picked root can be probed from the browser.
    // Anything else stays null (-> unknown badge), never a guess.
    const tpSeen = new Map(); const rootTag = `\\${fs.rootName}\\`.toUpperCase();
    for (const gp of [...catalog.tpProfiles.values()].map(p => p.gamePath).filter(Boolean)) {
      const i = gp.toUpperCase().indexOf(rootTag);
      tpSeen.set(gp, i < 0 ? null : await exists(gp.slice(i + rootTag.length)));
    }
    catalog.tpGamePathExists = (abs) => tpSeen.has(abs) ? tpSeen.get(abs) : null;
    status(`library: ${catalog.models.length} models, ${catalog.games.length} games`);
  }
  // Read every Saved Data\Rooms\Slot<N>.json (re-read on each room load so hints reflect the files on disk).
  async function readRooms() {
    const rooms = []; for (const f of (await fs.listDir('Saved Data\\Rooms')).files.filter(f => /^Slot\d+\.json$/i.test(f))) rooms.push({ slot: f.match(/\d+/)[0], text: await fs.readText('Saved Data\\Rooms\\' + f) });
    return rooms;
  }
  const badge = (o) => o.path ? launchability(o.path, catalog).status : 'decor';
  function change(cmd) { stack.execute(cmd); plan.render(); panel.show([...plan.selection]); $('undo').disabled = !stack.canUndo; $('redo').disabled = !stack.canRedo; }
  const panel = createPanel($('panel'), { room: () => room, catalog: () => catalog, hints: () => hints, onChange: change, modelInfo,
    preview: () => plan && plan.render(), // live slider/dial preview: re-render only, no undo entry
    onDelete: (o) => {
      // remove() renumbers screens across objects+systems, so undo restores every array (same object references) and every embedded_screen
      const snap = room.snapshot(), wasUnverified = room.unverified.has(o);
      plan.selection.clear();
      change({ label: 'delete', do: () => room.remove(o), undo: () => { room.restore(snap); if (wasUnverified) room.unverified.add(o); } });
    },
    onDuplicate: (o) => { let made; change({ label: 'duplicate', do: () => { made = room.add({ id: o.id, path: o.path, x: o.position.x + 1, z: o.position.z, y: o.position.y, yaw: 0, scale: o.scale ?? 1, screen: typeof o.embedded_screen === 'number', home: room.homeOf(o) }, { verified: !room.unverified.has(o) }); if (o.rotation) made.rotation = { ...o.rotation }; }, undo: () => room.remove(made) }); },
    onAddModel: (id) => { if (!plan) { status('load a room first'); return; } pendingModel = id; plan.setAddMode(true); status('click on the plan to place ' + id); } });
  async function loadRoom(n) {
    const text = await fs.readText(`Saved Data\\Rooms\\Slot${n}.json`);
    await openRoom(text, String(n));
  }
  // Room chosen with the file input. With folder access an in-place save is only allowed when the file IS a
  // Slot<N>.json (a backup such as Slot6.json.bak must never overwrite the live Slot6.json); otherwise slot = null
  // and Save falls back to a download. Without folder access the digits only name the download.
  async function loadRoomFromFile(file) {
    const text = await fs.loadRoomViaInput(file);
    const exact = /^Slot(\d+)\.json$/i.exec(file.name), loose = /(\d+)/.exec(file.name);
    const slotStr = fs.mode === 'fsa' ? (exact ? exact[1] : null) : (exact ? exact[1] : (loose ? loose[1] : '0'));
    await openRoom(text, slotStr);
    if (fs.mode === 'fsa' && !slotStr) status(`${file.name} is not a Slot<N>.json - Save will download instead of writing in place`);
  }
  // Walls for a room, read into locals only. A missing or unreadable file is not an error (no folder access, no cache,
  // nothing traced yet); the level cache holds level-local segments that are placed by the room's level object.
  async function readWalls(parsed, slotStr) {
    const out = { level: null, levelName: null, levelNote: null, trace: emptyTrace(), traceError: null };
    if (fs.mode !== 'fsa' || !fs.rootName) return out; // no folder access: no caches, nothing traced
    // A level object is recognised by having a level cache (the extractor caches level bundles only, never props);
    // candidates are checked in room order and the first whose outline and placement fit is drawn.
    let cached = [];
    try { cached = (await fs.listDir('RoomEditor\\walls\\levels')).files.filter(f => /\.json$/i.test(f)).map(f => f.replace(/\.json$/i, '')); } catch { /* no cache folder */ }
    if (cached.length) {
      for (const lo of levelCandidates(parsed, new Set(cached))) {
        let json;
        try { json = JSON.parse((await fs.readText(`RoomEditor\\walls\\levels\\${lo.id}.json`)).replace(/^\s+/, '')); }
        catch { out.levelNote = 'level outline cache unreadable'; continue; }
        const fit = levelWallsFit(json, lo);
        if (!fit.ok) { out.levelNote = fit.reason; continue; }
        out.level = transformOutline(json.segments, lo); out.levelName = levelDisplayName(lo.id); out.levelNote = null;
        break;
      }
    }
    if (slotStr !== null && slotStr !== undefined) {
      try { out.trace = parseTrace(await fs.readText(tracedRel(slotStr))); }
      catch (e) { if (!e || e.name !== 'NotFoundError') out.traceError = (e && e.message) || String(e); } // missing = nothing traced yet
    }
    return out;
  }
  // Save/Clear would overwrite a traced file that exists but could not be read: keep it as .bak-<time> first.
  async function backupUnreadableTrace() {
    if (!traceError || slot === null) return;
    let old = null; try { old = await fs.readText(tracedRel(slot)); } catch { /* gone since */ }
    if (old !== null) await fs.writeText(`${tracedRel(slot)}.bak-${stamp()}`, old);
  }
  // Model shapes for footprints and front dots; {} (guessed boxes, no dots) without folder access or before extraction.
  async function readModels() {
    if (fs.mode !== 'fsa' || !fs.rootName) return {};
    try {
      const j = JSON.parse((await fs.readText('RoomEditor\\models\\index.json')).replace(/^\s+/, ''));
      return j && j.models && typeof j.models === 'object' ? j.models : {};
    } catch { return {}; }
  }
  // Everything is parsed and prepared into locals first; module state is only replaced once nothing can throw,
  // so a corrupt file never leaves `slot` pointing at a file the old in-memory room could then be saved over.
  async function openRoom(text, slotStr) {
    if (wallsDirty && hasTrace(trace) && !confirm('Traced walls for the current room are not saved. Discard them and load another room?')) { status('load cancelled - click Save walls first'); return; }
    const parsed = Room.parse(text); parsed.slot = slotStr;
    if (!catalog) { await loadCatalog(); panel.refreshLibrary(); }
    let others = []; try { others = await readRooms(); } catch { others = []; } // no folder access: no cross-room hints
    const newHints = buildHints(others, { excludeSlot: slotStr });
    const walls = await readWalls(parsed, slotStr);
    if (models === null || !Object.keys(models).length) models = await readModels();
    if (!plan) {
      plan = createPlan($('plan'), parsed, { badge, modelName: (id) => id.replace(/^ugc_/, ''), onSelect: (objs) => panel.show(objs), busy: () => panel.dragging, modelInfo,
        onTraceChange: (t) => { trace = t; wallsDirty = true; syncTraceButton(); status(`Slot ${slot ?? '?'}: ${wallsStatus()}`); },
        onMove: (objs, dx, dz) => { const before = objs.map(o => ({ ...o.position })); change({ label: 'move', do: () => objs.forEach(o => room.setPosition(o, o.position.x + dx, o.position.y, o.position.z + dz)), undo: () => objs.forEach((o, i) => room.setPosition(o, before[i].x, before[i].y, before[i].z)) }); },
        onRotate: (objs, d) => { const before = objs.map(o => o.rotation && { ...o.rotation }); change({ label: 'rotate', do: () => objs.forEach(o => room.rotateYaw(o, d)), undo: () => objs.forEach((o, i) => { o.rotation = before[i]; }) }); },
        onPlaceClick: (x, z) => { const id = pendingModel; if (!id) { plan.setAddMode(false); return; } const hint = hintFor(id, hints); let made; change({ label: 'add', do: () => { made = room.add({ id, x, z, scale: hint ? hint.median : 1 }); }, undo: () => room.remove(made) }); pendingModel = null; plan.setAddMode(false); plan.selection.clear(); plan.selection.add(made); plan.render(); panel.show([made]); } });
      window.addEventListener('resize', () => plan && plan.render());
      // the plan leaves trace mode by itself on Esc; registered after createPlan's keydown listener, so this runs after it
      window.addEventListener('keydown', () => {
        const was = $('trace').textContent; syncTraceButton();
        if (was !== $('trace').textContent && plan && !plan.traceMode) status(`Slot ${slot ?? '?'}: ${wallsStatus()}`); // left trace mode with Esc
      });
    }
    room = parsed; slot = slotStr; originalText = text; hints = newHints;
    stack.done = []; stack.undone = []; $('undo').disabled = true; $('redo').disabled = true;
    level = walls.level; levelName = walls.levelName; levelNote = walls.levelNote; trace = walls.trace; traceError = walls.traceError;
    plan.setRoom(room);
    plan.setWalls({ level, traced: trace }); // resets the plan's trace, so leaving trace mode below has nothing to close
    plan.setTraceMode(false); wallsDirty = false; syncTraceButton();
    plan.fitToRoom(); plan.render(); panel.show([]); status(`Slot ${slot ?? '?'}: ${room.placed().length} objects | ${wallsStatus()}`);
  }
  async function saveWalls() {
    if (!plan || !room) { status('load a room first'); return; }
    const text = serializeTrace(slot, trace);
    if (fs.mode !== 'fsa' || slot === null) { fs.download(`Slot${slot ?? 0}.walls.json`, text); status('walls downloaded - put it in RoomEditor\\walls\\traced as Slot<N>.json'); return; }
    await backupUnreadableTrace();
    await fs.writeText(tracedRel(slot), text); // separate sidecar file; the room file is never touched
    wallsDirty = false; traceError = null; status(`saved traced walls for Slot ${slot} | ${wallsStatus()}`);
  }
  async function clearWalls() {
    if (!plan || !room) { status('load a room first'); return; }
    if (!confirm(`Clear the traced walls for Slot ${slot ?? '?'}? Level walls (if any) stay.`)) return;
    const text = serializeTrace(slot, emptyTrace()); // { slot, runs: [] }
    const cleared = () => { trace = emptyTrace(); plan.setWalls({ level, traced: trace }); wallsDirty = false; }; // only once the file is written
    if (fs.mode !== 'fsa' || slot === null) { fs.download(`Slot${slot ?? 0}.walls.json`, text); cleared(); status('traced walls cleared (empty walls file downloaded)'); return; }
    await backupUnreadableTrace();
    await fs.writeText(tracedRel(slot), text);
    cleared(); traceError = null; status(`cleared traced walls for Slot ${slot} | ${wallsStatus()}`);
  }
  async function save() {
    if (!room) { status('nothing loaded'); return; }
    const v = room.validate({ launchability: (p) => launchability(p, catalog).status, unverified: room.unverified });
    if (v.errors.length) { alert('NOT SAVED - structural errors:\n' + v.errors.join('\n')); return; }
    if (v.warnings.length && !confirm('Warnings:\n' + v.warnings.slice(0, 20).join('\n') + '\n\nSave anyway?')) return;
    const text = room.serialize(); if (text.charCodeAt(0) !== 0x7b) { alert('refusing to save: bad first byte'); return; }
    const target = room.slot; // the slot this room was loaded from, not a module variable that could have drifted
    if (fs.mode !== 'fsa' || target === null) { fs.download(`Slot${target ?? slot ?? 0}.json`, text); status('downloaded - drop it into Saved Data\\Rooms'); return; }
    const ts = stamp();
    const rel = `Saved Data\\Rooms\\Slot${target}.json`;
    // The backup must hold what is being replaced: the file as it is on disk NOW (EmuVR may have re-saved it since load).
    let onDisk = null; try { onDisk = await fs.readText(rel); } catch {}
    if (onDisk !== null && onDisk !== originalText && !confirm(`Slot ${target} changed on disk since you loaded it (saved from VR?). Overwrite it anyway? The current file will be kept as .bak-${ts}.`)) { status('save cancelled - reload the room to pick up the on-disk changes'); return; }
    await fs.writeText(`${rel}.bak-${ts}`, onDisk ?? originalText);
    await fs.writeText(rel, text); originalText = text; status(`saved Slot ${target} (backup .bak-${ts})`);
  }
  $('pick').onclick = async () => { await fs.pickRoot(); catalog = null; models = null; memo.clear(); status('root: ' + fs.rootName); };
  $('load').onclick = () => loadRoom($('slot').value).catch(e => status('load failed: ' + e.message));
  $('file').onchange = (e) => { const f = e.target.files[0]; if (f) loadRoomFromFile(f).catch(err => status('load failed: ' + err.message)); e.target.value = ''; };
  $('save').onclick = () => save().catch(e => status('save failed: ' + e.message));
  const afterHistory = () => { for (const o of [...plan.selection]) if (!room.homeOf(o)) plan.selection.delete(o); plan.render(); panel.show([...plan.selection]); $('undo').disabled = !stack.canUndo; $('redo').disabled = !stack.canRedo; };
  $('undo').onclick = () => { if (!plan) return; stack.undo(); afterHistory(); };
  $('redo').onclick = () => { if (!plan) return; stack.redo(); afterHistory(); };
  $('align').onclick = () => { if (!plan) return; const sel = [...plan.selection]; if (sel.length < 2) return; const z = sel[0].position.z; const before = sel.map(o => ({ ...o.position })); change({ label: 'align', do: () => sel.forEach(o => room.setPosition(o, o.position.x, o.position.y, z)), undo: () => sel.forEach((o, i) => room.setPosition(o, before[i].x, before[i].y, before[i].z)) }); };
  $('trace').onclick = () => {
    if (!plan) { status('load a room first'); return; }
    const on = !plan.traceMode;
    if (on && pendingModel) { pendingModel = null; plan.setAddMode(false); }
    plan.setTraceMode(on); syncTraceButton();
    status(on ? 'tracing walls - click corners on the plan' : `Slot ${slot ?? '?'}: ${wallsStatus()}`);
  };
  $('savewalls').onclick = () => saveWalls().catch(e => status('save walls failed: ' + e.message));
  $('clearwalls').onclick = () => clearWalls().catch(e => status('clear walls failed: ' + e.message));
  $('library').append(panel.library());
  status(fs.mode === 'fsa'
    ? 'Start here: click "Pick EmuVR folder", choose your EmuVR folder (the one with Saved Data and Custom), then Load a slot'
    : 'fallback mode: folder access unavailable - load via file, save = download');
}
