// Raw LZ4 block decompression (no frame header), as used by UnityFS bundles
// for LZ4 and LZ4HC compressed blocks.
export function lz4Block(src, outSize) {
  const out = Buffer.alloc(outSize); let s = 0, d = 0;
  while (s < src.length) {
    const tok = src[s++]; let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    if (d + lit > outSize || s + lit > src.length) throw new Error('lz4: literal run out of range');
    src.copy(out, d, s, s + lit); s += lit; d += lit;
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    if (off === 0 || off > d) throw new Error(`lz4: bad match offset ${off} at output ${d}`);
    let ml = tok & 15; if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); } ml += 4;
    if (d + ml > outSize) throw new Error('lz4: match run out of range');
    for (let i = 0; i < ml; i++) { out[d] = out[d - off]; d++; }
  }
  if (d !== outSize) throw new Error(`lz4: produced ${d} bytes, expected ${outSize}`);
  return out;
}
