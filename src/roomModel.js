import { quatFromYaw, qmul, planHeading } from './quat.js';
import { angleDelta } from './controlsMath.js';

// Real rooms keep three object arrays: `objects` = screen scaffold block + decor props, `systems` = cabinets/consoles
// (everything with a game `path` and/or an `embedded_screen`), `games` = loose cartridges (path + position, no id).
export const ARRAYS = ['objects', 'systems', 'games'];
export const isScaffold = (o) => o && typeof o.embedded_screen === 'number' && o.id === undefined && o.position === undefined;
export const isPlaced = (o) => o && o.position !== undefined;
export const isArcadeModel = (id) => /^ugc_Arcade_/i.test(id || '');
const finite = (obj, keys) => !!obj && typeof obj === 'object' && keys.every(k => Number.isFinite(obj[k]));
// EmuVR writes scale either as one number or as a {x,y,z} vector (non-uniform scale); both are valid.
const scaleOk = (s) => Number.isFinite(s) || finite(s, ['x', 'y', 'z']);

export class Room {
  constructor(raw) {
    this.raw = raw; this.objects = raw.objects;
    this.systems = Array.isArray(raw.systems) ? raw.systems : (raw.systems = []);
    this.games = Array.isArray(raw.games) ? raw.games : []; // never written to; not attached so absent keys stay absent
    this.unverified = new Set(); this.slot = null;
  }
  static parse(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.objects)) throw new Error('room has no objects array');
    return new Room(raw);
  }
  scaffold() { return this.objects.filter(isScaffold); }
  all() { return [...this.objects, ...this.systems, ...this.games]; }
  placed() { return [...this.objects, ...this.systems].filter(isPlaced); } // cartridges in `games` have no id: not editable on the plan
  homeOf(o) { for (const k of ARRAYS) if (this[k].includes(o)) return k; return null; }
  maxScreen() { return this.scaffold().reduce((m, o) => Math.max(m, o.embedded_screen), -1); }
  serialize() { return JSON.stringify(this.raw, null, 2); }
  setPosition(o, x, y, z) { o.position = { x, y, z }; }
  // Rotation is composed (world-Y turn applied on top of the existing quaternion) so models authored Z-up keep their X/Z tilt.
  rotateYaw(o, d) { o.rotation = o.rotation ? qmul(quatFromYaw(d), o.rotation) : quatFromYaw(d); }
  // Turn so the shown heading becomes `yaw`, composed like rotateYaw. `current` = the heading shown now (the way the
  // model's front faces, from models\index.json); without it, the rotation's own heading.
  setYaw(o, yaw, current) {
    const cur = Number.isFinite(current) ? current : o.rotation ? planHeading(o.rotation) : 0;
    this.rotateYaw(o, angleDelta(cur, yaw));
  }
  setScale(o, s) { o.scale = s; }
  setGame(o, path) {
    const next = path || null;
    if ((o.path || null) !== next) { delete o.crc; delete o.open; } // EmuVR-owned identity of the previous game
    if (next) { o.path = next; if (isArcadeModel(o.id) && typeof o.embedded_screen !== 'number') this.allocateScreen(o); }
    else delete o.path;
  }
  setModel(o, id, opts = {}) { o.id = id; if (opts.verified) this.unverified.delete(o); else this.unverified.add(o); }
  setFrozen(o, f) { o.frozen = !!f; }
  // New scaffold entry MAX+1 goes right after the last scaffold entry; the object gets the same index.
  allocateScreen(o) {
    const n = this.maxScreen() + 1;
    this.objects.splice(this.scaffold().length, 0, { embedded_screen: n });
    o.embedded_screen = n; return n;
  }
  // Take the object's screen away again (undo of an allocation): drop the index and its scaffold entry.
  releaseScreen(o) {
    if (typeof o.embedded_screen !== 'number') return;
    const n = o.embedded_screen; delete o.embedded_screen; this._dropScreen(n);
  }
  // Remove screen n's scaffold entry and close the gap so indices stay contiguous 0..MAX-1 (objects AND systems).
  _dropScreen(n) {
    const si = this.objects.findIndex(s => isScaffold(s) && s.embedded_screen === n);
    if (si >= 0) this.objects.splice(si, 1);
    for (const x of this.all()) if (typeof x.embedded_screen === 'number' && x.embedded_screen > n) x.embedded_screen -= 1;
  }
  // screen: allocate an embedded_screen (default: arcade cabinets always, per the library). home: target array
  // (default: systems for anything with a screen or a game, objects for plain decor).
  add({ id, path, x, z, y = 0, yaw = 0, scale = 1, screen, home }, opts = {}) {
    const o = { id, position: { x, y, z }, rotation: quatFromYaw(yaw), scale, frozen: true };
    if (path) o.path = path;
    if (screen ?? isArcadeModel(id)) this.allocateScreen(o);
    const dest = home || ((path || typeof o.embedded_screen === 'number') ? 'systems' : 'objects');
    this[dest].push(o);
    if (!opts.verified) this.unverified.add(o);
    return o;
  }
  remove(o) {
    const home = this.homeOf(o); if (!home) return;
    this[home].splice(this[home].indexOf(o), 1);
    this.unverified.delete(o);
    if (typeof o.embedded_screen === 'number') this._dropScreen(o.embedded_screen); // the removed object keeps its index (undo restores it as-is)
  }
  // Undo support for remove(): the arrays (same object references) and every embedded_screen.
  snapshot() { return { arrays: Object.fromEntries(ARRAYS.map(k => [k, this[k].slice()])), screens: new Map(this.all().map(x => [x, x.embedded_screen])) }; }
  restore(s) {
    for (const k of ARRAYS) this[k].splice(0, this[k].length, ...s.arrays[k]);
    for (const [x, n] of s.screens) if (typeof n === 'number') x.embedded_screen = n; else delete x.embedded_screen;
  }
  validate(opts = {}) {
    const errors = [], warnings = [];
    const sc = this.scaffold();
    for (let i = 0; i < sc.length; i++) {
      if (this.objects[i] !== sc[i] || sc[i].embedded_screen !== i)
        { errors.push(`scaffold block must be objects[0..${sc.length - 1}] in order (problem at index ${i})`); break; }
    }
    const counts = new Map();
    for (const o of this.all()) if (typeof o.embedded_screen === 'number')
      counts.set(o.embedded_screen, (counts.get(o.embedded_screen) || 0) + 1);
    const max = this.maxScreen();
    for (let i = 0; i <= max; i++) {
      const c = counts.get(i) || 0;
      if (c !== 2) errors.push(`screen ${i} appears ${c === 1 ? 'once' : c + ' times'} (must be exactly twice)`);
    }
    for (const [k] of counts) if (k > max) errors.push(`screen ${k} has no scaffold entry`);
    let noFrozen = 0;
    for (const o of this.placed()) {
      if (!o.id) errors.push('placed object missing id');
      if (!o.rotation) errors.push(`object ${o.id} missing rotation`);
      else if (!finite(o.rotation, ['x', 'y', 'z', 'w'])) errors.push(`object ${o.id} rotation is not numeric`);
      if (!finite(o.position, ['x', 'y', 'z'])) errors.push(`object ${o.id} position is not numeric`);
      if (o.scale !== undefined && !scaleOk(o.scale)) errors.push(`object ${o.id} scale is not numeric`);
      if (typeof o.frozen !== 'boolean') noFrozen++; // EmuVR writes and loads such objects fine; left untouched
      if (o.path && isArcadeModel(o.id) && typeof o.embedded_screen !== 'number') errors.push(`cabinet ${o.id} has a game but no embedded_screen`);
    }
    if (noFrozen) warnings.push(`${noFrozen} object(s) have no frozen flag (left as-is)`);
    const seen = new Map();
    for (const o of this.placed()) if (o.path) {
      const k = o.path.toLowerCase();
      if (seen.has(k)) warnings.push(`duplicate game: ${o.path}`); else seen.set(k, o);
      if (opts.launchability && opts.launchability(o.path) === 'dead') warnings.push(`dead game: ${o.path}`);
    }
    if (opts.unverified) for (const o of opts.unverified) warnings.push(`unverified size: ${o.id}`);
    return { errors, warnings };
  }
}
