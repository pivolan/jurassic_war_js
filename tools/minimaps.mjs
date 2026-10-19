// Миниатюры карт для лобби сетевой игры: по пикселю на клетку, цвета — те же, что у мини-карты
// в игре (таблица 0x3e8aa по тайлу, 0x3e8a0 по владельцу юнита), вся карта без тумана.
//   node tools/minimaps.mjs   → out/ui/minimap/m<миссия>.png и index.json (размеры, племена)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
import { Mem, G, U, UNITS, BG, BI, MO } from '../reimpl/js/mem.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';
const PAL = 0x44980, COL_TILE = 0x3e8aa, COL_OWNER = 0x3e8a0;
const образ = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));
const files = {}; for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC', '_PWAR13.TRC', '_PWAR10.TRC']) files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/' + f));
const КАРТЫ = JSON.parse(fs.readFileSync(КОРЕНЬ + 'data/maps.json', 'utf8')).maps;
const КУДА = path.join(КОРЕНЬ, '..', 'out', 'ui', 'minimap'); fs.mkdirSync(КУДА, { recursive: true });

function png(w, h, rgb) {              // минимальный PNG без зависимостей
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const index = {};
for (const карта of КАРТЫ) {
  const миссия = карта.id;
  const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110);
  loadMission(m, files, миссия, 0, 1);
  const W = m.u32(G.mapW), H = m.u32(G.mapH), b = m.b;
  const rgb = Buffer.alloc(W * H * 3);
  const племена = new Set();
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { const t = b[UNITS + i + U.TYPE], вл = b[UNITS + i + U.OWNER]; if (t >= 1 && t <= 13 && вл < 8) племена.add(вл); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cell = (y << 8) | x;
    let col; let o = b[MO + cell] >> 4; if (o === 0) o = b[BI + cell] >> 2;
    if (o === 0) col = b[COL_TILE + (m.u16(BG + cell * 2) & 0x7ff)]; else col = b[COL_OWNER + o];
    const p = (y * W + x) * 3; rgb[p] = b[PAL + col * 3]; rgb[p + 1] = b[PAL + col * 3 + 1]; rgb[p + 2] = b[PAL + col * 3 + 2];
  }
  fs.writeFileSync(path.join(КУДА, `m${миссия}.png`), png(W, H, rgb));
  index[миссия] = { w: W, h: H, племена: [...племена].sort((a, b) => a - b), name: карта.name, pack: карта.pack };
  console.log(`${карта.name} (id ${миссия}): ${W}x${H}, племена ${[...племена].join(',')}`);
}
fs.writeFileSync(path.join(КУДА, 'index.json'), JSON.stringify(index));
