import { planHeading } from './quat.js';
import { footprint } from './modelShape.js';
import { footprintSize, obbCorners, pointInObb, obbOverlap, planView } from './planGeom.js';
import { wallBounds, traceSegments, emptyTrace, addCorner, closeRun, removeLastCorner } from './walls.js';

const TRACE_HINT = 'TRACE: click corners, Shift = straight, Enter/double-click = finish run, Backspace = undo corner, Esc = exit';

export function createPlan(canvas, room, deps) {
  const ctx = canvas.getContext('2d');
  const st = { room, camX: 0, camZ: 0, zoom: 30, selection: new Set(), addMode: false, drag: null, hover: null,
    level: null, trace: emptyTrace(), traceMode: false, pointer: null };
  const view = () => planView({ camX: st.camX, camZ: st.camZ, zoom: st.zoom, width: canvas.width, height: canvas.height }); // +Z up, as seen from above
  const toScreen = (x, z) => view().toScreen(x, z);
  const toWorld = (sx, sz) => view().toWorld(sx, sz);
  // Footprint from the model's extracted bounds, aligned with the way its screen faces (white dot = front). Models with
  // no entry in models\index.json fall back to a guessed box on their rotation, with no front dot.
  const shape = (o) => {
    const fp = footprint(o, deps.modelInfo ? deps.modelInfo(o.id) : null);
    if (fp) return fp;
    const { w, d } = footprintSize(o.id, o.scale ?? 1);
    return { corners: obbCorners(o.position.x, o.position.z, planHeading(o.rotation), w, d), frontMid: null };
  };
  const geom = (o) => shape(o).corners;
  const colors = { live: '#3fb950', dead: '#f85149', unknown: '#8b949e', decor: '#6e7681' };
  const traceChanged = () => { if (deps.onTraceChange) deps.onTraceChange(st.trace); render(); };
  const lastCorner = () => st.trace.current.length ? st.trace.current[st.trace.current.length - 1] : null;

  function fitToRoom() {
    const ps = st.room.placed();
    const xs = ps.map(o => o.position.x), zs = ps.map(o => o.position.z);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (ps.length) { minX = Math.min(...xs) - 3; maxX = Math.max(...xs) + 3; minZ = Math.min(...zs) - 3; maxZ = Math.max(...zs) + 3; }
    const wb = wallBounds([st.level, traceSegments(st.trace), st.trace.current.map(([x, z]) => [x, z, x, z])]);
    if (wb) { minX = Math.min(minX, wb.minX - 1); maxX = Math.max(maxX, wb.maxX + 1); minZ = Math.min(minZ, wb.minZ - 1); maxZ = Math.max(maxZ, wb.maxZ + 1); }
    if (minX === Infinity) return;
    st.camX = (minX + maxX) / 2; st.camZ = (minZ + maxZ) / 2;
    st.zoom = Math.min(canvas.width / Math.max(maxX - minX, 1e-6), canvas.height / Math.max(maxZ - minZ, 1e-6));
  }
  function strokeSegments(segs) {
    ctx.beginPath();
    for (const [x1, z1, x2, z2] of segs) { const [a, b] = toScreen(x1, z1), [c, d] = toScreen(x2, z2); ctx.moveTo(a, b); ctx.lineTo(c, d); }
    ctx.stroke();
  }
  function drawWalls() {
    if (st.level && st.level.length) { ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = '#8b949e'; strokeSegments(st.level); }
    const runs = [...st.trace.runs, st.trace.current];
    const segs = traceSegments({ runs });
    ctx.lineWidth = 2; ctx.strokeStyle = '#58a6ff'; ctx.setLineDash([6, 4]);
    if (segs.length) strokeSegments(segs);
    const last = lastCorner();
    if (st.traceMode && last && st.pointer) { // rubber band from the last corner to the (snapped, optionally axis-locked) pointer
      const [px, pz] = toWorld(st.pointer.sx, st.pointer.sz);
      const p = addCorner({ runs: [], current: [last] }, px, pz, { axisLock: st.pointer.shift }).current[1];
      strokeSegments([[last[0], last[1], p[0], p[1]]]);
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#58a6ff';
    for (const run of runs) for (const [x, z] of run) { const [sx, sz] = toScreen(x, z); ctx.beginPath(); ctx.arc(sx, sz, 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
  function render() {
    const W = canvas.width, H = canvas.height; ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
    const [x0, z0] = toWorld(0, 0), [x1, z1] = toWorld(W, H);
    for (let gx = Math.floor(x0); gx <= x1; gx++) { const [sx] = toScreen(gx, 0); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke(); }
    for (let gz = Math.floor(Math.min(z0, z1)); gz <= Math.max(z0, z1); gz++) { const [, sz] = toScreen(0, gz); ctx.beginPath(); ctx.moveTo(0, sz); ctx.lineTo(W, sz); ctx.stroke(); }
    drawWalls();
    const placed = st.room.placed(); const boxes = placed.map(o => { const s = shape(o); return [o, s.corners, s.frontMid]; });
    for (const [o, k, frontMid] of boxes) {
      const overlap = boxes.some(([p, kk]) => p !== o && obbOverlap(k, kk));
      ctx.beginPath(); k.forEach(([x, z], i) => { const [sx, sz] = toScreen(x, z); i ? ctx.lineTo(sx, sz) : ctx.moveTo(sx, sz); }); ctx.closePath();
      ctx.fillStyle = colors[deps.badge(o)] + '55'; ctx.fill();
      ctx.lineWidth = st.selection.has(o) ? 3 : 1.5; ctx.strokeStyle = st.selection.has(o) ? '#58a6ff' : (overlap ? '#d29922' : colors[deps.badge(o)]); ctx.stroke();
      if (frontMid) { const [sfx, sfz] = toScreen(frontMid[0], frontMid[1]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sfx, sfz, 3.5, 0, Math.PI * 2); ctx.fill(); } // front = the side the screen faces
      else { const [scx, scz] = toScreen(o.position.x, o.position.z); ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(scx, scz, 3, 0, Math.PI * 2); ctx.stroke(); } // front unknown
      if (st.zoom > 18) { const [sx, sz] = toScreen(o.position.x, o.position.z); ctx.fillStyle = '#c9d1d9'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(deps.modelName(o.id).slice(0, 22), sx, sz + 4); }
    }
    ctx.fillStyle = '#8b949e'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(st.traceMode ? TRACE_HINT : st.addMode ? 'ADD MODE: click to place' : 'white dot = front (screen side) | drag empty = pan, wheel = zoom, drag object = move, R/Shift+R rotate 90, [ ] rotate 5', 10, H - 10);
  }
  function hit(sx, sz) { const [x, z] = toWorld(sx, sz); const ps = st.room.placed(); for (let i = ps.length - 1; i >= 0; i--) if (pointInObb(x, z, geom(ps[i]))) return ps[i]; return null; }
  function setTraceMode(on) {
    on = !!on; if (on === st.traceMode) return;
    st.traceMode = on; st.drag = null;
    if (!on && st.trace.current.length) { st.trace = closeRun(st.trace); if (deps.onTraceChange) deps.onTraceChange(st.trace); }
    render();
  }
  canvas.addEventListener('mousedown', (e) => {
    const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sz = e.clientY - r.top;
    if (st.traceMode) {
      if (e.button !== undefined && e.button !== 0) { st.drag = { kind: 'pan', sx, sz }; return; } // non-left buttons still pan
      if (e.detail >= 2) return; // 2nd press of a double-click: the dblclick that follows closes the run
      const [x, z] = toWorld(sx, sz);
      const next = addCorner(st.trace, x, z, { axisLock: e.shiftKey });
      const prev = lastCorner(), added = next.current[next.current.length - 1];
      if (prev && prev[0] === added[0] && prev[1] === added[1]) return; // same snapped point (e.g. 2nd click of a double-click)
      st.trace = next; st.pointer = { sx, sz, shift: e.shiftKey }; traceChanged(); return;
    }
    if (st.addMode) { const [x, z] = toWorld(sx, sz); deps.onPlaceClick(x, z); return; }
    const o = hit(sx, sz);
    if (o) { if (!e.shiftKey && !st.selection.has(o)) st.selection.clear(); st.selection.add(o); deps.onSelect([...st.selection]); st.drag = { kind: 'move', sx, sz, moved: false }; }
    else { if (!e.shiftKey) { st.selection.clear(); deps.onSelect([]); } st.drag = { kind: 'pan', sx, sz }; }
    render();
  });
  canvas.addEventListener('dblclick', (e) => { if (!st.traceMode) return; if (e.preventDefault) e.preventDefault(); st.trace = closeRun(st.trace); traceChanged(); });
  canvas.addEventListener('contextmenu', (e) => { if (st.traceMode && e.preventDefault) e.preventDefault(); });
  canvas.addEventListener('mouseleave', () => { if (st.traceMode && st.pointer) { st.pointer = null; render(); } });
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sz = e.clientY - r.top;
    if (st.traceMode) { st.pointer = { sx, sz, shift: e.shiftKey }; if (!st.drag) return render(); }
    if (!st.drag) return;
    const dx = (sx - st.drag.sx) / st.zoom, dz = -(sz - st.drag.sz) / st.zoom; // world deltas: screen down = -Z
    if (st.drag.kind === 'pan') { st.camX -= dx; st.camZ -= dz; }
    else { const snap = e.altKey ? 1e-9 : 0.1; const qx = Math.round(dx / snap) * snap, qz = Math.round(dz / snap) * snap; if (qx || qz) { deps.onMove([...st.selection], qx, qz); st.drag.moved = true; st.drag.sx += qx * st.zoom; st.drag.sz -= qz * st.zoom; return render(); } return; }
    st.drag.sx = sx; st.drag.sz = sz; render();
  });
  window.addEventListener('mouseup', () => { st.drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom = Math.max(4, Math.min(200, st.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); render(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (deps.busy && deps.busy()) return; // a panel slider/dial drag is in progress: its object must not change underneath it
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (st.traceMode) {
      if (e.key === 'Enter') { e.preventDefault(); st.trace = closeRun(st.trace); traceChanged(); }
      else if (e.key === 'Backspace') { e.preventDefault(); if (st.trace.current.length) { st.trace = removeLastCorner(st.trace); traceChanged(); } }
      else if (e.key === 'Escape') { e.preventDefault(); setTraceMode(false); }
      else if (e.key === 'Shift' && st.pointer) { st.pointer.shift = true; render(); }
      return;
    }
    const sel = [...st.selection]; if (!sel.length) return;
    if (e.key === 'r' || e.key === 'R') deps.onRotate(sel, (e.shiftKey ? -1 : 1) * Math.PI / 2);
    else if (e.key === '[') deps.onRotate(sel, -Math.PI / 36); else if (e.key === ']') deps.onRotate(sel, Math.PI / 36);
    else return; render();
  });
  window.addEventListener('keyup', (e) => { if (st.traceMode && e.key === 'Shift' && st.pointer) { st.pointer.shift = false; render(); } });
  return {
    render, fitToRoom,
    get selection() { return st.selection; },
    setRoom(r) { st.room = r; st.selection.clear(); },
    setAddMode(b) { st.addMode = b; render(); },
    setWalls({ level = null, traced = null } = {}) { st.level = level && level.length ? level : null; st.trace = traced ? { runs: traced.runs || [], current: traced.current || [] } : emptyTrace(); render(); },
    setTraceMode,
    get traceMode() { return st.traceMode; },
  };
}
