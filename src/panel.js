import { degrees, radians } from './quat.js';
import { displayHeading, modelHeight } from './modelShape.js';
import { launchability, launchableGames, suggestGamesForModel, suggestModelsForGame, hasAttractVideo } from './linking.js';
import { hintFor } from './hints.js';
import { scaleToSlider, sliderToScale, uniformScale, pointerToAngle, snapAngle, angleDelta } from './controlsMath.js';

// Slider/dial CSS is injected at runtime (index.html is owned by the app wiring task).
const PANEL_CSS = `
#panel .pc-row{display:flex;align-items:center;gap:8px;margin:4px 0}
#panel .pc-track{position:relative;flex:1;min-width:0;margin:0}
#panel .pc-track input[type=range]{width:100%;margin:0;display:block}
#panel .pc-tick{position:absolute;top:-3px;width:2px;height:6px;margin:0;background:#d29922;transform:translateX(-50%);pointer-events:none}
#panel .pc-row input[type=number]{width:6em}
#panel canvas.dial{width:120px;height:120px;flex:none;cursor:grab;touch-action:none}
#panel canvas.dial.dragging{cursor:grabbing}
`;
function injectPanelCss() {
  if (typeof document === 'undefined' || document.getElementById('panel-controls')) return;
  const style = document.createElement('style'); style.id = 'panel-controls'; style.textContent = PANEL_CSS;
  document.head.append(style);
}
const copyScale = (s) => (s && typeof s === 'object' ? { ...s } : s);
const uniformOf = (s) => (typeof s === 'number' ? s : s && typeof s === 'object' && Number.isFinite(s.x) ? s.x : 1);
// The plan is a true top-down view: +X to the right and +Z UP the screen. A heading t (0 = +Z, clockwise towards +X)
// therefore points to the same screen angle pointerToAngle measures (0 = up, clockwise), so the dial matches the plan.
const DIAL = 120, SNAP_DEG = 15;
const headingToScreenAngle = (t) => angleDelta(0, t);
const screenAngleToHeading = (a) => angleDelta(0, a);

