// UnityFS bundle reader: header, blocks info (block + node tables), and
// per-node reads that decompress only the blocks covering that node.
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { lz4Block } from './lz4.mjs';

function decompress(raw, type, uSize) {
  if (type === 0) return raw;
  if (type === 2 || type === 3) return lz4Block(raw, uSize);
  throw new Error('unsupported UnityFS compression type ' + type);
}

export function openBundle(path) {
  const fd = openSync(path, 'r'); const fileSize = fstatSync(fd).size;
  const read = (pos, len) => {
    const b = Buffer.alloc(len); let got = 0;
    while (got < len) { const n = readSync(fd, b, got, len - got, pos + got); if (n === 0) break; got += n; }
    if (got !== len) throw new Error(`short read at ${pos}: ${got}/${len}`);
    return b;
  };
  try {
    const hdr = read(0, Math.min(256, fileSize)); let p = 0;
    const cstr = () => { const e = hdr.indexOf(0, p); if (e < 0) throw new Error('bad UnityFS header'); const s = hdr.toString('utf8', p, e); p = e + 1; return s; };
    const sig = cstr(); if (sig !== 'UnityFS') throw new Error('not a UnityFS bundle: ' + sig);
    const format = hdr.readUInt32BE(p); p += 4; cstr(); const engine = cstr();
    p += 8; const cBI = hdr.readUInt32BE(p); p += 4; const uBI = hdr.readUInt32BE(p); p += 4; const flags = hdr.readUInt32BE(p); p += 4;
    if (format >= 7) p = (p + 15) & ~15;
    const infoAtEnd = !!(flags & 0x80);
    const infoPos = infoAtEnd ? fileSize - cBI : p;
    const info = decompress(read(infoPos, cBI), flags & 0x3f, uBI);
    let q = 16; const blockCount = info.readInt32BE(q); q += 4;
    const blocks = []; let uAcc = 0;
    for (let i = 0; i < blockCount; i++) {
      const u = info.readUInt32BE(q), c = info.readUInt32BE(q + 4), f = info.readUInt16BE(q + 8); q += 10;
      blocks.push({ u, c, f, uStart: uAcc }); uAcc += u;
    }
    const nodeCount = info.readInt32BE(q); q += 4; const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const offset = Number(info.readBigInt64BE(q)), size = Number(info.readBigInt64BE(q + 8)), nf = info.readUInt32BE(q + 16); q += 20;
      const e = info.indexOf(0, q); nodes.push({ path: info.toString('utf8', q, e), offset, size, flags: nf }); q = e + 1;
    }
    let dataPos = infoAtEnd ? p : infoPos + cBI; if (flags & 0x200) dataPos = (dataPos + 15) & ~15;
    let cAcc = dataPos; for (const b of blocks) { b.cStart = cAcc; cAcc += b.c; }
    const cache = new Map();
    const block = (i) => {
      if (!cache.has(i)) { const b = blocks[i]; cache.set(i, decompress(read(b.cStart, b.c), b.f & 0x3f, b.u)); }
      return cache.get(i);
    };
    function readNode(name) {
      const n = nodes.find(x => x.path === name); if (!n) throw new Error('no node ' + name);
      const out = Buffer.alloc(n.size); let written = 0;
      for (let i = 0; i < blocks.length && written < n.size; i++) {
        const b = blocks[i]; const bEnd = b.uStart + b.u;
        if (bEnd <= n.offset || b.uStart >= n.offset + n.size) continue;
        const from = Math.max(n.offset, b.uStart), to = Math.min(n.offset + n.size, bEnd);
        block(i).copy(out, from - n.offset, from - b.uStart, to - b.uStart); written += to - from;
      }
      if (written !== n.size) throw new Error(`node ${name}: read ${written}/${n.size} bytes`);
      return out;
    }
    return { format, engine, nodes, readNode, close: () => { cache.clear(); closeSync(fd); } };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}
