export function buildHints(rooms, { excludeSlot } = {}) {
  const map = new Map();
  for (const r of rooms) {
    if (r.slot === excludeSlot) continue;
    let raw; try { raw = JSON.parse(r.text.charCodeAt(0) === 0xfeff ? r.text.slice(1) : r.text); } catch { continue; }
    // cabinets live in `systems`, decor in `objects`, cartridges in `games`
    for (const o of [...(raw.objects || []), ...(raw.systems || []), ...(raw.games || [])]) {
      if (!o.id || !o.position) continue;
      // a {x,y,z} vector scale contributes its uniform part (x), as the panel's slider does
      const s = typeof o.scale === 'number' ? o.scale : (o.scale && Number.isFinite(o.scale.x) ? o.scale.x : 1);
      if (!map.has(o.id)) map.set(o.id, []);
      map.get(o.id).push({ slot: r.slot, scale: s });
    }
  }
  return map;
}
export function hintFor(id, hints) {
  const samples = hints.get(id); if (!samples || !samples.length) return null;
  const s = samples.map(x => x.scale).sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], samples };
}