export function createPanel(el, deps) {
  injectPanelCss();
  const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs); kids.forEach(k => e.append(k)); return e; };
  const preview = () => { if (deps.preview) deps.preview(); };
  const fmt = (v) => String(Number(v.toPrecision(6)));
  // Cancel function of the slider/dial drag in progress (null when none): the plan ignores keys while it is set, and
  // a panel rebuild puts the object back to its pre-drag value instead of stranding a half-changed preview.
  let activeDrag = null;
  // Logarithmic scale bar: centre = hint median (else current scale), covering centre/100 .. centre*100.
  function scaleControl(o, room, hint) {
    const cur = uniformOf(o.scale);
    const centre = hint && hint.median > 0 ? hint.median : cur > 0 ? cur : 1;
    const range = h('input', { type: 'range', min: 0, max: 1000, step: 'any', value: scaleToSlider(cur, centre) });
    const track = h('div', { className: 'pc-track' }, range);
    if (hint && hint.median > 0) {
      const pct = scaleToSlider(hint.median, centre) / 10;
      const tick = h('div', { className: 'pc-tick', title: 'known size ' + hint.median });
      // the thumb centre travels 8px .. (100% - 8px): left = 8px + pct% * (100% - 16px)
      tick.style.left = `calc(${pct}% + ${8 - 0.16 * pct}px)`;
      track.append(tick);
    }
    const num = h('input', { type: 'number', step: 'any', value: fmt(cur) });
    let start = null; // scale at drag start (plain copy), null when not dragging
    const scaleFor = (base, target) => {
      const u = uniformOf(base);
      if (base === undefined || typeof base === 'number' || !(u > 0)) return typeof base === 'object' && base ? { x: target, y: target, z: target } : target;
      return uniformScale(base, target / u);
    };
    const commit = (before, after) => deps.onChange({ label: 'scale', do: () => room.setScale(o, copyScale(after)),
      undo: () => { if (before === undefined) delete o.scale; else room.setScale(o, copyScale(before)); } });
    const restoreScale = (v) => { if (v === undefined) delete o.scale; else o.scale = copyScale(v); };
    const cancel = () => { if (start !== null) { restoreScale(start.v); start = null; } };
    const begin = () => { if (start === null) start = { v: copyScale(o.scale) }; activeDrag = cancel; };
    // Commit on release, not only on 'change': a range fires no 'change' when the thumb is released at the value it
    // was pressed at (e.g. pinned at an end), although 'input' already changed o.scale.
    const commitDrag = () => {
      if (activeDrag === cancel) activeDrag = null;
      if (start === null) return;
      const before = start.v, after = copyScale(o.scale); start = null;
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      restoreScale(before);
      commit(before, after);
    };
    range.addEventListener('pointerdown', () => {
      begin();
      window.addEventListener('pointerup', commitDrag, { once: true });
      window.addEventListener('pointercancel', commitDrag, { once: true });
    });
    range.oninput = () => {
      begin();
      const target = sliderToScale(range.value, centre);
      o.scale = scaleFor(start.v, target); num.value = fmt(target); preview();
    };
    range.onchange = commitDrag; // keyboard
    range.addEventListener('blur', commitDrag);
    num.onchange = () => {
      const v = parseFloat(num.value); if (!Number.isFinite(v)) { num.value = fmt(uniformOf(o.scale)); return; } // never commit NaN
      const before = copyScale(o.scale); commit(before, scaleFor(before, v));
    };
    return h('div', { className: 'pc-row' }, h('span', {}, 'scale'), track, num);
  }
  // Direction dial: needle = heading as drawn on the plan; drag to turn (15 degree snap, Shift = free), one undo on release.
  function dialControl(o, room) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cv = h('canvas', { className: 'dial', width: DIAL * dpr, height: DIAL * dpr, title: 'drag to turn (Shift = free)' });
    const info = deps.modelInfo ? deps.modelInfo(o.id) : null;
    const heading = () => displayHeading(o, info); // the way the model's front (screen) faces, where the plan's white dot is
    const shownDeg = () => Math.round(degrees(heading()));
    const num = h('input', { type: 'number', step: 'any', value: shownDeg() });
    const draw = () => {
      const ctx = cv.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, DIAL, DIAL);
      const c = DIAL / 2, r = c - 14;
      ctx.strokeStyle = '#30363d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) { const a = headingToScreenAngle(radians(i * 30)), sx = Math.sin(a), sy = -Math.cos(a);
        ctx.beginPath(); ctx.moveTo(c + sx * (r - 5), c + sy * (r - 5)); ctx.lineTo(c + sx * r, c + sy * r); ctx.stroke(); }
      ctx.fillStyle = '#c9d1d9'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, d]) => { const a = headingToScreenAngle(radians(d));
        ctx.fillText(l, c + Math.sin(a) * (r + 8), c - Math.cos(a) * (r + 8)); });
      const a = headingToScreenAngle(heading());
      ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.sin(a) * (r - 8), c - Math.cos(a) * (r - 8)); ctx.stroke();
      ctx.fillStyle = '#58a6ff'; ctx.beginPath(); ctx.arc(c, c, 3, 0, Math.PI * 2); ctx.fill();
    };
    let drag = null; // { id, start: rotation copy or undefined }
    const turnTo = (e) => {
      const rc = cv.getBoundingClientRect();
      const target = snapAngle(screenAngleToHeading(pointerToAngle(rc.left + rc.width / 2, rc.top + rc.height / 2, e.clientX, e.clientY)), SNAP_DEG, !!e.shiftKey);
      const d = angleDelta(heading(), target);
      if (Math.abs(d) > 1e-12) room.rotateYaw(o, d); // composed onto the existing quaternion (keeps tilt)
      num.value = shownDeg();
      draw(); preview();
    };
    const restore = (rot) => { if (rot === undefined) delete o.rotation; else o.rotation = { ...rot }; };
    const cancel = () => { if (drag) { restore(drag.start); drag = null; cv.className = 'dial'; } };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      drag = { id: e.pointerId, start: o.rotation ? { ...o.rotation } : undefined }; activeDrag = cancel;
      if (cv.setPointerCapture) try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      cv.className = 'dial dragging'; turnTo(e);
    });
    cv.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) turnTo(e); });
    const end = (commit) => (e) => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      const before = drag.start, after = o.rotation ? { ...o.rotation } : undefined; drag = null; cv.className = 'dial';
      if (activeDrag === cancel) activeDrag = null;
      if (cv.releasePointerCapture) try { cv.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      restore(before);
      const same = JSON.stringify(before) === JSON.stringify(after);
      if (commit && !same) deps.onChange({ label: 'yaw', do: () => restore(after), undo: () => restore(before) });
      else { draw(); preview(); }
    };
    cv.addEventListener('pointerup', end(true));
    cv.addEventListener('pointercancel', end(false));
    num.onchange = () => { const v = parseFloat(num.value); if (!Number.isFinite(v)) { num.value = shownDeg(); return; }
      const b = o.rotation ? { ...o.rotation } : undefined; deps.onChange({ label: 'yaw', do: () => room.setYaw(o, radians(v), heading()), undo: () => restore(b) }); };
    draw();
    return h('div', { className: 'pc-row' }, cv, h('div', {}, h('label', {}, 'facing (deg) ', num),
      h('div', { className: 'hint' }, info && info.front ? 'needle = front (screen side)' : 'front unknown for this model')));
  }
  function fieldNum(label, val, onCommit) {
    const inp = h('input', { type: 'number', step: 'any', value: val });
    inp.onchange = () => { const v = parseFloat(inp.value); if (!Number.isFinite(v)) { inp.value = val; return; } onCommit(v); }; // never commit NaN (would serialise as null)
    return h('label', {}, label + ' ', inp);
  }
  function show(objs) {
    if (activeDrag) { const c = activeDrag; activeDrag = null; c(); } // never rebuild over a half-finished drag
    el.innerHTML = '';
    if (objs.length !== 1) { el.append(h('div', {}, objs.length ? `${objs.length} selected` : 'Nothing selected')); return; }
    const o = objs[0], room = deps.room(), cat = deps.catalog();
    const modelName = (id) => id.replace(/^ugc_/, '');
    // Game
    const gl = launchability(o.path || '', cat); const badge = o.path ? `${gl.status} - ${gl.reason}` : 'decor (no game)';
    const gameSel = h('select'); gameSel.append(h('option', { value: '' }, '(no game / decor)'));
    const showUnknown = h('input', { type: 'checkbox' });
    const fillGames = () => { gameSel.innerHTML = ''; gameSel.append(h('option', { value: '' }, '(no game / decor)'));
      const games = launchableGames(cat, { includeUnknown: showUnknown.checked }); if (o.path && !games.some(g => g.path === o.path)) games.unshift({ path: o.path, system: '(current)', file: o.path });
      for (const g of games) gameSel.append(h('option', { value: g.path, selected: g.path === o.path }, `${g.system}: ${g.file}${hasAttractVideo(g.path, cat) ? '' : '  (no attract video)'}`)); };
    fillGames(); showUnknown.onchange = fillGames;
    gameSel.onchange = () => {
      // setGame drops the EmuVR-owned crc/open of the old game and may allocate a screen slot; undo restores both
      const before = o.path, ident = { crc: o.crc, open: o.open }, hadScreen = typeof o.embedded_screen === 'number';
      deps.onChange({ label: 'game', do: () => room.setGame(o, gameSel.value || null),
        undo: () => { room.setGame(o, before); if (!hadScreen) room.releaseScreen(o); if (ident.crc !== undefined) o.crc = ident.crc; if (ident.open !== undefined) o.open = ident.open; } });
      show([o]); };
    // Model + hint
    const modelSel = h('select'); const q = h('input', { placeholder: 'search models...' });
    const fillModels = () => { modelSel.innerHTML = ''; const k = q.value.toLowerCase(); const ms = cat.models.filter(m => m.key.includes(k) || m.id === o.id).slice(0, 300);
      if (!ms.some(m => m.id === o.id)) ms.unshift({ id: o.id, name: modelName(o.id) }); for (const m of ms) modelSel.append(h('option', { value: m.id, selected: m.id === o.id }, m.name)); };
    fillModels(); q.oninput = fillModels;
    const hint = hintFor(o.id, deps.hints());
    // Real size from the model's extracted bounds: a cabinet built in centimetres at scale 1 stands 100 times too tall.
    const height = modelHeight(o, deps.modelInfo ? deps.modelInfo(o.id) : null);
    const fmtM = (m) => (m >= 10 ? String(Math.round(m)) : m.toFixed(2));
    const sizeTxt = height === null ? '' : (height > 4 || (/^ugc_Arcade_/i.test(o.id) && height < 0.5))
      ? `SIZE: at this scale it stands about ${fmtM(height)} m tall in VR${hint ? ` - this model is usually at scale ${hint.median}` : ''}`
      : `stands ${fmtM(height)} m tall in VR`;
    const hintTxt = hint ? `seen elsewhere at scale ${hint.median} (${hint.samples.map(s => 'Slot' + s.slot + '=' + s.scale).join(', ')})` : 'no size hint for this model';
    modelSel.onchange = () => { const before = o.id, sBefore = o.scale; const nh = hintFor(modelSel.value, deps.hints());
      deps.onChange({ label: 'model', do: () => { room.setModel(o, modelSel.value); if (nh) room.setScale(o, nh.median); }, undo: () => { room.setModel(o, before, { verified: true }); room.setScale(o, sBefore); } }); show([o]); };
    const sugG = o.id ? suggestGamesForModel(o.id, cat).slice(0, 3) : [], sugM = o.path ? suggestModelsForGame(o.path, cat).slice(0, 3) : [];
    const unverified = room.unverified.has(o);
    el.append(
      h('h3', {}, modelName(o.id)),
      h('div', { className: 'badge ' + (o.path ? gl.status : 'decor') }, badge),
      h('div', {}, 'Game: ', gameSel, h('label', {}, showUnknown, ' show unknown')),
      sugG.length ? h('div', { className: 'sug' }, 'Suggested games: ' + sugG.map(g => g.file).join(' | ')) : '',
      h('div', {}, 'Model: ', q, modelSel),
      sugM.length ? h('div', { className: 'sug' }, 'Suggested cabinets: ' + sugM.map(m => m.name).join(' | ')) : '',
      h('div', { className: unverified ? 'warn' : 'hint' }, (unverified ? 'UNVERIFIED SIZE - check in VR. ' : '') + hintTxt),
      sizeTxt ? h('div', { className: sizeTxt.startsWith('SIZE') ? 'warn' : 'hint' }, sizeTxt) : '',
      scaleControl(o, room, hint),
      fieldNum('x', o.position.x, v => { const p = { ...o.position }; deps.onChange({ label: 'x', do: () => room.setPosition(o, v, p.y, p.z), undo: () => room.setPosition(o, p.x, p.y, p.z) }); }),
      fieldNum('y (height)', o.position.y, v => { const p = { ...o.position }; deps.onChange({ label: 'y', do: () => room.setPosition(o, p.x, v, p.z), undo: () => room.setPosition(o, p.x, p.y, p.z) }); }),
      fieldNum('z', o.position.z, v => { const p = { ...o.position }; deps.onChange({ label: 'z', do: () => room.setPosition(o, p.x, p.y, v), undo: () => room.setPosition(o, p.x, p.y, p.z) }); }),
      dialControl(o, room),
      h('label', {}, h('input', { type: 'checkbox', checked: o.frozen, onchange: (e) => { const b = o.frozen; deps.onChange({ label: 'frozen', do: () => room.setFrozen(o, e.target.checked), undo: () => room.setFrozen(o, b) }); } }), ' frozen (unchecked = edit mode, games stop firing)'),
      h('div', {}, h('button', { onclick: () => deps.onDuplicate(o) }, 'Duplicate'), ' ', h('button', { onclick: () => deps.onDelete(o) }, 'Delete')),
    );
  }
  let libFill = null;
  function library() {
    const box = h('div', { className: 'lib' }); const q = h('input', { placeholder: 'add cabinet/prop: search library...' }); const list = h('select', { size: 8 });
    // catalogue may not be loaded yet when the library is first built (before a room is loaded)
    const models = () => { const c = deps.catalog(); return c ? c.models : []; };
    const fill = () => { list.innerHTML = ''; const k = q.value.toLowerCase(); for (const m of models().filter(m => m.key.includes(k)).slice(0, 200)) list.append(h('option', { value: m.id }, m.name)); };
    fill(); q.oninput = fill; libFill = fill;
    const btn = h('button', {}, 'Place selected model (then click on plan)'); btn.onclick = () => { if (list.value) deps.onAddModel(list.value); };
    box.append(q, list, btn); return box;
  }
  // re-populate the library list once the catalogue has been loaded
  const refreshLibrary = () => { if (libFill) libFill(); };
  return { show, library, refreshLibrary, get dragging() { return activeDrag !== null; } };
}
