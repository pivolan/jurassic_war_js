// Архивы TRC/TRS/TRW и LZSS (порт tools/trc.py, tools/lzss.py)
export function lzss(src, outlen) {
  const ring = new Uint8Array(4096 + 64); let rpos = 0; const out = new Uint8Array(outlen); let n = 0, bp = 0; const nb = src.length * 8;
  const bits = k => { let v = 0; for (let j = 0; j < k; j++) { if (bp >= nb) throw new Error('lzss eof'); v = (v << 1) | ((src[bp >> 3] >> (7 - (bp & 7))) & 1); bp++; } return v; };
  const put = b => { ring[rpos] = b; rpos = rpos + 1 > 0xfff ? 0 : rpos + 1; };
  try {
    while (n < outlen) {
      if (bits(1) === 0) { const b = bits(8); out[n++] = b; put(b); }
      else { const ln = bits(5), pos = bits(12); const tmp = [];
        for (let j = 0; j < ln; j++) { const b = ring[pos + j]; out[n++] = b; ring[4096 + j] = b; tmp.push(b); if (n >= outlen) break; }
        if (ln < 0x1f) for (const b of tmp) put(b); }
    }
  } catch (e) { if (e.message !== 'lzss eof') throw e; }
  return out;
}
export class Archive {
  constructor(buf) { // buf: Uint8Array всего файла
    this.b = buf; const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.magic = String.fromCharCode(buf[0], buf[1], buf[2]); this.n = dv.getUint32(8, true); this.base = dv.getUint32(12, true); this.entries = [];
    for (let i = 0; i < this.n; i++) {
      if (this.magic === 'TRC') { const o = 0x20 + i * 32; let name = ''; for (let k = 0; k < 12 && buf[o + k]; k++) name += String.fromCharCode(buf[o + k]);
        this.entries.push({ name, off: dv.getUint32(o + 12, true), size: dv.getUint32(o + 16, true), stored: dv.getUint32(o + 20, true), cksum: dv.getUint16(o + 24, true), packed: buf[o + 26] }); }
      else if (this.magic === 'TRW') { const o = 0x20 + i * 16;   // звук: off, длина, каналы, частота, бит на отсчёт
        this.entries.push({ off: dv.getUint32(o, true), size: dv.getUint32(o + 4, true), stored: dv.getUint32(o + 4, true),
          channels: dv.getUint16(o + 8, true), rate: dv.getUint16(o + 10, true), bits: dv.getUint16(o + 12, true) }); }
      else { const o = 0x20 + i * 16; const next = i + 1 < this.n ? dv.getUint32(o + 16, true) : buf.length - this.base;
        this.entries.push({ off: dv.getUint32(o, true), w: dv.getUint16(o + 4, true), h: dv.getUint16(o + 6, true), x: [dv.getInt16(o + 8, true), dv.getInt16(o + 10, true), dv.getInt16(o + 12, true), dv.getInt16(o + 14, true)], stored: next - dv.getUint32(o, true) }); }
    }
  }
  raw(i) { const e = this.entries[i]; return this.b.subarray(this.base + e.off, this.base + e.off + e.stored); }
  data(i) { const e = this.entries[i]; return e.packed === 1 ? lzss(this.raw(i), e.size) : this.raw(i).subarray(0, e.size ?? e.stored); }
  find(name) { return this.entries.findIndex(e => e.name === name); }
}
